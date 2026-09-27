from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import secrets
import socket
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import bcrypt
import jwt
import tiktoken
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, Request

from .config import Settings
from .storage import Storage


def fail(status: int, message: str, **extra):
    raise HTTPException(status, {"error": message, **extra})


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def check_password(password: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), stored.encode())
    except ValueError:
        return False


def token(cfg: Settings, user_id: str, role: str) -> str:
    return jwt.encode({"user_id": user_id, "role": role, "jti": str(uuid.uuid4()), "exp": int(time.time()) + 604800}, cfg.JWT_SECRET, algorithm="HS256")


def auth(request: Request, db: Storage) -> dict:
    header = request.headers.get("authorization", "")
    if not header:
        fail(401, "Authorization header is required")
    if not header.startswith("Bearer ") or len(header.split()) != 2:
        fail(401, "Invalid authorization header format")
    try:
        claims = jwt.decode(header[7:], db.cfg.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        fail(401, "Invalid or expired token")
    if not isinstance(claims.get("user_id"), str):
        fail(401, "Invalid token claims")
    if claims.get("jti") and db.redis.exists(f"blacklist:{claims['jti']}"):
        fail(401, "Token has been revoked")
    if int(claims["exp"]) - time.time() < 2 * 86400:
        request.state.new_token = token(db.cfg, claims["user_id"], claims.get("role", ""))
    return claims


def admin(claims: dict) -> None:
    if claims.get("role") != "admin":
        fail(403, "Admin access required")


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "")


def rate_limit(request: Request, db: Storage, count: int, scope: str, user_id: str | None = None) -> None:
    identifier = f"user:{user_id}" if user_id else f"ip:{client_ip(request)}"
    key = f"ratelimit:{scope}:{identifier}"
    n = db.redis.incr(key)
    if n == 1:
        db.redis.expire(key, 60)
    if n > count:
        fail(429, "Too many requests. Please try again in a minute.")


def encrypt(cfg: Settings, plain: str) -> str:
    key = hashlib.sha256(cfg.encryption_key.encode()).digest()
    nonce = secrets.token_bytes(12)
    return base64.b64encode(nonce + AESGCM(key).encrypt(nonce, plain.encode(), None)).decode().rstrip("=")


def decrypt(cfg: Settings, encoded: str) -> str:
    raw = base64.b64decode(encoded + "=" * (-len(encoded) % 4))
    key = hashlib.sha256(cfg.encryption_key.encode()).digest()
    return AESGCM(key).decrypt(raw[:12], raw[12:], None).decode()


def validate_public_url(value: str) -> str:
    parsed = urlparse(value.rstrip("/"))
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("base_url must be a valid HTTPS URL")
    if parsed.hostname.lower() == "localhost":
        raise ValueError("private hosts are not allowed")
    try:
        answers = socket.getaddrinfo(parsed.hostname, parsed.port or 443)
    except socket.gaierror as exc:
        raise ValueError("cannot resolve base_url host: " + str(exc)) from exc
    for answer in answers:
        ip = ipaddress.ip_address(answer[4][0])
        if not ip.is_global:
            raise ValueError("private or reserved addresses are not allowed")
    return value.rstrip("/")


def count_tokens(value: str) -> int:
    try:
        return len(tiktoken.get_encoding("cl100k_base").encode(value))
    except Exception:
        return len(value) // 4


def credits_for(member_type: str, settings: dict | None = None) -> float:
    campaign = (settings or {}).get("campaign_config") or {}
    credit = (campaign.get("campaign_credits") or {}).get(member_type) if campaign.get("is_active") else None
    return float(credit or {"pro": 5000, "max": 10000, "ultra": 50000}.get(member_type, 1000))


def now() -> datetime:
    # The Go service persisted real UTC instants (time.Time); keep that semantic
    # so stored timestamps and BSON dates stay comparable across both backends.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def reset_credits(db: Storage, user) -> None:
    current = now()
    if user.last_credit_reset_at is None or user.last_credit_reset_at.date() != current.date():
        settings = db.mongo["system_settings"].find_one({})
        user.credits = credits_for(user.member_type, settings)
        user.last_credit_reset_at = current


def deduct(db: Storage, user_id: str, input_tokens: int = 0, output_tokens: int = 0, flat: float = 0) -> float:
    from sqlalchemy import update
    from .storage import User
    cost = flat or (input_tokens * .001 + output_tokens * .004)
    with db.session() as s:
        s.execute(update(User).where(User.id == user_id).values(credits=User.credits - cost))
        s.flush()
        user = s.get(User, user_id)
        return float(user.credits)
