from fastapi import APIRouter, HTTPException
from models import SimulationRequest, SimulationResponse, SimulationStep, Vehicle, Location
from objects import get_storage
from scenarios import get_scenarios_storage
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import math

router = APIRouter()

# хранилище симуляций
simulations_storage = {}

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
                    
                    # Расчет пройденного расстояния
                    if hour > 0:
                        dist = calculate_distance(vehicle.current_location, new_location)
                        total_distance += dist
                    
                    vehicle.current_location = new_location
                    vehicle.status = "moving" if route_index < len(vehicle.route) - 1 else "completed"
                else:
                    vehicle.status = "completed"
            
            step_vehicles.append(vehicle.copy())
        
        # метрики шага
        metrics = {
            "hour": hour,
            "total_distance": round(total_distance, 2),
            "vehicles_moving": sum(1 for v in step_vehicles if v.status == "moving"),
            "vehicles_completed": sum(1 for v in step_vehicles if v.status == "completed"),
            "vehicles_idle": sum(1 for v in step_vehicles if v.status == "idle")
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
    """Формула гаверсинуса для расчета расстояния между координатами в км"""
    R = 6371  # радиус Земли в км
    
    lat1, lon1 = math.radians(loc1.lat), math.radians(loc1.lng)
    lat2, lon2 = math.radians(loc2.lat), math.radians(loc2.lng)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c
