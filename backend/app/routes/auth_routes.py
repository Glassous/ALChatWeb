from __future__ import annotations

import re
import secrets
import smtplib
import time
import threading
from datetime import timedelta
from email.message import EmailMessage
from urllib.parse import urlparse

from bson import ObjectId
from fastapi import APIRouter, Request

from ..core import auth, check_password, credits_for, fail, hash_password, now, rate_limit, reset_credits, token
from ..storage import User, public
from ..media import COS

router = APIRouter()


def _state():
    from ..main import current
    return current()


def _claims(request: Request) -> dict:
    return auth(request, _state().db)


def _email_check(email: str):
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        fail(400, "Invalid request")


def _send_mail(address: str, code: str):
    _send_message(address, "AL Chat verification code", f"Your verification code is {code}. It expires in 10 minutes.")


def _send_message(address: str, subject: str, content: str):
    cfg = _state().cfg
    message = EmailMessage()
    message["From"] = cfg.SMTP_FROM or cfg.SMTP_USER
    message["To"] = address
    message["Subject"] = subject
    message.set_content(content)
    smtp_cls = smtplib.SMTP_SSL if cfg.SMTP_PORT == 465 else smtplib.SMTP
    with smtp_cls(cfg.SMTP_HOST, cfg.SMTP_PORT, timeout=20) as smtp:
        if cfg.SMTP_PORT != 465:
            smtp.starttls()
        if cfg.SMTP_USER:
            smtp.login(cfg.SMTP_USER, cfg.SMTP_PASS)
        smtp.send_message(message)


@router.post("/api/auth/send-code")
def send_code(body: dict, request: Request):
    st = _state()
    rate_limit(request, st.db, 5, "/api/auth/send-code")
    email, scene = body.get("email", ""), body.get("scene", "")
    _email_check(email)
    if scene not in ("register", "reset"):
        fail(400, "Invalid request")
    if st.db.redis.exists(f"email_limit:{email}"):
        fail(429, "Please wait a minute before requesting another code")
    if scene == "reset":
        with st.db.session() as s:
            if not s.query(User).filter(User.email == email).first():
                fail(404, "User with this email not found")
    code = "".join(secrets.choice("0123456789") for _ in range(6))
    try:
        _send_mail(email, code)
    except Exception as exc:
        fail(500, "Failed to send email: " + str(exc))
    st.db.redis.set(f"email_verify:{email}", code, ex=600)
    st.db.redis.set(f"email_limit:{email}", "1", ex=60)
    return {"message": "Verification code sent"}


def register_user(body: dict, role: str):
    st = _state()
    email = body.get("email", "")
    _email_check(email)
    password = body.get("password", "")
    if len(password) < 6 or password != body.get("confirm_password") or not re.fullmatch(r"\d{6}", str(body.get("code", ""))):
        fail(400, "Invalid request")
    key = f"email_verify:{email}"
    if st.db.redis.get(key) != body["code"]:
        fail(400, "Invalid or expired verification code")
    with st.db.session() as s:
        if s.query(User).filter(User.email == email).first():
            fail(409, "Email already registered")
        user = User(id=str(ObjectId()), email=email, nickname=body.get("nickname") or email, password=hash_password(password), role=role, member_type="free", credits=1000, last_credit_reset_at=now(), created_at=now(), updated_at=now())
        s.add(user)
        s.flush()
        view = public(user)
    st.db.redis.delete(key)
    return {"token": token(st.cfg, view["id"], role), "user": view}


@router.post("/api/auth/register")
def register(body: dict, request: Request):
    rate_limit(request, _state().db, 5, "/api/auth/register")
    return register_user(body, "user")


@router.post("/api/admin/register")
def admin_register(body: dict):
    return register_user(body, "admin")


@router.post("/api/auth/login")
def login(body: dict, request: Request):
    st = _state()
    rate_limit(request, st.db, 5, "/api/auth/login")
    email, password = body.get("email", ""), body.get("password", "")
    _email_check(email)
    with st.db.session() as s:
        user = s.query(User).filter(User.email == email).first()
        if not user or not check_password(password, user.password):
            fail(401, "Invalid email or password")
        reset_credits(st.db, user)
        view = public(user)
    return {"token": token(st.cfg, view["id"], view["role"]), "user": view}


@router.post("/api/auth/reset-password")
def reset_password(body: dict, request: Request):
    st = _state()
    rate_limit(request, st.db, 5, "/api/auth/reset-password")
    email = body.get("email", "")
    _email_check(email)
    password = body.get("new_password", "")
    if len(password) < 6 or password != body.get("confirm_password"):
        fail(400, "Invalid request")
    key = f"email_verify:{email}"
    if st.db.redis.get(key) != body.get("code"):
        fail(400, "Invalid or expired verification code")
    with st.db.session() as s:
        user = s.query(User).filter(User.email == email).first()
        if not user:
            fail(404, "User with this email not found")
        user.password = hash_password(password)
    st.db.redis.delete(key)
    return {"message": "Password reset successfully"}


