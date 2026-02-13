import math
import re
import uuid
from datetime import timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException

from models import DeliveryPoint, Location, SimulationRequest, SimulationResponse, SimulationStep, Vehicle
from .objects import get_storage

router = APIRouter()

# хранилище симуляций
simulations_storage: Dict[str, SimulationResponse] = {}

OBJECT_TYPE_ALIASES = {
    "park": "park",
    "парк": "park",
    "school": "school",
    "школа": "school",
    "factory": "factory",
    "завод": "factory",
    "residential": "residential",
    "жилой": "residential",
    "жилой_район": "residential",
    "bridge": "bridge",
    "мост": "bridge",
}

OBJECT_IMPACT = {
    "park": {"ecology": 12.0, "traffic_load": -4.0, "social_score": 10.0},
    "school": {"ecology": -2.0, "traffic_load": 6.0, "social_score": 12.0},
    "factory": {"ecology": -20.0, "traffic_load": 15.0, "social_score": 5.0},
    "residential": {"ecology": -6.0, "traffic_load": 10.0, "social_score": 14.0},
    "bridge": {"ecology": -3.0, "traffic_load": -12.0, "social_score": 7.0},
}

BRIDGE_RE = re.compile(r"мост|bridge", re.IGNORECASE)
ALLOWED_STATUSES = {"idle", "moving", "loading", "unloading", "completed"}


def normalize_vehicle_status(status: str) -> str:
    status_normalized = str(status or "").strip().lower()
    if status_normalized in ALLOWED_STATUSES:
        return status_normalized
    return "idle"


def analyze_city_state(vehicles: List[Vehicle], delivery_points: List[DeliveryPoint]) -> Dict[str, float]:
    """Агрегировать состояние города по текущему набору транспорта и точек."""
    total_vehicles = len(vehicles)
    moving_count = sum(1 for vehicle in vehicles if normalize_vehicle_status(vehicle.status) == "moving")
    idle_count = sum(1 for vehicle in vehicles if normalize_vehicle_status(vehicle.status) == "idle")

    total_capacity = sum(max(0.0, vehicle.capacity) for vehicle in vehicles)
    total_demand = sum(max(0.0, point.demand) for point in delivery_points)
    demand_coverage = min(total_capacity / total_demand, 1.0) if total_demand > 0 else 1.0

    traffic_load = (moving_count / total_vehicles) * 100 if total_vehicles > 0 else 0.0
    ecology = max(0.0, 100.0 - traffic_load * 0.55)
    social_score = min(
        100.0,
        demand_coverage * 70 + ((idle_count / total_vehicles) * 30 if total_vehicles > 0 else 0.0),
    )

    return {
        "ecology": round(ecology, 2),
        "traffic_load": round(traffic_load, 2),
        "social_score": round(social_score, 2),
    }


def _select_bridge(delivery_points: List[DeliveryPoint], bridge_id: Optional[str]) -> Optional[DeliveryPoint]:
    if bridge_id:
        by_id = next((point for point in delivery_points if point.id == bridge_id), None)
        if by_id:
            return by_id

    by_name = next(
        (point for point in delivery_points if BRIDGE_RE.search(str(point.name or ""))),
        None,
    )
    return by_name


def build_transport_snapshot(bridge_id: Optional[str] = None) -> Dict[str, object]:
    """Сводка транспортной нагрузки по текущему состоянию хранилища."""
    storage = get_storage()
    vehicles: List[Vehicle] = storage.get("vehicles", [])
    delivery_points: List[DeliveryPoint] = storage.get("delivery_points", [])
    bridge = _select_bridge(delivery_points, bridge_id)

    total_vehicles = len(vehicles)
    moving_count = sum(1 for vehicle in vehicles if normalize_vehicle_status(vehicle.status) == "moving")
    idle_count = sum(1 for vehicle in vehicles if normalize_vehicle_status(vehicle.status) == "idle")
    completed_count = sum(1 for vehicle in vehicles if normalize_vehicle_status(vehicle.status) == "completed")

    moving_ratio = moving_count / total_vehicles if total_vehicles > 0 else 0.0
    total_capacity = sum(max(0.0, vehicle.capacity) for vehicle in vehicles)
    average_capacity = (total_capacity / total_vehicles) if total_vehicles > 0 else 0.0

    base_flow = round(85 + total_vehicles * 14 + moving_ratio * 180)
    detour_increase = round(18 + moving_ratio * 28 + min(total_vehicles, 20) * 0.7)
    if bridge is None:
        detour_increase = max(8, detour_increase - 6)
    detour_increase = int(min(70, max(8, detour_increase)))

    if moving_ratio >= 0.75:
        congestion_level = "high"
    elif moving_ratio >= 0.4:
        congestion_level = "medium"
    else:
        congestion_level = "low"

    city_metrics = analyze_city_state(vehicles, delivery_points)

    return {
        "bridge_id": bridge.id if bridge else (bridge_id or "unknown-bridge"),
        "bridge_name": bridge.name if bridge else "Мост",
        "base_flow_vehicles_per_hour": int(max(0, base_flow)),
        "detour_increase_percent": detour_increase,
        "estimated_delay_minutes": int(round(detour_increase * 0.65)),
        "congestion_level": congestion_level,
        "total_vehicles": total_vehicles,
        "moving_vehicles": moving_count,
        "idle_vehicles": idle_count,
        "completed_vehicles": completed_count,
        "total_capacity": round(total_capacity, 2),
        "average_capacity": round(average_capacity, 2),
        "moving_ratio_percent": round(moving_ratio * 100, 2),
        "city_metrics": city_metrics,
    }


