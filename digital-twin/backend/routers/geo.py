"""Geo router for isochrones and polygon insights."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Literal, Sequence, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.geo import analyze_polygon, fetch_isochrones

router = APIRouter()


class IsochroneRequest(BaseModel):
    center: Tuple[float, float] = Field(
        ...,
        description="Center coordinates [longitude, latitude]",
        example=[82.61, 49.95],
    )
    profile: Literal["walking", "cycling", "driving"] = Field(
        default="walking",
        description="Isochrone profile",
    )
    contours_minutes: List[int] = Field(
        default_factory=lambda: [10],
        description="List of minute contours (1..60)",
    )
    polygons: bool = Field(default=True)
    denoise: float = Field(default=1.0, ge=0.0, le=1.0)
    generalize: float | None = Field(default=None, ge=0.0)


class IsochroneResponse(BaseModel):
    type: str = "FeatureCollection"
    features: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PolygonInsightsRequest(BaseModel):
    polygon: List[List[float]] = Field(
        ...,
        description="Polygon ring coordinates [[lon,lat], ...]",
    )
    access_minutes: int = Field(default=10, ge=1, le=60)
    profile: Literal["walking", "cycling", "driving"] = Field(default="walking")


class PolygonInsightsResponse(BaseModel):
    area_km2: float
    centroid: List[float]
    estimated_population: int
    estimated_households: int
    estimated_students: int
    recommended_new_schools: int
    accessible_population_estimate: int
    profile: str
    access_minutes: int
    recommendations: List[str]


@router.post("/isochrone", response_model=IsochroneResponse)
def build_isochrone(payload: IsochroneRequest):
    _validate_coordinates(payload.center, "center")

    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    collection, metadata = fetch_isochrones(
        center=payload.center,
        profile=payload.profile,
        contours_minutes=payload.contours_minutes,
        access_token=token,
        polygons=payload.polygons,
        denoise=payload.denoise,
        generalize=payload.generalize,
    )

    return IsochroneResponse(
        type="FeatureCollection",
        features=collection.get("features", []),
        metadata=metadata,
    )


@router.post("/polygon-insights", response_model=PolygonInsightsResponse)
def polygon_insights(payload: PolygonInsightsRequest):
    if len(payload.polygon) < 3:
        raise HTTPException(status_code=400, detail="Polygon must contain at least 3 points")

    _validate_polygon(payload.polygon)

    result = analyze_polygon(
        polygon=payload.polygon,
        access_minutes=payload.access_minutes,
        profile=payload.profile,
    )
    return PolygonInsightsResponse(**result)


def _validate_coordinates(coords: Tuple[float, float], name: str):
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


def _validate_polygon(polygon: Sequence[Sequence[float]]) -> None:
    for idx, point in enumerate(polygon):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise HTTPException(status_code=400, detail=f"Invalid polygon point at index {idx}")
        lon = float(point[0])
        lat = float(point[1])
        _validate_coordinates((lon, lat), f"polygon[{idx}]")
