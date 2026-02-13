from fastapi import APIRouter, HTTPException
from models import Vehicle, DeliveryPoint, MapPoint, Location
from typing import List
import uuid

router = APIRouter()

# хранилище на пока
storage = {
    "vehicles": [],
    "delivery_points": [],
    "warehouses": []
}

@router.get("/map/all", response_model=List[MapPoint])
async def get_all_map_objects():
    """Получить все объекты на карте"""
    points = []
    
    # транспорт
    for vehicle in storage["vehicles"]:
        points.append(MapPoint(
            id=vehicle.id,
            location=vehicle.current_location,
            name=vehicle.name,
            type="vehicle",
            properties={"capacity": vehicle.capacity, "status": vehicle.status}
        ))
    
    # точки доставки
    for dp in storage["delivery_points"]:
        points.append(MapPoint(
            id=dp.id,
            location=dp.location,
            name=dp.name,
            type="delivery_point",
            properties={"demand": dp.demand}
        ))
    
    return points

#VEHICLES

@router.get("/vehicles", response_model=List[Vehicle])
async def get_vehicles():
    """Получить все транспортные средства"""
    return storage["vehicles"]

@router.get("/vehicles/{vehicle_id}", response_model=Vehicle)
async def get_vehicle(vehicle_id: str):
    """Получить транспорт по ID"""
    vehicle = next((v for v in storage["vehicles"] if v.id == vehicle_id), None)
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle

@router.post("/vehicles", response_model=Vehicle)
async def create_vehicle(vehicle: Vehicle):
    """Создать новое транспортное средство"""
    if not vehicle.id:
        vehicle.id = f"vehicle-{uuid.uuid4()}"
    storage["vehicles"].append(vehicle)
    return vehicle

@router.put("/vehicles/{vehicle_id}", response_model=Vehicle)
async def update_vehicle(vehicle_id: str, vehicle: Vehicle):
    """Обновить транспортное средство"""
    idx = next((i for i, v in enumerate(storage["vehicles"]) if v.id == vehicle_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    vehicle.id = vehicle_id
    storage["vehicles"][idx] = vehicle
    return vehicle

@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str):
    """Удалить транспортное средство"""
    storage["vehicles"] = [v for v in storage["vehicles"] if v.id != vehicle_id]
    return {"message": "Vehicle deleted"}

#DELIVERY POINTS

@router.get("/delivery-points", response_model=List[DeliveryPoint])
async def get_delivery_points():
    """Получить все точки доставки"""
    return storage["delivery_points"]

@router.get("/delivery-points/{point_id}", response_model=DeliveryPoint)
async def get_delivery_point(point_id: str):
    """Получить точку доставки по ID"""
    point = next((p for p in storage["delivery_points"] if p.id == point_id), None)
    if not point:
        raise HTTPException(status_code=404, detail="Delivery point not found")
    return point

@router.post("/delivery-points", response_model=DeliveryPoint)
async def create_delivery_point(point: DeliveryPoint):
    """Создать новую точку доставки"""
    if not point.id:
        point.id = f"dp-{uuid.uuid4()}"
    storage["delivery_points"].append(point)
    return point

@router.put("/delivery-points/{point_id}", response_model=DeliveryPoint)
async def update_delivery_point(point_id: str, point: DeliveryPoint):
    """Обновить точку доставки"""
    idx = next((i for i, p in enumerate(storage["delivery_points"]) if p.id == point_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Delivery point not found")
    point.id = point_id
    storage["delivery_points"][idx] = point
    return point

@router.delete("/delivery-points/{point_id}")
async def delete_delivery_point(point_id: str):
    """Удалить точку доставки"""
    storage["delivery_points"] = [p for p in storage["delivery_points"] if p.id != point_id]
    return {"message": "Delivery point deleted"}

# ункция для доступа к storage из других модулей
def get_storage():
    return storage
