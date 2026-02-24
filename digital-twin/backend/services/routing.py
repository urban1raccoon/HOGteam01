"""
Mapbox Directions API Integration

This module provides functions to fetch route alternatives from the Mapbox Directions API.
Uses the same urllib.request pattern as the AI module for consistency.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, parse, request

logger = logging.getLogger(__name__)

# Mapbox Directions API endpoint
MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving-traffic"


def fetch_route_alternatives(
    origin: Tuple[float, float],
    destination: Tuple[float, float],
    access_token: str,
    num_alternatives: int = 2,
) -> List[Dict[str, Any]]:
    """
    Fetch route alternatives from Mapbox Directions API.

    Args:
        origin: Tuple of (longitude, latitude) for start point
        destination: Tuple of (longitude, latitude) for end point
        access_token: Mapbox access token
        num_alternatives: Number of alternative routes to request (default: 2)

    Returns:
        List of route dictionaries with keys:
        - distance_km: Route distance in kilometers
        - duration_min: Estimated duration in minutes
        - geometry: List of [lon, lat] coordinates
        - traffic_score: Current traffic score (0-10 scale)
        - main_road: Name of main road used (if available)
    """
    if not access_token or access_token == "your_mapbox_access_token_here":
        logger.warning("Mapbox access token not configured, using fallback route")
        return [_create_fallback_route(origin, destination)]

    # Build URL: /directions/v5/mapbox/driving-traffic/{lon,lat;lon,lat}
    coordinates = f"{origin[0]},{origin[1]};{destination[0]},{destination[1]}"
    params = parse.urlencode({
        "access_token": access_token,
        "alternatives": "true" if num_alternatives > 1 else "false",
        "geometries": "geojson",
        "overview": "full",
        "annotations": "congestion,duration,distance",
        "steps": "true",
        "language": "en",
    })
    url = f"{MAPBOX_DIRECTIONS_URL}/{coordinates}?{params}"

    # Get timeout from environment
    timeout = float(os.getenv("ROUTING_TIMEOUT_SECONDS", "10"))

    try:
        # Create HTTP GET request
        http_request = request.Request(url, method="GET")

        # Execute request
        with request.urlopen(http_request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)

            # Parse routes from response
            routes = _parse_mapbox_response(parsed)

            if not routes:
                logger.warning("Mapbox returned no routes, using fallback")
                return [_create_fallback_route(origin, destination)]

            logger.info(f"Successfully fetched {len(routes)} routes from Mapbox")
            return routes

    except error.HTTPError as exc:
        logger.warning(f"Mapbox API HTTP error {exc.code}: {exc.reason}")
        if exc.code == 401 or exc.code == 403:
            logger.error("Invalid Mapbox access token. Check MAPBOX_ACCESS_TOKEN environment variable.")
        return [_create_fallback_route(origin, destination)]

    except error.URLError as exc:
        logger.warning(f"Mapbox API network error: {exc.reason}")
        return [_create_fallback_route(origin, destination)]

    except json.JSONDecodeError as exc:
        logger.exception(f"Failed to parse Mapbox response: {exc}")
        return [_create_fallback_route(origin, destination)]

    except Exception as exc:
        logger.exception(f"Unexpected error fetching routes from Mapbox: {exc}")
        return [_create_fallback_route(origin, destination)]


def _parse_mapbox_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse Mapbox Directions API response and extract route information.

    Args:
        data: Raw JSON response from Mapbox API

    Returns:
        List of parsed route dictionaries
    """
    routes = []

    raw_routes = data.get("routes", [])
    if not raw_routes:
        return routes

    for route_data in raw_routes:
        try:
            # Extract distance (meters → km)
            distance_m = route_data.get("distance", 0)
            distance_km = distance_m / 1000.0

            # Extract duration (seconds → minutes)
            # Use duration_typical if available, otherwise duration
            duration_s = route_data.get("duration", 0)
            duration_min = duration_s / 60.0

            # Extract geometry (GeoJSON coordinates)
            geometry = _extract_geometry(route_data)

            # Extract traffic score
            traffic_score = _extract_traffic_score(route_data)

            # Extract main road name from legs/steps
            main_road = _extract_main_road(route_data)

            routes.append({
                "distance_km": round(distance_km, 2),
                "duration_min": round(duration_min, 1),
                "geometry": geometry,
                "traffic_score": traffic_score,
                "main_road": main_road,
            })

        except Exception as exc:
            logger.warning(f"Failed to parse individual route: {exc}")
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


def _extract_traffic_score(route_data: Dict[str, Any]) -> float:
    """
    Extract traffic score from route data.
    Returns value from 0-10 scale (0=no traffic, 10=severe congestion).

    Uses per-segment congestion annotations when available (average across
    all segments), otherwise falls back to a duration/distance heuristic.
    """
    # Try annotation.congestion from legs
    congestion_values: List[float] = []
    for leg in route_data.get("legs", []):
        annotation = leg.get("annotation", {})
        for label in annotation.get("congestion", []):
            score = _CONGESTION_SCORES.get(label)
            if score is not None:
                congestion_values.append(score)

    if congestion_values:
        return round(sum(congestion_values) / len(congestion_values), 1)

    # Fallback: estimate based on duration vs distance ratio
    duration_s = route_data.get("duration", 0)
    distance_km = route_data.get("distance", 1000) / 1000.0
    duration_min = duration_s / 60.0

    if distance_km <= 0:
        return 5.0

    actual_speed_ratio = duration_min / distance_km

    if actual_speed_ratio < 1.2:
        return 2.0
    elif actual_speed_ratio < 1.8:
        return 5.0
    elif actual_speed_ratio < 2.5:
        return 7.5
    else:
        return 9.0


def _extract_main_road(route_data: Dict[str, Any]) -> str:
    """Extract main road name from Mapbox route legs/steps."""
    legs = route_data.get("legs", [])
    if not legs:
        return "main route"

    # Find the longest step by distance to get the main road
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
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Dict[str, Any]:
    """
    Create a fallback route when Mapbox API is unavailable.
    Uses simple distance calculation and estimated duration.

    Args:
        origin: Origin coordinates (lon, lat)
        destination: Destination coordinates (lon, lat)

    Returns:
        Dictionary with estimated route parameters
    """
    from math import atan2, cos, radians, sin, sqrt

    lon1, lat1 = radians(origin[0]), radians(origin[1])
    lon2, lat2 = radians(destination[0]), radians(destination[1])

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    distance_km = 6371 * c

    estimated_road_distance = distance_km * 1.5
    duration_min = (estimated_road_distance / 30) * 60

    return {
        "distance_km": round(estimated_road_distance, 2),
        "duration_min": round(duration_min, 1),
        "geometry": [[origin[0], origin[1]], [destination[0], destination[1]]],
        "traffic_score": 5.0,
        "main_road": "estimated route",
    }
