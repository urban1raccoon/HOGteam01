from datetime import datetime
import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, validator

InfluencePointType = Literal[
    "park",
    "school",
    "factory",
    "residential",
    "bridge",
    "vehicle",
    "delivery_point",
    "warehouse",
]


class Location(BaseModel):
    lat: float = Field(..., description="Широта")
    lng: float = Field(..., description="Долгота")

    class Config:
        from_attributes = True


class MapPoint(BaseModel):
    id: str
    location: Location
    name: str
    type: InfluencePointType
    properties: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        from_attributes = True


class Vehicle(BaseModel):
    id: str
    name: str
    capacity: float
    current_location: Location
    status: str = "idle"  # idle, moving, loading, unloading
    route: List[Location] = Field(default_factory=list)

    class Config:
        from_attributes = True


class DeliveryPoint(BaseModel):
    id: str
    name: str
    location: Location
    demand: float
    time_window_start: Optional[str] = None
    time_window_end: Optional[str] = None

    class Config:
        from_attributes = True


class SimulationMetrics(BaseModel):
    ecology: float = Field(..., description="Экология")
    traffic: float = Field(..., description="Трафик")
    social: float = Field(..., description="Социалка")

    class Config:
        from_attributes = True


class SimulationStep(BaseModel):
    timestamp: datetime
    vehicles: List[Vehicle]
    metrics: Dict[str, Any]

    class Config:
        from_attributes = True


class SimulationRequest(BaseModel):
    vehicles: List[Vehicle]
    delivery_points: List[DeliveryPoint]
    start_time: datetime
    duration_hours: int = 8

    class Config:
        from_attributes = True


class SimulationResponse(BaseModel):
    simulation_id: str
    steps: List[SimulationStep]
    total_distance: float
    total_time: float
    efficiency: float

    class Config:
        from_attributes = True

class UserRegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., min_length=5, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str = Field(
        ..., min_length=8, max_length=128, alias="confirmPassword"
    )

    @validator("username")
    def validate_username(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", value):
            raise ValueError(
                "username can contain only letters, numbers, dot, underscore and dash"
            )
        return value

    @validator("email")
    def validate_email(cls, value: str) -> str:
        if "@" not in value or value.count("@") != 1:
            raise ValueError("invalid email format")
        return value.lower()

    class Config:
        allow_population_by_field_name = True


class UserRegisterResponse(BaseModel):
    id: str
    username: str
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserLoginRequest(BaseModel):
    login: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)

    @validator("login")
    def normalize_login(cls, value: str) -> str:
        return value.strip().lower()


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRegisterResponse
