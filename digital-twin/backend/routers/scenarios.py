from fastapi import APIRouter, HTTPException
from models import Scenario, ScenarioCreate, ScenarioUpdate
from typing import List
import uuid
from datetime import datetime

router = APIRouter()

#ранилище сценариев
scenarios_storage = {}

@router.get("", response_model=List[Scenario], include_in_schema=False)
@router.get("/", response_model=List[Scenario])
async def get_scenarios():
    """Получить все сценарии"""
    return list(scenarios_storage.values())

@router.get("/{scenario_id}", response_model=Scenario)
async def get_scenario(scenario_id: str):
    """Получить сценарий по ID"""
    if scenario_id not in scenarios_storage:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return scenarios_storage[scenario_id]

@router.post("", response_model=Scenario, include_in_schema=False)
@router.post("/", response_model=Scenario)
async def create_scenario(scenario: ScenarioCreate):
    """Создать новый сценарий"""
    scenario_id = str(uuid.uuid4())
    new_scenario = Scenario(
        id=scenario_id,
        name=scenario.name,
        description=scenario.description,
        vehicle_ids=scenario.vehicle_ids,
        delivery_point_ids=scenario.delivery_point_ids,
        start_time=scenario.start_time,
        duration_hours=scenario.duration_hours,
        created_at=datetime.now(),
        updated_at=datetime.now()
    )
    scenarios_storage[scenario_id] = new_scenario
    return new_scenario

@router.put("/{scenario_id}", response_model=Scenario)
async def update_scenario(scenario_id: str, scenario: ScenarioUpdate):
    """Обновить сценарий"""
    if scenario_id not in scenarios_storage:
        raise HTTPException(status_code=404, detail="Scenario not found")
    
    existing = scenarios_storage[scenario_id]
    update_data = scenario.dict(exclude_unset=True)
    updated_scenario = existing.copy(update=update_data)
    updated_scenario.updated_at = datetime.now()
    
    scenarios_storage[scenario_id] = updated_scenario
    return updated_scenario

@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str):
    """Удалить сценарий"""
    if scenario_id not in scenarios_storage:
        raise HTTPException(status_code=404, detail="Scenario not found")
    del scenarios_storage[scenario_id]
    return {"message": "Scenario deleted"}

def get_scenarios_storage():
    return scenarios_storage
