"""
2GIS Routing API Integration

This module provides functions to fetch route alternatives from the 2GIS Routing API.
Uses the same urllib.request pattern as the AI module for consistency.
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib import error, request

logger = logging.getLogger(__name__)

# 2GIS Routing API endpoint
DGIS_ROUTING_URL = "http://routing.api.2gis.com/routing/7.0.0/global"


def fetch_route_alternatives(
    origin: Tuple[float, float],
    destination: Tuple[float, float],
    api_key: str,
    num_alternatives: int = 2,
) -> List[Dict[str, Any]]:
    """
    Fetch route alternatives from 2GIS Routing API.

    Args:
        origin: Tuple of (longitude, latitude) for start point
        destination: Tuple of (longitude, latitude) for end point
        api_key: 2GIS API key
        num_alternatives: Number of alternative routes to request (default: 2)

    Returns:
        List of route dictionaries with keys:
        - distance_km: Route distance in kilometers
        - duration_min: Estimated duration in minutes
        - geometry: List of [lon, lat] coordinates
        - traffic_score: Current traffic score (0-10 scale)
        - main_road: Name of main road used (if available)
    """
    if not api_key or api_key == "your_2gis_api_key_here":
        logger.warning("2GIS API key not configured, using fallback route")
        return [_create_fallback_route(origin, destination)]

    # Construct API URL with key
    url = f"{DGIS_ROUTING_URL}?key={api_key}"

    # Build request body
    body = {
        "points": [
            {"type": "stop", "lon": origin[0], "lat": origin[1]},
            {"type": "stop", "lon": destination[0], "lat": destination[1]},
        ],
        "transport": "driving",
        "route_mode": "fastest",
        "traffic_mode": "jam",  # Consider current traffic
        "output": "detailed",
        "alternative": num_alternatives,
        "locale": "en",
    }

    # Get timeout from environment
    timeout = float(os.getenv("DGIS_ROUTING_TIMEOUT_SECONDS", "10"))

    try:
        # Create HTTP request (following pattern from routers/ai.py)
        http_request = request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        # Execute request
        with request.urlopen(http_request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)

            # Parse routes from response
            routes = _parse_2gis_response(parsed)

            if not routes:
                logger.warning("2GIS returned no routes, using fallback")
                return [_create_fallback_route(origin, destination)]

            logger.info(f"Successfully fetched {len(routes)} routes from 2GIS")
            return routes

    except error.HTTPError as exc:
        logger.warning(f"2GIS API HTTP error {exc.code}: {exc.reason}")
        if exc.code == 401 or exc.code == 403:
            logger.error("Invalid 2GIS API key. Check DGIS_API_KEY environment variable.")
        return [_create_fallback_route(origin, destination)]

    except error.URLError as exc:
        logger.warning(f"2GIS API network error: {exc.reason}")
        return [_create_fallback_route(origin, destination)]

    except json.JSONDecodeError as exc:
        logger.exception(f"Failed to parse 2GIS response: {exc}")
        return [_create_fallback_route(origin, destination)]

    except Exception as exc:
        logger.exception(f"Unexpected error fetching routes from 2GIS: {exc}")
        return [_create_fallback_route(origin, destination)]


def _parse_2gis_response(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse 2GIS API response and extract route information.

    Args:
        data: Raw JSON response from 2GIS API

    Returns:
        List of parsed route dictionaries
    """
    routes = []

    # Check for routes in response
    raw_routes = data.get("routes", [])
    if not raw_routes:
        return routes

    for route_data in raw_routes:
        try:
            # Extract distance (meters → km)
            distance_m = route_data.get("distance", 0)
            distance_km = distance_m / 1000.0

            # Extract duration (seconds → minutes)
            duration_s = route_data.get("duration", 0)
            duration_min = duration_s / 60.0

            # Extract geometry (polyline or coordinates)
            geometry = _extract_geometry(route_data)

            # Extract traffic score (if available)
            traffic_score = _extract_traffic_score(route_data)

            # Extract main road name (if available)
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
    """Extract route geometry from 2GIS response."""
    geometry = []

    # Try to get geometry from maneuvers
    maneuvers = route_data.get("maneuvers", [])
    for maneuver in maneuvers:
        if "position" in maneuver:
            pos = maneuver["position"]
            if "lon" in pos and "lat" in pos:
                geometry.append([pos["lon"], pos["lat"]])

    # If no geometry from maneuvers, try direct geometry field
    if not geometry and "geometry" in route_data:
        geom_data = route_data["geometry"]
        if isinstance(geom_data, list):
            geometry = geom_data
        elif isinstance(geom_data, dict) and "coordinates" in geom_data:
            geometry = geom_data["coordinates"]

    return geometry


def _extract_traffic_score(route_data: Dict[str, Any]) -> float:
    """
    Extract traffic score from route data.
    Returns value from 0-10 scale (0=no traffic, 10=severe congestion).
    """
    # 2GIS may provide traffic_jam_level or similar field
    # For now, estimate based on duration vs distance ratio
    distance_km = route_data.get("distance", 1000) / 1000.0
    duration_min = route_data.get("duration", 0) / 60.0

    if distance_km <= 0:
        return 5.0  # Default medium traffic

    # Expected speed: 40 km/h in city = 1.5 min per km
    # No traffic: 60 km/h = 1.0 min per km
    # Heavy traffic: 20 km/h = 3.0 min per km
    actual_speed_ratio = duration_min / distance_km

    if actual_speed_ratio < 1.2:
        return 2.0  # Low traffic
    elif actual_speed_ratio < 1.8:
        return 5.0  # Medium traffic
    elif actual_speed_ratio < 2.5:
        return 7.5  # High traffic
    else:
        return 9.0  # Severe traffic


def _extract_main_road(route_data: Dict[str, Any]) -> str:
    """Extract main road name from route data."""
    # Try to find the longest segment or most significant road
    maneuvers = route_data.get("maneuvers", [])

    if not maneuvers:
        return "main route"

    # Get road name from first significant maneuver
    for maneuver in maneuvers:
        road_name = maneuver.get("street_name") or maneuver.get("name")
        if road_name and len(road_name) > 3:  # Skip very short names
            return road_name

    return "main route"


def _create_fallback_route(
    origin: Tuple[float, float], destination: Tuple[float, float]
) -> Dict[str, Any]:
    """
    Create a fallback route when 2GIS API is unavailable.
    Uses simple distance calculation and estimated duration.

    Args:
        origin: Origin coordinates (lon, lat)
        destination: Destination coordinates (lon, lat)

    Returns:
        Dictionary with estimated route parameters
    """
    # Calculate straight-line distance (Haversine formula)
    from math import radians, sin, cos, sqrt, atan2

    lon1, lat1 = radians(origin[0]), radians(origin[1])
    lon2, lat2 = radians(destination[0]), radians(destination[1])

    dlon = lon2 - lon1
    dlat = lat2 - lat1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    # Earth radius in km
    distance_km = 6371 * c

    # Estimate duration (assume 30 km/h average city speed)
    # Add 1.5x factor for actual road distance vs straight line
    estimated_road_distance = distance_km * 1.5
    duration_min = (estimated_road_distance / 30) * 60

    return {
        "distance_km": round(estimated_road_distance, 2),
        "duration_min": round(duration_min, 1),
        "geometry": [[origin[0], origin[1]], [destination[0], destination[1]]],
        "traffic_score": 5.0,  # Assume medium traffic
        "main_road": "estimated route",
    }
