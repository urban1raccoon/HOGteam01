"""Geo-spatial services for Mapbox-powered terrain analytics."""

from __future__ import annotations

import json
import logging
import math
import os
from typing import Any, Dict, List, Sequence, Tuple
from urllib import error, parse, request

logger = logging.getLogger(__name__)

MAPBOX_ISOCHRONE_URL = "https://api.mapbox.com/isochrone/v1/mapbox"
EARTH_RADIUS_M = 6_371_008.8

_PROFILE_SPEED_KMH = {
    "walking": 4.8,
    "cycling": 15.0,
    "driving": 30.0,
}


def fetch_isochrones(
    center: Tuple[float, float],
    profile: str,
    contours_minutes: Sequence[int],
    access_token: str,
    polygons: bool = True,
    denoise: float = 1.0,
    generalize: float | None = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Fetch isochrone polygons from Mapbox API.

    Returns:
        Tuple(feature_collection, metadata)
    """
    normalized_minutes = _normalize_minutes(contours_minutes)
    if not normalized_minutes:
        normalized_minutes = [10]

    if not access_token or access_token == "your_mapbox_access_token_here":
        logger.warning("Mapbox token missing for isochrone API, using fallback circles")
        fallback = _build_fallback_isochrones(center, profile, normalized_minutes)
        return fallback, {"source": "fallback", "reason": "missing_mapbox_token"}

    lon, lat = center
    params: Dict[str, Any] = {
        "access_token": access_token,
        "contours_minutes": ",".join(str(m) for m in normalized_minutes),
        "polygons": "true" if polygons else "false",
        "denoise": str(max(0.0, min(1.0, denoise))),
    }
    if generalize is not None:
        params["generalize"] = str(max(0.0, float(generalize)))

    url = f"{MAPBOX_ISOCHRONE_URL}/{profile}/{lon},{lat}?{parse.urlencode(params)}"
    timeout = float(os.getenv("ROUTING_TIMEOUT_SECONDS", "10"))

    try:
        http_request = request.Request(url, method="GET")
        with request.urlopen(http_request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw)

        if parsed.get("type") != "FeatureCollection" or not isinstance(parsed.get("features"), list):
            raise ValueError("Invalid Mapbox isochrone payload")

        collection = {
            "type": "FeatureCollection",
            "features": parsed.get("features", []),
        }
        metadata = {
            "source": "mapbox",
            "profile": profile,
            "contours_minutes": normalized_minutes,
            "feature_count": len(collection["features"]),
        }
        return collection, metadata

    except error.HTTPError as exc:
        logger.warning("Mapbox isochrone HTTP error %s: %s", exc.code, exc.reason)
    except error.URLError as exc:
        logger.warning("Mapbox isochrone network error: %s", exc.reason)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Mapbox isochrone error: %s", exc)

    fallback = _build_fallback_isochrones(center, profile, normalized_minutes)
    return fallback, {"source": "fallback", "reason": "mapbox_unavailable"}


def analyze_polygon(
    polygon: Sequence[Sequence[float]],
    access_minutes: int = 10,
    profile: str = "walking",
) -> Dict[str, Any]:
    """
    Build basic urban insights for a drawn polygon.

    This is a lightweight heuristic model intended for fast UI feedback.
    """
    ring = _normalize_ring(polygon)
    area_km2 = polygon_area_km2(ring)
    centroid = polygon_centroid(ring)

    density = float(os.getenv("CITY_POP_DENSITY_PER_KM2", "2900"))
    avg_household = float(os.getenv("CITY_AVG_HOUSEHOLD_SIZE", "2.8"))
    student_ratio = float(os.getenv("CITY_STUDENT_RATIO", "0.18"))

    estimated_population = max(0, int(round(area_km2 * density)))
    estimated_households = max(0, int(round(estimated_population / max(avg_household, 1.0))))
    estimated_students = max(0, int(round(estimated_population * student_ratio)))

    school_capacity = int(float(os.getenv("CITY_SCHOOL_CAPACITY", "900")))
    recommended_new_schools = max(0, int(math.ceil(estimated_students / max(school_capacity, 1))))

    accessibility_factor = {
        "walking": 0.72,
        "cycling": 0.84,
        "driving": 0.91,
    }.get(profile, 0.75)
    adjusted_factor = accessibility_factor * max(0.4, min(1.2, access_minutes / 10.0))
    accessible_population = int(round(estimated_population * min(adjusted_factor, 1.0)))

    recommendations: List[str] = []
    if recommended_new_schools >= 2:
        recommendations.append("Добавить школы или расширить существующие в пределах выделенной зоны")
    if estimated_population > 10_000:
        recommendations.append("Проверить пропускную способность магистралей и общественного транспорта")
    if area_km2 > 2.0:
        recommendations.append("Разбить развитие территории на очереди с отдельной сервисной инфраструктурой")
    if not recommendations:
        recommendations.append("Зона умеренного масштаба: можно запускать локальные пилотные проекты")

    return {
        "area_km2": round(area_km2, 4),
        "centroid": [round(centroid[0], 6), round(centroid[1], 6)],
        "estimated_population": estimated_population,
        "estimated_households": estimated_households,
        "estimated_students": estimated_students,
        "recommended_new_schools": recommended_new_schools,
        "accessible_population_estimate": accessible_population,
        "profile": profile,
        "access_minutes": access_minutes,
        "recommendations": recommendations,
    }


def polygon_area_km2(polygon: Sequence[Sequence[float]]) -> float:
    ring = _normalize_ring(polygon)
    if len(ring) < 4:
        return 0.0

    points_m = _project_to_meters(ring)
    area_m2 = 0.0
    for idx in range(len(points_m) - 1):
        x1, y1 = points_m[idx]
        x2, y2 = points_m[idx + 1]
        area_m2 += x1 * y2 - x2 * y1
    return abs(area_m2) / 2.0 / 1_000_000.0


def polygon_centroid(polygon: Sequence[Sequence[float]]) -> Tuple[float, float]:
    ring = _normalize_ring(polygon)
    if len(ring) < 4:
        first = ring[0] if ring else [0.0, 0.0]
        return float(first[0]), float(first[1])

    points_m = _project_to_meters(ring)
    signed_area = 0.0
    cx = 0.0
    cy = 0.0

    for idx in range(len(points_m) - 1):
        x1, y1 = points_m[idx]
        x2, y2 = points_m[idx + 1]
        cross = x1 * y2 - x2 * y1
        signed_area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross

    signed_area *= 0.5
    if abs(signed_area) < 1e-9:
        first = ring[0]
        return float(first[0]), float(first[1])

    cx /= 6.0 * signed_area
    cy /= 6.0 * signed_area

    mean_lat = math.radians(sum(point[1] for point in ring) / len(ring))
    lat = math.degrees(cy / EARTH_RADIUS_M)
    lon = math.degrees(cx / (EARTH_RADIUS_M * max(math.cos(mean_lat), 1e-6)))
    return lon, lat


def _normalize_minutes(values: Sequence[int]) -> List[int]:
    minutes: List[int] = []
    for value in values:
        try:
            minute = int(value)
        except (TypeError, ValueError):
            continue
        if 1 <= minute <= 60:
            minutes.append(minute)

    unique_sorted = sorted(set(minutes))
    return unique_sorted[:4]


def _normalize_ring(polygon: Sequence[Sequence[float]]) -> List[List[float]]:
    ring: List[List[float]] = []
    for point in polygon:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        lon = float(point[0])
        lat = float(point[1])
        ring.append([lon, lat])

    if not ring:
        return []

    if ring[0] != ring[-1]:
        ring.append([ring[0][0], ring[0][1]])

    return ring


def _project_to_meters(ring: Sequence[Sequence[float]]) -> List[Tuple[float, float]]:
    mean_lat = math.radians(sum(point[1] for point in ring) / len(ring))
    cos_lat = max(math.cos(mean_lat), 1e-6)

    projected: List[Tuple[float, float]] = []
    for lon, lat in ring:
        x = EARTH_RADIUS_M * math.radians(lon) * cos_lat
        y = EARTH_RADIUS_M * math.radians(lat)
        projected.append((x, y))
    return projected


def _build_fallback_isochrones(
    center: Tuple[float, float],
    profile: str,
    contours_minutes: Sequence[int],
) -> Dict[str, Any]:
    lon, lat = center
    speed_kmh = _PROFILE_SPEED_KMH.get(profile, 5.0)

    features: List[Dict[str, Any]] = []
    for minute in contours_minutes:
        radius_km = speed_kmh * (minute / 60.0)
        ring = _circle_ring(lon, lat, radius_km)
        feature = {
            "type": "Feature",
            "properties": {
                "contour": minute,
                "profile": profile,
                "fallback": True,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [ring],
            },
        }
        features.append(feature)

    return {"type": "FeatureCollection", "features": features}


def _circle_ring(center_lon: float, center_lat: float, radius_km: float, steps: int = 72) -> List[List[float]]:
    lat_rad = math.radians(center_lat)
    lon_factor = max(math.cos(lat_rad), 1e-6)

    coords: List[List[float]] = []
    for idx in range(steps + 1):
        angle = (2.0 * math.pi * idx) / steps
        dlat = (radius_km / 111.32) * math.sin(angle)
        dlon = (radius_km / (111.32 * lon_factor)) * math.cos(angle)
        coords.append([center_lon + dlon, center_lat + dlat])
    return coords
