from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class Location(BaseModel):
    lat: float = Field(..., description="Широта")
    lng: float = Field(..., description="Долгота")

class MapPoint(BaseModel):
    id: str
    location: Location
    name: str
    type: str  # "warehouse", "delivery_point", "vehicle"
    properties: dict = {}

class Vehicle(BaseModel):
    id: str
    name: str
    capacity: float
    current_location: Location
    status: str = "idle"  # idle, moving, loading, unloading
    route: List[Location] = []

class DeliveryPoint(BaseModel):
    id: str
    name: str
    location: Location
    demand: float
    time_window_start: Optional[str] = None
    time_window_end: Optional[str] = None

class SimulationStep(BaseModel):
    timestamp: datetime
    vehicles: List[Vehicle]
    metrics: dict

class SimulationRequest(BaseModel):
    vehicles: List[Vehicle]
    delivery_points: List[DeliveryPoint]
    start_time: datetime
    duration_hours: int = 8

class SimulationResponse(BaseModel):
    simulation_id: str
    steps: List[SimulationStep]
    total_distance: float
    total_time: float
    efficiency: float
class ScenarioCreate(BaseModel):
    name: str
    description: Optional[str] = None
    vehicle_ids: List[str]
    delivery_point_ids: List[str]
    start_time: datetime
    duration_hours: int = 8

class Scenario(ScenarioCreate):
    id: str
    created_at: datetime
    updated_at: datetime

class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    vehicle_ids: Optional[List[str]] = None
    delivery_point_ids: Optional[List[str]] = None
    start_time: Optional[datetime] = None
    duration_hours: Optional[int] = None            
class Park(BaseModel)  :
    id: str
    name: str
    location: Location
    capacity: int   