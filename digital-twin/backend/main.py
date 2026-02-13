from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import objects, scenarios, simulation
import uvicorn
import uvicorn
app = FastAPI(title="HOG maps Backend api")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(objects.router, prefix="/api/objects", tags=["Objects"])
app.include_router(scenarios.router, prefix="/api/scenarios", tags=["Scenarios"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["Simulation"])    
