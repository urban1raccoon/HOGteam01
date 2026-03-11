"""
Mapbox Directions API Integration

This module provides functions to fetch route alternatives from the Mapbox Directions API.
Uses the same urllib.request pattern as the AI module for consistency.
"""

import json
import logging
import os
from typing import Any, Dict, List, Tuple
from urllib import error, parse, request

logger = logging.getLogger(__name__)

MAPBOX_DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox"

_ROUTE_ENDPOINT_BY_MODE = {
    "driving": "driving-traffic",
    "walking": "walking",
    "cycling": "cycling",
}

_FALLBACK_SPEED_KMH = {
    "driving": 30.0,
    "walking": 4.8,
    "cycling": 15.0,
}


def fetch_route_alternatives(
    origin: Tuple[float, float],
    destination: Tuple[float, float],
    access_token: str,
    num_alternatives: int = 2,
    transport_mode: str = "driving",
) -> List[Dict[str, Any]]:
    """
    Fetch route alternatives from Mapbox Directions API.

    Args:
        origin: Tuple of (longitude, latitude) for start point
        destination: Tuple of (longitude, latitude) for end point
        access_token: Mapbox access token
        num_alternatives: Number of alternative routes to request (default: 2)
        transport_mode: driving, walking, cycling

    Returns:
        List of route dictionaries with keys:
        - distance_km: Route distance in kilometers
        - duration_min: Estimated duration in minutes
        - geometry: List of [lon, lat] coordinates
        - traffic_score: Current traffic score (0-10 scale)
        - main_road: Name of main road used (if available)
        - transport_mode: normalized mode for this route
    """
    mode = _normalize_transport_mode(transport_mode)

    if not access_token or access_token == "your_mapbox_access_token_here":
        logger.warning("Mapbox access token not configured, using fallback route")
        return [_create_fallback_route(origin, destination, mode)]

    endpoint = _ROUTE_ENDPOINT_BY_MODE[mode]
    coordinates = f"{origin[0]},{origin[1]};{destination[0]},{destination[1]}"

    params_data = {
        "access_token": access_token,
        "alternatives": "true" if num_alternatives > 1 else "false",
        "geometries": "geojson",
        "overview": "full",
        "steps": "true",
        "language": "en",
    }

    # Congestion annotations only make sense for driving-traffic profile.
    if mode == "driving":
        params_data["annotations"] = "congestion,duration,distance"
    else:
        params_data["annotations"] = "duration,distance"

    params = parse.urlencode(params_data)
    url = f"{MAPBOX_DIRECTIONS_BASE}/{endpoint}/{coordinates}?{params}"

    timeout = float(os.getenv("ROUTING_TIMEOUT_SECONDS", "10"))

    try:
        http_request = request.Request(url, method="GET")
        with request.urlopen(http_request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)

            routes = _parse_mapbox_response(parsed, mode)
            if not routes:
                logger.warning("Mapbox returned no routes for mode=%s, using fallback", mode)
                return [_create_fallback_route(origin, destination, mode)]

            logger.info("Successfully fetched %s routes from Mapbox for mode=%s", len(routes), mode)
            return routes

    except error.HTTPError as exc:
        logger.warning("Mapbox API HTTP error %s: %s", exc.code, exc.reason)
        if exc.code in (401, 403):
            logger.error("Invalid Mapbox access token. Check MAPBOX_ACCESS_TOKEN environment variable.")
        return [_create_fallback_route(origin, destination, mode)]

    except error.URLError as exc:
        logger.warning("Mapbox API network error: %s", exc.reason)
        return [_create_fallback_route(origin, destination, mode)]

    except json.JSONDecodeError as exc:
        logger.exception("Failed to parse Mapbox response: %s", exc)
        return [_create_fallback_route(origin, destination, mode)]

    except Exception as exc:  # noqa: BLE001
        logger.exception("Unexpected error fetching routes from Mapbox: %s", exc)
        return [_create_fallback_route(origin, destination, mode)]


def _normalize_transport_mode(mode: str) -> str:
    value = str(mode or "").strip().lower()
    if value in ("walking", "walk", "foot"):
        return "walking"
    if value in ("cycling", "bike", "bicycle"):
        return "cycling"
    return "driving"


