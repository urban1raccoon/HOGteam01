from datetime import datetime
import base64
import hashlib
import hmac
import json
import os
import time
import uuid

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import orm
from models.models import (
    AuthTokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserRegisterResponse,
)
from routers import ai, objects, simulation

app = FastAPI(title="HOG maps Backend api")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(objects.router, prefix="/api/objects", tags=["Objects"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["Simulation"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])

TOKEN_TTL_SECONDS = 60 * 60 * 24
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-me-in-production")


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"status": "ok", "docs": "/docs"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> Response:
    # Frontend favicon is not served by this backend app.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.on_event("startup")
def create_tables() -> None:
    Base.metadata.create_all(bind=engine)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    iterations = 200_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    salt_b64 = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_b64 = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt_b64}${digest_b64}"


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, iterations_str, salt_b64, digest_b64 = encoded_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_str)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual_digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(actual_digest, expected_digest)


def b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("ascii"))


def create_access_token(user_id: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS}

    header_segment = b64url_encode(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    )
    payload_segment = b64url_encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    signature = hmac.new(
        AUTH_SECRET.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    signature_segment = b64url_encode(signature)

    return f"{header_segment}.{payload_segment}.{signature_segment}"

class unauthorized(Exception):
    def __init__(self, message):
        self.message = message

    def __str__(self):
        raise NotImplementedError

    def some_method(self, *args, **kwargs):
        raise NotImplementedError


def decode_access_token(token: str) -> str:
    try:
        header_segment, payload_segment, signature_segment = token.split(".", 2)
    except ValueError as exc:
        raise unauthorized("Invalid token format") from exc

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(
        AUTH_SECRET.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    actual_signature = b64url_decode(signature_segment)

    if not hmac.compare_digest(expected_signature, actual_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token signature",
        )

    try:
        payload = json.loads(b64url_decode(payload_segment).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        ) from exc

    exp = payload.get("exp")
    sub = payload.get("sub")
    if not isinstance(exp, int) or exp < int(time.time()) or not isinstance(sub, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired or invalid",
        )

    return sub


def get_current_user(
    db: Session = Depends(get_db), authorization: str | None = Header(default=None)
) -> orm.UserDB:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    token = authorization.split(" ", 1)[1].strip()
    user_id = decode_access_token(token)

    user = db.query(orm.UserDB).filter(orm.UserDB.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


@app.post(
    "/api/auth/register",
    response_model=UserRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_user(payload: UserRegisterRequest, db: Session = Depends(get_db)):
    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match",
        )

    username_taken = (
        db.query(orm.UserDB)
        .filter(func.lower(orm.UserDB.username) == payload.username.lower())
        .first()
        is not None
    )
    if username_taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already exists",
        )

    email_taken = (
        db.query(orm.UserDB)
        .filter(func.lower(orm.UserDB.email) == payload.email.lower())
        .first()
        is not None
    )
    if email_taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already exists",
        )

    user = orm.UserDB(
        id=str(uuid.uuid4()),
        username=payload.username,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        created_at=datetime.utcnow(),
    )
    db.add(user)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already exists",
        ) from exc

    db.refresh(user)

    return UserRegisterResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        created_at=user.created_at,
    )


@app.post("/api/auth/login", response_model=AuthTokenResponse)
def login_user(payload: UserLoginRequest, db: Session = Depends(get_db)):
    user = (
        db.query(orm.UserDB)
        .filter(
            or_(
                func.lower(orm.UserDB.username) == payload.login,
                func.lower(orm.UserDB.email) == payload.login,
            )
        )
        .first()
    )

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid login or password",
        )

    return AuthTokenResponse(
        access_token=create_access_token(user.id),
        user=UserRegisterResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            created_at=user.created_at,
        ),
    )


@app.get("/api/auth/me", response_model=UserRegisterResponse)
def auth_me(current_user: orm.UserDB = Depends(get_current_user)):
    return UserRegisterResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        created_at=current_user.created_at,
    )
