from datetime import datetime
import hashlib
import uuid

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from routers import objects, scenarios, simulation
import uvicorn
import uvicorn
from models.models import UserRegisterRequest, UserRegisterResponse
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


users_storage = {}


@app.post(
    "/api/auth/register",
    response_model=UserRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_user(payload: UserRegisterRequest):
    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match",
        )

    username_taken = any(
        user["username"].lower() == payload.username.lower()
        for user in users_storage.values()
    )
    if username_taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    email_taken = any(user["email"] == payload.email for user in users_storage.values())
    if email_taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already exists",
        )

    user_id = str(uuid.uuid4())
    created_at = datetime.utcnow()
    password_hash = hashlib.sha256(payload.password.encode("utf-8")).hexdigest()

    users_storage[user_id] = {
        "id": user_id,
        "username": payload.username,
        "email": payload.email,
        "password_hash": password_hash,
        "created_at": created_at,
    }

    return UserRegisterResponse(
        id=user_id,
        username=payload.username,
        email=payload.email,
        created_at=created_at,
    )
