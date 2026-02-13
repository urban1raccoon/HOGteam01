from fastapi import APIRouter, HTTPException
from models import SimulationRequest, SimulationResponse, SimulationStep, Vehicle, Location
from .objects import get_storage
from .scenarios import get_scenarios_storage
from typing import Dict, List
import uuid
from datetime import timedelta
import math

router = APIRouter()

# хранилище симуляций
simulations_storage = {}
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

def analyze_city_state(objects: dict) -> dict:
    """Агрегировать состояние города по текущему storage."""
    vehicles = objects.get("vehicles", [])
    delivery_points = objects.get("delivery_points", [])

    total_vehicles = len(vehicles)
    moving_count = sum(1 for v in vehicles if v.status == "moving")
    idle_count = sum(1 for v in vehicles if v.status == "idle")

    total_capacity = sum(v.capacity for v in vehicles)
    total_demand = sum(dp.demand for dp in delivery_points)
    demand_coverage = min(total_capacity / total_demand, 1.0) if total_demand > 0 else 1.0

    traffic_load = (moving_count / total_vehicles) * 100 if total_vehicles > 0 else 0.0
    ecology = max(0.0, 100.0 - traffic_load * 0.6)
    social_score = min(100.0, demand_coverage * 70 + (idle_count / total_vehicles * 30 if total_vehicles > 0 else 0.0))

    return {
        "ecology": round(ecology, 2),
        "traffic_load": round(traffic_load, 2),
        "social_score": round(social_score, 2),
    }

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

@router.post("/run", response_model=SimulationResponse)
async def run_simulation(request: SimulationRequest):
    """Запустить симуляцию доставки"""
    simulation_id = str(uuid.uuid4())
    
    steps = []
    total_distance = 0.0
    current_time = request.start_time
    
    # симуляция по часам
    for hour in range(request.duration_hours):
        step_vehicles = []
        
        for vehicle in request.vehicles:
            if vehicle.route and len(vehicle.route) > 0:
                # прогресс по маршруту
                progress = hour / max(request.duration_hours, 1)
                route_index = int(progress * len(vehicle.route))
                
                if route_index < len(vehicle.route):
                    new_location = vehicle.route[route_index]
                    
                    # расчитать расстояние 
                    if hour > 0:
                        dist = calculate_distance(vehicle.current_location, new_location)
                        total_distance += dist
                    
                    vehicle.current_location = new_location
                    vehicle.status = "moving" if route_index < len(vehicle.route) - 1 else "completed"
                else:
                    vehicle.status = "completed"
            
            step_vehicles.append(vehicle.copy())
        
        # метрики шага
        moving_count = sum(1 for v in step_vehicles if v.status == "moving")
        completed_count = sum(1 for v in step_vehicles if v.status == "completed")
        idle_count = sum(1 for v in step_vehicles if v.status == "idle")
        city_state = analyze_city_state(get_storage())
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
        
        steps.append(SimulationStep(
            timestamp=current_time + timedelta(hours=hour),
            vehicles=step_vehicles,
            metrics=metrics
        ))
    
    # эффективностб
    total_capacity = sum(v.capacity for v in request.vehicles)
    total_demand = sum(dp.demand for dp in request.delivery_points)
    efficiency = min(total_demand / total_capacity if total_capacity > 0 else 0, 1.0) * 100
    
    response = SimulationResponse(
        simulation_id=simulation_id,
        steps=steps,
        total_distance=round(total_distance, 2),
        total_time=request.duration_hours,
        efficiency=round(efficiency, 2)
    )
    
    simulations_storage[simulation_id] = response
    return response

@router.post("/run-scenario/{scenario_id}", response_model=SimulationResponse)
async def run_scenario_simulation(scenario_id: str):
    """Запустить симуляцию на основе сценария"""
    scenarios = get_scenarios_storage()
    
    if scenario_id not in scenarios:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    scenario = scenarios[scenario_id]
    storage = get_storage()
    
    # получаем объекты из сценария
    vehicles = [v for v in storage["vehicles"] if v.id in scenario.vehicle_ids]
    delivery_points = [dp for dp in storage["delivery_points"] if dp.id in scenario.delivery_point_ids]
    
    if not vehicles:
        raise HTTPException(status_code=400, detail="No vehicles found for scenario")
    if not delivery_points:
        raise HTTPException(status_code=400, detail="No delivery points found for scenario")
    
    # создаем запрос симуляции
    request = SimulationRequest(
        vehicles=vehicles,
        delivery_points=delivery_points,
        start_time=scenario.start_time,
        duration_hours=scenario.duration_hours
    )
    
    return await run_simulation(request)

@router.get("/results/{simulation_id}", response_model=SimulationResponse)
async def get_simulation_results(simulation_id: str):
    """Получить результаты симуляции"""
    if simulation_id not in simulations_storage:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return simulations_storage[simulation_id]

@router.get("/results", response_model=List[SimulationResponse])
async def get_all_simulations():
    """Получить все результаты симуляций"""
    return list(simulations_storage.values())

@router.delete("/results/{simulation_id}")
async def delete_simulation(simulation_id: str):
    """Удалить результаты симуляции"""
    if simulation_id not in simulations_storage:
        raise HTTPException(status_code=404, detail="Simulation not found")
    del simulations_storage[simulation_id]
    return {"message": "Simulation deleted"}

def calculate_distance(loc1: Location, loc2: Location) -> float:
    """Формула для расчета расстояния между координатами в км"""
    R = 6371  # радиус Земли в км
    
    lat1, lon1 = math.radians(loc1.lat), math.radians(loc1.lng)
    lat2, lon2 = math.radians(loc2.lat), math.radians(loc2.lng)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c