@router.get("/transport/overview")
async def get_transport_overview(bridge_id: Optional[str] = None) -> Dict[str, object]:
    return build_transport_snapshot(bridge_id)


@router.get("/impact")
async def get_object_impact(object_type: str) -> Dict[str, object]:
    """Оценить влияние нового объекта на метрики города."""
    normalized_type = OBJECT_TYPE_ALIASES.get(object_type.strip().lower())
    if not normalized_type:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unknown object type. Supported: park/school/factory/residential/bridge "
                "(или парк/школа/завод/жилой_район/мост)"
            ),
        )

    impact = OBJECT_IMPACT[normalized_type]
    ecology_delta = impact["ecology"]

    if ecology_delta < 0:
        ecology_message = f"Если вы это построите, экология упадет на {abs(ecology_delta):.0f}%."
    elif ecology_delta > 0:
        ecology_message = f"Если вы это построите, экология вырастет на {ecology_delta:.0f}%."
    else:
        ecology_message = "Если вы это построите, экология не изменится."

    return {
        "object_type": normalized_type,
        "message": ecology_message,
        "impact": {
            "ecology": impact["ecology"],
            "traffic_load": impact["traffic_load"],
            "social_score": impact["social_score"],
        },
    }


def _route_index_for_hour(route_length: int, hour: int, duration_hours: int) -> int:
    if route_length <= 1:
        return 0
    if duration_hours <= 1:
        return route_length - 1
    progress = hour / (duration_hours - 1)
    return min(route_length - 1, max(0, int(progress * (route_length - 1))))


@router.post("/run", response_model=SimulationResponse)
async def run_simulation(request: SimulationRequest):
    """Запустить симуляцию доставки без мутаций входных данных."""
    if request.duration_hours <= 0:
        raise HTTPException(status_code=400, detail="duration_hours must be greater than 0")

    simulation_id = str(uuid.uuid4())
    steps: List[SimulationStep] = []
    total_distance = 0.0
    current_time = request.start_time

    simulated_vehicles = [vehicle.copy(deep=True) for vehicle in request.vehicles]
    last_locations = {
        vehicle.id: vehicle.current_location.copy(deep=True) for vehicle in simulated_vehicles
    }

    for hour in range(request.duration_hours):
        step_vehicles: List[Vehicle] = []

        for vehicle in simulated_vehicles:
            next_vehicle = vehicle.copy(deep=True)
            route = list(next_vehicle.route or [])

            if route:
                route_index = _route_index_for_hour(len(route), hour, request.duration_hours)
                new_location = route[route_index]

                previous_location = last_locations.get(next_vehicle.id, next_vehicle.current_location)
                total_distance += calculate_distance(previous_location, new_location)

                next_vehicle.current_location = new_location
                next_vehicle.status = "moving" if route_index < len(route) - 1 else "completed"
                last_locations[next_vehicle.id] = new_location
            else:
                normalized_status = normalize_vehicle_status(next_vehicle.status)
                next_vehicle.status = "idle" if normalized_status == "moving" else normalized_status

            step_vehicles.append(next_vehicle)

        moving_count = sum(1 for vehicle in step_vehicles if vehicle.status == "moving")
        completed_count = sum(1 for vehicle in step_vehicles if vehicle.status == "completed")
        idle_count = sum(1 for vehicle in step_vehicles if vehicle.status == "idle")

        city_state = analyze_city_state(step_vehicles, request.delivery_points)
        metrics = {
            "hour": hour,
            "total_distance": round(total_distance, 2),
            "vehicles_moving": moving_count,
            "vehicles_completed": completed_count,
            "vehicles_idle": idle_count,
            "ecology": city_state["ecology"],
            "traffic_load": city_state["traffic_load"],
            "social_score": city_state["social_score"],
        }

        steps.append(
            SimulationStep(
                timestamp=current_time + timedelta(hours=hour),
                vehicles=step_vehicles,
                metrics=metrics,
            )
        )
        simulated_vehicles = [vehicle.copy(deep=True) for vehicle in step_vehicles]

    total_capacity = sum(max(0.0, vehicle.capacity) for vehicle in request.vehicles)
    total_demand = sum(max(0.0, point.demand) for point in request.delivery_points)
    if total_demand > 0:
        efficiency = min(total_capacity / total_demand, 1.0) * 100
    else:
        efficiency = 100.0 if total_capacity > 0 else 0.0

    response = SimulationResponse(
        simulation_id=simulation_id,
        steps=steps,
        total_distance=round(total_distance, 2),
        total_time=request.duration_hours,
        efficiency=round(efficiency, 2),
    )

    simulations_storage[simulation_id] = response
    return response


@router.get("/results/{simulation_id}", response_model=SimulationResponse)
async def get_simulation_results(simulation_id: str):
    """Получить результаты симуляции."""
    if simulation_id not in simulations_storage:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return simulations_storage[simulation_id]


@router.get("/results", response_model=List[SimulationResponse])
async def get_all_simulations():
    """Получить все результаты симуляций."""
    return list(simulations_storage.values())


@router.delete("/results/{simulation_id}")
async def delete_simulation(simulation_id: str):
    """Удалить результаты симуляции."""
    if simulation_id not in simulations_storage:
        raise HTTPException(status_code=404, detail="Simulation not found")
    del simulations_storage[simulation_id]
    return {"message": "Simulation deleted"}


def calculate_distance(loc1: Location, loc2: Location) -> float:
    """Формула для расчета расстояния между координатами в км."""
    radius_km = 6371.0

    lat1, lon1 = math.radians(loc1.lat), math.radians(loc1.lng)
    lat2, lon2 = math.radians(loc2.lat), math.radians(loc2.lng)

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return radius_km * c
