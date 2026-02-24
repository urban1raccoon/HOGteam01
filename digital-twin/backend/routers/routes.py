"""
Route Optimization API 

"""

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict
from urllib import error, request

from fastapi import APIRouter, HTTPException

from models.route_models import (
    RouteDetail,
    RouteOptimizationRequest,
    RouteOptimizationResponse,
    TrafficPrediction,
)
from ml.predictor import TrafficPredictor
from services.routing import fetch_route_alternatives

router = APIRouter()
logger = logging.getLogger(__name__)

# Initialize ML predictor once at startup
# fallback if model files not available
predictor = TrafficPredictor()

# Route optimization system prompt for Grok
ROUTE_OPTIMIZATION_PROMPT = (
    "Ты эксперт по оптимизации маршрутов в городе. "
    "Проанализируй предложенные маршруты с учётом расстояния, времени в пути и "
    "прогноза трафика. Рекомендуй оптимальный маршрут. "
    "Формат ответа: Рекомендация (номер маршрута), Обоснование (2-3 пункта), Риски."
)


@router.post("/optimize", response_model=RouteOptimizationResponse)
def optimize_route(payload: RouteOptimizationRequest):
    """
    Optimize route from origin to destination using AI and ML predictions.

    This endpoint:
    1. Fetches route alternatives from Mapbox API
    2. Predicts traffic for each route using GRU model
    3. Sends data to Grok AI for recommendation
    4. Returns routes with predictions and AI recommendation

    Args:
        payload: Route optimization request with origin/destination

    Returns:
        Route optimization response with routes, predictions, and AI recommendation

    Raises:
        HTTPException: 400 for invalid coordinates, 503 for routing service unavailable
    """
    # alidate coordinates
    _validate_coordinates(payload.origin, "origin")
    _validate_coordinates(payload.destination, "destination")

    # Fetch routes from mapbox
    access_token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    logger.info(
        f"Fetching routes from {payload.origin} to {payload.destination}"
    )

    raw_routes = fetch_route_alternatives(
        origin=payload.origin,
        destination=payload.destination,
        access_token=access_token,
        num_alternatives=2,
    )

    if not raw_routes:
        raise HTTPException(
            status_code=503,
            detail="Routing service unavailable. Please try again later.",
        )

    # Predict traffic for each route
    now = datetime.now()
    routes_with_predictions = []

    for idx, route in enumerate(raw_routes):
        # Prepare features for ML prediction
        route_features = {
            "distance_km": route["distance_km"],
            "duration_min": route["duration_min"],
            "hour": now.hour,
            "day_of_week": now.weekday(),
            "current_traffic_score": route.get("traffic_score", 5.0),
        }

        # Get ML traffic prediction
        if payload.include_traffic_prediction:
            prediction = predictor.predict_traffic(route_features)
        else:
            # Simple prediction if ML disabled
            prediction = {
                "predicted_level": "medium",
                "confidence": 0.5,
                "estimated_delay_minutes": 0.0,
            }

        # Create route detail
        traffic_pred = TrafficPrediction(
            predicted_level=prediction["predicted_level"],
            confidence=prediction["confidence"],
            estimated_delay_minutes=prediction["estimated_delay_minutes"],
        )

        route_detail = RouteDetail(
            route_id=f"route_{idx}",
            distance_km=route["distance_km"],
            duration_minutes=route["duration_min"],
            duration_with_traffic_minutes=(
                route["duration_min"] + prediction["estimated_delay_minutes"]
            ),
            traffic_prediction=traffic_pred,
            geometry=route["geometry"],
            summary=f"{route['distance_km']:.1f} km via {route.get('main_road', 'main route')}",
        )

        routes_with_predictions.append(route_detail)

    #  Get AI recommendation from Grok
    ai_recommendation = None
    recommended_idx = 0  # Default to first route

    if payload.use_ai_recommendation:
        try:
            # Prepare context for ai
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
                "transport_mode": payload.transport_mode,
            }

            # Call ai
            grok_prompt = (
                f"Какой маршрут выбрать из точки {payload.origin} "
                f"до точки {payload.destination} в {now.hour}:{now.minute:02d}?"
            )

            ai_response = _call_grok_ai(grok_prompt, grok_context)
            ai_recommendation = ai_response

            # Try to extract recommended route index from AI response
            recommended_idx = _extract_recommended_route(
                ai_recommendation, len(routes_with_predictions)
            )

        except Exception as exc:
            logger.warning(f"AI recommendation failed: {exc}")
            # Continue without AI recommendation

    


def _validate_coordinates(coords: tuple, name: str):
    """Validate longitude and latitude coordinates."""
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
    """
    Call Grok AI for route recommendation.

    Reuses the same pattern as routers/ai.py for consistency.

    Args:
        prompt: User prompt for route optimization
        context: Context dictionary with route data

    Returns:
        AI recommendation text

    Raises:
        Exception: If AI call fails
    """
    api_key = os.getenv("XAI_API_KEY", "")
    if not api_key or api_key == "your_xai_api_key_here":
        raise Exception("XAI_API_KEY not configured")

    api_url = os.getenv("XAI_API_URL", "https://api.x.ai/v1/chat/completions")
    model = os.getenv("XAI_MODEL", "grok-2-latest")
    temperature = float(os.getenv("XAI_TEMPERATURE", "0.25"))
    max_tokens = int(os.getenv("XAI_MAX_TOKENS", "700"))
    timeout = float(os.getenv("XAI_TIMEOUT_SECONDS", "25"))

    # Build messages array
    messages = [
        {"role": "system", "content": ROUTE_OPTIMIZATION_PROMPT},
        {"role": "system", "content": f"Контекст (JSON): {json.dumps(context, ensure_ascii=False)}"},
        {"role": "user", "content": prompt},
    ]

    # Build request body
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }

    # Create HTTP request
    http_request = request.Request(
        api_url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    # Execute request
    with request.urlopen(http_request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        parsed = json.loads(raw)

        # Extract content
        if "choices" in parsed and len(parsed["choices"]) > 0:
            message = parsed["choices"][0].get("message", {})
            content = message.get("content", "")

            if isinstance(content, str):
                return content.strip()
            elif isinstance(content, list):
                # Multi-part content
                texts = [
                    item.get("text", "")
                    for item in content
                    if item.get("type") == "text"
                ]
                return "\n".join(texts).strip()

        raise Exception("No content in Grok response")


def _extract_recommended_route(ai_text: str, num_routes: int) -> int:
    """
    Extract recommended route index from AI response.

    Looks for patterns like "маршрут 0", "route 1", etc.

    Args:
        ai_text: AI recommendation text
        num_routes: Total number of routes

    Returns:
        Index of recommended route (0-based)
    """
    if not ai_text:
        return 0

    text_lower = ai_text.lower()

    # Try to find route number mentions
    for i in range(num_routes):
        if f"маршрут {i}" in text_lower or f"route {i}" in text_lower:
            return i
        if f"маршрут #{i}" in text_lower or f"route #{i}" in text_lower:
            return i

    # If no specific route mentioned, return first route
    return 0