def _parse_mapbox_response(data: Dict[str, Any], mode: str) -> List[Dict[str, Any]]:
    """
    Parse Mapbox Directions API response and extract route information.

    Args:
        data: Raw JSON response from Mapbox API
        mode: normalized transport mode

    Returns:
        List of parsed route dictionaries
    """
    routes: List[Dict[str, Any]] = []
    raw_routes = data.get("routes", [])

    if not raw_routes:
        return routes

    for route_data in raw_routes:
        try:
            distance_m = route_data.get("distance", 0)
            distance_km = distance_m / 1000.0

            duration_s = route_data.get("duration", 0)
            duration_min = duration_s / 60.0

            geometry = _extract_geometry(route_data)
            traffic_score = _extract_traffic_score(route_data, mode)
            main_road = _extract_main_road(route_data)

            routes.append(
                {
                    "distance_km": round(distance_km, 2),
                    "duration_min": round(duration_min, 1),
                    "geometry": geometry,
                    "traffic_score": traffic_score,
                    "main_road": main_road,
                    "transport_mode": mode,
                }
            )

        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to parse individual route: %s", exc)
            continue

    return routes


def _extract_geometry(route_data: Dict[str, Any]) -> List[List[float]]:
    """Extract route geometry from Mapbox response (GeoJSON format)."""
    geometry = route_data.get("geometry", {})
    if isinstance(geometry, dict):
        return geometry.get("coordinates", [])
    return []


_CONGESTION_SCORES: Dict[str, float] = {
    "low": 2.0,
    "moderate": 5.0,
    "heavy": 7.5,
    "severe": 9.0,
}


def _extract_traffic_score(route_data: Dict[str, Any], mode: str) -> float:
    """
    Extract traffic score from route data.
    Returns value from 0-10 scale (0=no traffic, 10=severe congestion).
    """
    if mode == "walking":
        return 1.5
    if mode == "cycling":
        return 2.0

    congestion_values: List[float] = []
    for leg in route_data.get("legs", []):
        annotation = leg.get("annotation", {})
        for label in annotation.get("congestion", []):
            score = _CONGESTION_SCORES.get(label)
            if score is not None:
                congestion_values.append(score)

    if congestion_values:
        return round(sum(congestion_values) / len(congestion_values), 1)

    duration_s = route_data.get("duration", 0)
    distance_km = route_data.get("distance", 1000) / 1000.0
    duration_min = duration_s / 60.0

    if distance_km <= 0:
        return 5.0

    actual_speed_ratio = duration_min / distance_km

    if actual_speed_ratio < 1.2:
        return 2.0
    if actual_speed_ratio < 1.8:
        return 5.0
    if actual_speed_ratio < 2.5:
        return 7.5
    return 9.0


def _extract_main_road(route_data: Dict[str, Any]) -> str:
    """Extract main road name from Mapbox route legs/steps."""
    legs = route_data.get("legs", [])
    if not legs:
        return "main route"

    best_name = "main route"
    best_distance = 0

    for leg in legs:
        for step in leg.get("steps", []):
            name = step.get("name", "")
            distance = step.get("distance", 0)
            if name and len(name) > 3 and distance > best_distance:
                best_name = name
                best_distance = distance

    return best_name


def _create_fallback_route(
    origin: Tuple[float, float], destination: Tuple[float, float], mode: str
) -> Dict[str, Any]:
    """
    Create a fallback route when Mapbox API is unavailable.
    Uses simple distance calculation and estimated duration.
    """
    from math import atan2, cos, radians, sin, sqrt

    lon1, lat1 = radians(origin[0]), radians(origin[1])
    lon2, lat2 = radians(destination[0]), radians(destination[1])

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    beeline_km = 6371 * c
    road_factor = 1.45 if mode == "driving" else 1.18
    estimated_road_distance = beeline_km * road_factor

    speed_kmh = _FALLBACK_SPEED_KMH.get(mode, 30.0)
    duration_min = (estimated_road_distance / max(speed_kmh, 1.0)) * 60

    traffic_score = 5.0
    if mode == "walking":
        traffic_score = 1.5
    elif mode == "cycling":
        traffic_score = 2.0

    return {
        "distance_km": round(estimated_road_distance, 2),
        "duration_min": round(duration_min, 1),
        "geometry": [[origin[0], origin[1]], [destination[0], destination[1]]],
        "traffic_score": traffic_score,
        "main_road": "estimated route",
        "transport_mode": mode,
    }
