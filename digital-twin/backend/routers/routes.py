"""Route optimization and transport mode recommendation API."""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List
from urllib import request

from fastapi import APIRouter, HTTPException

from models.route_models import (
    MultiModalRouteOption,
    MultiModalRouteRequest,
    MultiModalRouteResponse,
    RouteDetail,
    RouteOptimizationRequest,
    RouteOptimizationResponse,
    TrafficPrediction,
)
from ml.predictor import TrafficPredictor
from services.routing import fetch_route_alternatives

router = APIRouter()
logger = logging.getLogger(__name__)

predictor = TrafficPredictor()

SUPPORTED_MODES = ("driving", "walking", "cycling")
MODE_LABELS = {
    "driving": "Car",
    "walking": "Walk",
    "cycling": "Bike",
}

ROUTE_OPTIMIZATION_PROMPT = (
    "Ты эксперт по оптимизации маршрутов в городе. "
    "Проанализируй предложенные маршруты с учётом расстояния, времени в пути и "
    "прогноза трафика. Рекомендуй оптимальный маршрут. "
    "Формат ответа: Рекомендация (номер маршрута), Обоснование (2-3 пункта), Риски."
)


@router.post("/optimize", response_model=RouteOptimizationResponse)
def optimize_route(payload: RouteOptimizationRequest) -> RouteOptimizationResponse:
    """Build alternatives for selected mode and return best route recommendation."""
    _validate_coordinates(payload.origin, "origin")
    _validate_coordinates(payload.destination, "destination")

    mode = _normalize_mode(payload.transport_mode)
    access_token = os.getenv("MAPBOX_ACCESS_TOKEN", "")

    logger.info(
        "Fetching routes: origin=%s destination=%s mode=%s",
        payload.origin,
        payload.destination,
        mode,
    )

    raw_routes = fetch_route_alternatives(
        origin=payload.origin,
        destination=payload.destination,
        access_token=access_token,
        num_alternatives=2,
        transport_mode=mode,
    )

    if not raw_routes:
        raise HTTPException(
            status_code=503,
            detail="Routing service unavailable. Please try again later.",
        )

    now = datetime.now()
    routes_with_predictions: List[RouteDetail] = []

    for idx, route in enumerate(raw_routes):
        prediction = _predict_for_mode(
            route=route,
            now=now,
            include_prediction=payload.include_traffic_prediction,
            mode=mode,
        )

        traffic_pred = TrafficPrediction(
            predicted_level=prediction["predicted_level"],
            confidence=prediction["confidence"],
            estimated_delay_minutes=prediction["estimated_delay_minutes"],
        )

        total_duration = route["duration_min"] + prediction["estimated_delay_minutes"]

        route_detail = RouteDetail(
            route_id=f"route_{idx}",
            distance_km=route["distance_km"],
            duration_minutes=route["duration_min"],
            duration_with_traffic_minutes=total_duration,
            traffic_prediction=traffic_pred,
            geometry=route["geometry"],
            summary=(
                f"{route['distance_km']:.1f} km via {route.get('main_road', 'main route')} "
                f"({MODE_LABELS.get(mode, mode)})"
            ),
        )
        routes_with_predictions.append(route_detail)

    ai_recommendation = None
    recommended_idx = _choose_fastest_route(routes_with_predictions)

    if payload.use_ai_recommendation:
        try:
            routes_context = [
                {
                    "route_id": r.route_id,
                    "distance_km": r.distance_km,
                    "duration_base_min": r.duration_minutes,
                    "duration_traffic_min": r.duration_with_traffic_minutes,
                    "predicted_traffic": r.traffic_prediction.predicted_level,
                    "predicted_delay_min": r.traffic_prediction.estimated_delay_minutes,
                    "confidence": r.traffic_prediction.confidence,
                }
                for r in routes_with_predictions
            ]

            grok_context = {
                "routes": routes_context,
                "origin": payload.origin,
                "destination": payload.destination,
                "current_time": now.isoformat(),
                "transport_mode": mode,
            }

            grok_prompt = (
                f"Какой маршрут выбрать из точки {payload.origin} "
                f"до точки {payload.destination} в {now.hour}:{now.minute:02d}?"
            )

            ai_recommendation = _call_grok_ai(grok_prompt, grok_context)
            recommended_idx = _extract_recommended_route(
                ai_recommendation,
                len(routes_with_predictions),
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning("AI recommendation failed: %s", exc)

    return RouteOptimizationResponse(
        routes=routes_with_predictions,
        ai_recommendation=ai_recommendation,
        recommended_route_index=recommended_idx,
        metadata={
            "request_time": now.isoformat(),
            "num_routes": len(routes_with_predictions),
            "ai_used": payload.use_ai_recommendation and ai_recommendation is not None,
            "ml_used": payload.include_traffic_prediction,
            "ml_fallback": predictor.using_fallback,
            "transport_mode": mode,
        },
    )


@router.post("/modes", response_model=MultiModalRouteResponse)
def recommend_transport_modes(payload: MultiModalRouteRequest) -> MultiModalRouteResponse:
    """Rank transport modes for the selected pair of points."""
    _validate_coordinates(payload.origin, "origin")
    _validate_coordinates(payload.destination, "destination")

    access_token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    now = datetime.now()
    requested_modes = _normalize_requested_modes(payload.modes)

    options: List[MultiModalRouteOption] = []

    for mode in requested_modes:
        raw_routes = fetch_route_alternatives(
            origin=payload.origin,
            destination=payload.destination,
            access_token=access_token,
            num_alternatives=1,
            transport_mode=mode,
        )

        if not raw_routes:
            continue

        route = raw_routes[0]
        prediction = _predict_for_mode(
            route=route,
            now=now,
            include_prediction=payload.include_traffic_prediction,
            mode=mode,
        )

        total_duration = route["duration_min"] + prediction["estimated_delay_minutes"]
        score = _recommendation_score(
            mode=mode,
            distance_km=route["distance_km"],
            duration_with_traffic=total_duration,
            traffic_score=route.get("traffic_score", 5.0),
        )

        options.append(
            MultiModalRouteOption(
                mode=mode,
                label=MODE_LABELS.get(mode, mode),
                distance_km=route["distance_km"],
                duration_minutes=route["duration_min"],
                duration_with_traffic_minutes=total_duration,
                traffic_score=route.get("traffic_score", 5.0),
                predicted_level=prediction["predicted_level"],
                estimated_delay_minutes=prediction["estimated_delay_minutes"],
                recommendation_score=score,
                summary=(
                    f"{MODE_LABELS.get(mode, mode)}: {round(total_duration)} min, "
                    f"traffic {prediction['predicted_level']}"
                ),
                geometry=route.get("geometry", []),
            )
        )

    if not options:
        raise HTTPException(
            status_code=503,
            detail="Routing service unavailable. No mode options generated.",
        )

    options.sort(key=lambda item: item.recommendation_score, reverse=True)

    return MultiModalRouteResponse(
        options=options,
        recommended_mode=options[0].mode,
        metadata={
            "request_time": now.isoformat(),
            "num_options": len(options),
            "ml_fallback": predictor.using_fallback,
        },
    )


def _normalize_mode(mode: str) -> str:
    value = str(mode or "").strip().lower()
    if value in ("walk", "walking", "foot"):
        return "walking"
    if value in ("bike", "bicycle", "cycling"):
        return "cycling"
    return "driving"


def _normalize_requested_modes(modes: List[str]) -> List[str]:
    normalized: List[str] = []
    for raw in modes or []:
        mode = _normalize_mode(raw)
        if mode not in normalized:
            normalized.append(mode)

    if not normalized:
        return list(SUPPORTED_MODES)

    return [mode for mode in normalized if mode in SUPPORTED_MODES]


def _level_from_score(score: float) -> str:
    if score < 3.0:
        return "low"
    if score < 6.0:
        return "medium"
    if score < 8.0:
        return "high"
    return "severe"


def _predict_for_mode(
    route: Dict[str, Any],
    now: datetime,
    include_prediction: bool,
    mode: str,
) -> Dict[str, Any]:
    """Predict traffic impact for route and transport mode."""
    traffic_score = float(route.get("traffic_score", 5.0))

    if not include_prediction:
        return {
            "predicted_level": _level_from_score(traffic_score),
            "confidence": 0.5,
            "estimated_delay_minutes": 0.0,
        }

    if mode == "driving":
        route_features = {
            "distance_km": route["distance_km"],
            "duration_min": route["duration_min"],
            "hour": now.hour,
            "day_of_week": now.weekday(),
            "current_traffic_score": traffic_score,
        }
        return predictor.predict_traffic(route_features)

    # Non-motorized modes are less sensitive to road congestion.
    base_duration = float(route.get("duration_min", 0.0))
    if mode == "walking":
        return {
            "predicted_level": "low",
            "confidence": 0.8,
            "estimated_delay_minutes": 0.0,
        }

    # cycling
    delay_factor = 0.02 if traffic_score < 6 else 0.06
    predicted = "low" if traffic_score < 6 else "medium"
    return {
        "predicted_level": predicted,
        "confidence": 0.72,
        "estimated_delay_minutes": round(base_duration * delay_factor, 1),
    }


def _recommendation_score(
    mode: str,
    distance_km: float,
    duration_with_traffic: float,
    traffic_score: float,
) -> float:
    """Higher score means better overall mode choice for current conditions."""
    base_cost = float(duration_with_traffic)

    if mode == "driving":
        base_cost += traffic_score * 1.9

    if mode == "walking":
        # Walking loses practicality on long distances.
        base_cost += max(0.0, distance_km - 2.5) * 7.0

    if mode == "cycling":
        base_cost += max(0.0, distance_km - 8.0) * 3.0
        base_cost += max(0.0, traffic_score - 6.0) * 1.2

    score = 100.0 / (1.0 + (base_cost / 20.0))
    return round(max(1.0, min(99.0, score)), 1)


def _choose_fastest_route(routes: List[RouteDetail]) -> int:
    if not routes:
        return 0

    best_index = 0
    best_duration = routes[0].duration_with_traffic_minutes

    for idx, route in enumerate(routes):
        if route.duration_with_traffic_minutes < best_duration:
            best_duration = route.duration_with_traffic_minutes
            best_index = idx

    return best_index


def _validate_coordinates(coords: tuple, name: str) -> None:
    lon, lat = coords

    if not (-180 <= lon <= 180):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {name} longitude: {lon}. Must be between -180 and 180.",
        )

    if not (-90 <= lat <= 90):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {name} latitude: {lat}. Must be between -90 and 90.",
        )