@router.post("/api/auth/logout")
def logout(request: Request):
    claims = _claims(request)
    ttl = int(claims["exp"] - time.time())
    try:
        if ttl > 0 and claims.get("jti"):
            _state().db.redis.set(f"blacklist:{claims['jti']}", "1", ex=ttl)
    except Exception:
        fail(500, "Failed to logout")
    return {"message": "Logged out successfully"}


@router.get("/api/auth/profile")
def profile(request: Request):
    st = _state()
    uid = _claims(request)["user_id"]
    with st.db.session() as s:
        user = s.get(User, uid)
        if not user:
            fail(500, "Failed to fetch profile")
        reset_credits(st.db, user)
        return public(user)


@router.put("/api/auth/profile")
def update_profile(body: dict, request: Request):
    st = _state()
    uid = _claims(request)["user_id"]
    with st.db.session() as s:
        user = s.get(User, uid)
        if not user:
            fail(500, "Failed to update profile")
        user.nickname = str(body.get("nickname", ""))
        user.updated_at = now()
    return {"message": "Profile updated successfully"}


@router.post("/api/auth/avatar")
async def update_avatar(request: Request):
    st = _state()
    user_id = _claims(request)["user_id"]
    try:
        cos = COS(st.cfg)
    except ValueError:
        fail(503, "COS service not configured")
    if "application/json" in request.headers.get("content-type", ""):
        body = await request.json()
        url = body.get("avatar_url", "")
        if not url:
            fail(400, "Invalid request")
    else:
        form = await request.form()
        files = form.getlist("avatar")
        if not files:
            fail(400, "No avatar file provided")
        if len(files) > 5:
            fail(400, "Too many files. Maximum 5 files allowed")
        file = files[0]
        data = await file.read(15 * 1024 * 1024 + 1)
        if len(data) > 15 * 1024 * 1024:
            fail(400, "File size exceeds 15MB limit")
        if not data.startswith((b"\xff\xd8", b"\x89PNG", b"RIFF", b"GIF8")):
            fail(400, "Invalid file type. Only JPEG, PNG, WEBP and GIF are allowed")
        url = cos.upload(data, file.filename or "avatar", "avatars")
    with st.db.session() as s:
        user = s.get(User, user_id)
        if not user:
            fail(500, "Failed to update profile")
        old = user.avatar
        user.avatar, user.updated_at = url, now()
    if old:
        threading.Thread(target=lambda: cos.delete(urlparse(old).path.lstrip("/")), daemon=True).start()
    return {"message": "Avatar updated successfully", "avatar": url}


@router.get("/api/auth/system-prompt")
def system_prompt(request: Request):
    uid = _claims(request)["user_id"]
    with _state().db.session() as s:
        user = s.get(User, uid)
        if not user:
            fail(500, "Failed to fetch user")
        return {"system_prompt": user.system_prompt or "", "include_datetime": bool(user.include_date_time), "include_location": bool(user.include_location)}


@router.put("/api/auth/system-prompt")
def update_system_prompt(body: dict, request: Request):
    uid = _claims(request)["user_id"]
    with _state().db.session() as s:
        user = s.get(User, uid)
        if not user:
            fail(500, "Failed to update system prompt")
        user.system_prompt = body.get("system_prompt", "")
        user.include_date_time = bool(body.get("include_datetime"))
        user.include_location = bool(body.get("include_location"))
        user.updated_at = now()
    return {"message": "System prompt updated successfully"}


@router.post("/api/auth/upgrade")
def upgrade(body: dict, request: Request):
    st = _state()
    uid = _claims(request)["user_id"]
    code = st.db.mongo["invitation_codes"].find_one({"code": body.get("code", ""), "is_used": False})
    if not code:
        fail(400, "Invalid or used invitation code")
    with st.db.session() as s:
        user = s.get(User, uid)
        if not user:
            fail(400, "Invalid or used invitation code")
        member_type = code["type"]
        duration = timedelta(days=30 * int(code.get("duration_months", 1)))
        start = user.member_expiry if user.member_type == member_type and user.member_expiry and user.member_expiry > now() else now()
        expiry = start + duration
        user.member_type = member_type
        user.member_expiry = expiry.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        user.credits = credits_for(member_type, st.db.mongo["system_settings"].find_one({}))
        user.last_credit_reset_at = now()
    st.db.mongo["invitation_codes"].update_one({"_id": code["_id"], "is_used": False}, {"$set": {"is_used": True, "used_by": ObjectId(uid), "used_at": now()}})
    return {"message": "Successfully upgraded", "member_type": member_type}
