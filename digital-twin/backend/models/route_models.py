"""
Pydantic models for route optimization API.
"""

from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


class RouteOptimizationRequest(BaseModel):
    """Request model for route optimization endpoint."""

    origin: Tuple[float, float] = Field(
        ...,
        description="Origin coordinates [longitude, latitude]",
        example=[82.61, 49.95],
    )
    destination: Tuple[float, float] = Field(
        ...,
        description="Destination coordinates [longitude, latitude]",
        example=[82.70, 50.05],
    )
    transport_mode: str = Field(
        default="driving",
        description="Transport mode (driving, walking, public_transport)",
    )
    include_traffic_prediction: bool = Field(
        default=True,
        description="Whether to include ML traffic predictions",
    )
    use_ai_recommendation: bool = Field(
        default=True,
        description="Whether to get Grok AI recommendation",
    )

    class Config:
        from_attributes = True


class TrafficPrediction(BaseModel):
    """Traffic prediction for a route."""

    predicted_level: str = Field(
        ...,
        description="Traffic level: low, medium, high, or severe",
    )
    confidence: float = Field(
        ...,
        description="Prediction confidence (0-1 scale)",
        ge=0.0,
        le=1.0,
    )
    estimated_delay_minutes: float = Field(
        ...,
        description="Estimated traffic delay in minutes",
    )

    class Config:
        from_attributes = True


class RouteDetail(BaseModel):
    """Detailed information about a single route."""

    route_id: str = Field(..., description="Unique route identifier")
    distance_km: float = Field(..., description="Route distance in kilometers")
    duration_minutes: float = Field(
        ...,
        description="Base duration in minutes (without traffic)",
    )
    duration_with_traffic_minutes: float = Field(
        ...,
        description="Duration including predicted traffic delays",
    )
    traffic_prediction: TrafficPrediction = Field(
        ...,
        description="ML traffic prediction for this route",
    )
    geometry: List[List[float]] = Field(
        ...,
        description="Route geometry as [[lon, lat], ...] coordinates",
    )
    summary: str = Field(..., description="Human-readable route summary")

    class Config:
        from_attributes = True


class RouteOptimizationResponse(BaseModel):
    """Response model for route optimization endpoint."""

    routes: List[RouteDetail] = Field(
        ...,
        description="List of route alternatives with predictions",
    )
    ai_recommendation: Optional[str] = Field(
        None,
        description="Grok AI's route recommendation and analysis (Russian)",
    )
    recommended_route_index: int = Field(
        ...,
        description="Index of the recommended route in the routes array",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata about the optimization",
    )

    class Config:
        from_attributes = True