def _call_grok_ai(prompt: str, context: Dict[str, Any]) -> str:
    api_key = os.getenv("XAI_API_KEY", "")
    if not api_key or api_key == "your_xai_api_key_here":
        raise Exception("XAI_API_KEY not configured")

    api_url = os.getenv("XAI_API_URL", "https://api.x.ai/v1/chat/completions")
    model = os.getenv("XAI_MODEL", "grok-2-latest")
    temperature = float(os.getenv("XAI_TEMPERATURE", "0.25"))
    max_tokens = int(os.getenv("XAI_MAX_TOKENS", "700"))
    timeout = float(os.getenv("XAI_TIMEOUT_SECONDS", "25"))

    messages = [
        {"role": "system", "content": ROUTE_OPTIMIZATION_PROMPT},
        {
            "role": "system",
            "content": f"Контекст (JSON): {json.dumps(context, ensure_ascii=False)}",
        },
        {"role": "user", "content": prompt},
    ]

    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    http_request = request.Request(
        api_url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    with request.urlopen(http_request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        parsed = json.loads(raw)

        if "choices" in parsed and len(parsed["choices"]) > 0:
            message = parsed["choices"][0].get("message", {})
            content = message.get("content", "")

            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                texts = [
                    item.get("text", "")
                    for item in content
                    if item.get("type") == "text"
                ]
                return "\n".join(texts).strip()

        raise Exception("No content in Grok response")


def _extract_recommended_route(ai_text: str, num_routes: int) -> int:
    if not ai_text:
        return 0

    text_lower = ai_text.lower()

    for i in range(num_routes):
        if f"маршрут {i}" in text_lower or f"route {i}" in text_lower:
            return i
        if f"маршрут #{i}" in text_lower or f"route #{i}" in text_lower:
            return i

    return 0
