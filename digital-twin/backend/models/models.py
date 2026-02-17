from datetime import datetime
import re
from pydantic import BaseModel, Field, validator


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
