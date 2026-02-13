from sqlalchemy import Column, String, Float, JSON, DateTime
from database import Base
import datetime

class VehicleDB(Base):
    __tablename__ = "vehicles"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    capacity = Column(Float)
    # Хранит объект {'lat': 0.0, 'lng': 0.0}
    current_location = Column(JSON) 
    status = Column(String, default="idle")
    # Хранит список объектов [{'lat': 0.0, 'lng': 0.0}, ...]
    route = Column(JSON, default=[])

class DeliveryPointDB(Base):
    __tablename__ = "delivery_points"

    id = Column(String, primary_key=True, index=True)
    name = Column(String)
    location = Column(JSON)
    demand = Column(Float)
    time_window_start = Column(String, nullable=True)
    time_window_end = Column(String, nullable=True)

class SimulationResultDB(Base):
    __tablename__ = "simulation_results"

    id = Column(String, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    total_distance = Column(Float)
    total_time = Column(Float)
    efficiency = Column(Float)
    # Хранит весь массив SimulationStep (включая вложенные метрики и транспорт)
    steps_data = Column(JSON)