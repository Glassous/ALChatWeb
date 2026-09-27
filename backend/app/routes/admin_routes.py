from __future__ import annotations

import re
import secrets
import threading
from datetime import datetime, timedelta

from bson import ObjectId
from fastapi import APIRouter, Request
from pymongo import ASCENDING, DESCENDING

from ..core import admin, auth, credits_for, fail, now, rate_limit
from ..storage import Announcement, Feedback, ModelConfig, User, oid, public
from .auth_routes import _send_message

router = APIRouter()


def st():
    from ..main import current
    return current()


def admin_uid(request: Request) -> str:
    claims = auth(request, st().db)
    admin(claims)
    return claims["user_id"]


def valid_id(value: str, label: str = "ID"):
    if not ObjectId.is_valid(value):
        fail(400, f"Invalid {label}")


@router.get("/api/admin/dashboard")
def dashboard(request: Request):
    admin_uid(request)
    today = now().replace(hour=0, minute=0, second=0, microsecond=0)
    with st().db.session() as s:
        users = s.query(User).count()
        new_users = s.query(User).filter(User.created_at >= today).count()
    mongo = st().db.mongo
    return {"total_users": users, "today_new_users": new_users, "total_conversations": mongo["conversations"].count_documents({}), "today_active_convs": mongo["conversations"].count_documents({"updated_at": {"$gte": today}}), "total_messages": mongo["messages"].count_documents({}), "today_new_messages": mongo["messages"].count_documents({"created_at": {"$gte": today}})}


@router.get("/api/admin/users")
def users(request: Request):
    admin_uid(request)
    with st().db.session() as s:
        return public(s.query(User).order_by(User.created_at.desc()).all())


@router.get("/api/admin/users/{id}")
def user(id: str, request: Request):
    admin_uid(request)
    valid_id(id, "user ID")
    with st().db.session() as s:
        item = s.get(User, id)
        if not item:
            fail(404, "User not found")
        return public(item)


def _update_user(id: str, request: Request, field: str, value):
    admin_uid(request)
    valid_id(id, "user ID")
    with st().db.session() as s:
        item = s.get(User, id)
        if item:
            setattr(item, field, value)
            item.updated_at = now()


@router.put("/api/admin/users/{id}/role")
def user_role(id: str, body: dict, request: Request):
    if not body.get("role"):
        fail(400, "Invalid request")
    _update_user(id, request, "role", body["role"])
    return {"message": "User role updated successfully"}


@router.put("/api/admin/users/{id}/credits")
def user_credits(id: str, body: dict, request: Request):
    if not body.get("credits"):
        fail(400, "Invalid request")
    _update_user(id, request, "credits", float(body["credits"]))
    return {"message": "User credits updated successfully"}


@router.put("/api/admin/users/{id}/member-type")
def user_member_type(id: str, body: dict, request: Request):
    if not body.get("member_type"):
        fail(400, "Invalid request")
    _update_user(id, request, "member_type", body["member_type"])
    return {"message": "User member type updated successfully"}


@router.put("/api/admin/users/{id}/member")
def user_member(id: str, body: dict, request: Request):
    admin_uid(request)
    valid_id(id, "user ID")
    with st().db.session() as s:
        item = s.get(User, id)
        if item:
            item.credits = float(body.get("credits", 0))
            if body.get("member_type"):
                item.member_type = body["member_type"]
            expiry = body.get("member_expiry")
            item.member_expiry = (datetime.fromisoformat(expiry.replace("Z", "+00:00")).replace(tzinfo=None, hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)) if expiry else None
            item.updated_at = now()
    return {"message": "User member settings updated successfully"}


@router.delete("/api/admin/users/{id}")
def delete_user(id: str, request: Request):
    admin_uid(request)
    valid_id(id, "user ID")
    with st().db.session() as s:
        item = s.get(User, id)
        if item:
            s.delete(item)
    st().db.mongo["conversations"].delete_many({"user_id": oid(id)})
    return {"message": "User and their data deleted successfully"}


@router.get("/api/admin/conversations")
def admin_conversations(request: Request):
    admin_uid(request)
    return public(list(st().db.mongo["conversations"].find({}).sort("updated_at", DESCENDING)))


@router.get("/api/admin/conversations/{id}")
def admin_conversation(id: str, request: Request):
    admin_uid(request)
    valid_id(id, "conversation ID")
    conv = st().db.mongo["conversations"].find_one({"_id": oid(id)})
    if not conv:
        fail(404, "Conversation not found")
    messages = list(st().db.mongo["messages"].find({"conversation_id": oid(id)}).sort("created_at", ASCENDING))
    return {"conversation": public(conv), "messages": public(messages)}


@router.delete("/api/admin/conversations/{id}")
def admin_delete_conversation(id: str, request: Request):
    admin_uid(request)
    valid_id(id, "conversation ID")
    st().db.mongo["conversations"].delete_one({"_id": oid(id)})
    st().db.mongo["messages"].delete_many({"conversation_id": oid(id)})
    return {"message": "Conversation and its messages deleted successfully"}


@router.get("/api/admin/messages/search")
def search_messages(request: Request, q: str = ""):
    admin_uid(request)
    if not q:
        fail(400, "Query parameter 'q' is required")
    return public(list(st().db.mongo["messages"].find({"content": {"$regex": q, "$options": "i"}}).sort("created_at", DESCENDING).limit(100)))


@router.get("/api/admin/configs")
def model_configs(request: Request):
    admin_uid(request)
    with st().db.session() as s:
        return public(s.query(ModelConfig).all())


@router.put("/api/admin/configs")
def update_config(body: dict, request: Request):
    admin_uid(request)
    mode = str(body.get("mode", ""))
    if not mode:
        # Legacy service saved the row and then failed to hot-reload the AI service.
        fail(500, "Failed to hot-reload AI service: invalid mode")
    with st().db.session() as s:
        cfg = s.get(ModelConfig, mode)
        if not cfg:
            cfg = ModelConfig(mode=mode)
            s.add(cfg)
        # GORM Save replaced every column, so absent fields reset to their zero value.
        cfg.base_url = str(body.get("base_url", ""))
        cfg.api_key = str(body.get("api_key", ""))
        cfg.model = str(body.get("model", ""))
        cfg.is_active = bool(body.get("is_active"))
        cfg.updated_at = now()
        s.flush()
        st().ai.configure(mode, cfg.api_key, cfg.base_url, cfg.model)
    return {"message": "Config updated successfully"}


@router.post("/api/admin/invitation-codes")
def generate_invites(body: dict, request: Request):
    admin_uid(request)
    count, kind = int(body.get("count", 0)), body.get("type", "")
    if count <= 0 or not kind:
        fail(400, "Invalid request")
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes = ["".join(secrets.choice(alphabet) for _ in range(10)) for _ in range(count)]
    st().db.mongo["invitation_codes"].insert_many([{"_id": ObjectId(), "code": code, "type": kind, "duration_months": int(body.get("duration_months") or 1), "is_used": False, "created_at": now()} for code in codes])
    return {"codes": codes}


@router.get("/api/admin/invitation-codes")
def invitation_codes(request: Request):
    admin_uid(request)
    return public(list(st().db.mongo["invitation_codes"].find({}).sort("created_at", DESCENDING)))


@router.get("/api/admin/settings")
def system_settings(request: Request):
    admin_uid(request)
    return public(st().db.mongo["system_settings"].find_one({}) or {"id": "000000000000000000000000", "campaign_config": {"is_active": False, "campaign_credits": {}}, "updated_at": "0001-01-01T00:00:00Z"})


@router.put("/api/admin/settings")
def update_settings(body: dict, request: Request):
    admin_uid(request)
    st().db.mongo["system_settings"].update_one({}, {"$set": {"campaign_config": body.get("campaign_config", {}), "updated_at": now()}}, upsert=True)
    def refresh():
        settings = st().db.mongo["system_settings"].find_one({})
        with st().db.session() as s:
            for item in s.query(User).all():
                item.credits = credits_for(item.member_type, settings)
                item.last_credit_reset_at = now()
    threading.Thread(target=refresh, daemon=True).start()
    return {"message": "System settings updated successfully and credits refresh started"}


@router.get("/api/admin/shared")
def admin_shares(request: Request):
    admin_uid(request)
    return public(list(st().db.mongo["shared_conversations"].find({}).sort("created_at", DESCENDING).limit(100)))


@router.delete("/api/admin/shared/{id}")
def admin_delete_share(id: str, request: Request):
    admin_uid(request)
    valid_id(id, "share ID")
    result = st().db.mongo["shared_conversations"].update_one({"_id": oid(id)}, {"$set": {"is_deleted": True, "updated_at": now()}})
    if not result.matched_count:
        fail(404, "分享不存在")
    return {"message": "分享已删除"}


@router.get("/api/announcements")
def public_announcements():
    with st().db.session() as s:
        return public(s.query(Announcement).filter(Announcement.is_active == True).order_by(Announcement.published_at.desc()).limit(20).all())


@router.get("/api/admin/announcements")
def admin_announcements(request: Request):
    admin_uid(request)
    with st().db.session() as s:
        return public(s.query(Announcement).order_by(Announcement.created_at.desc()).all())


@router.post("/api/admin/announcements")
def create_announcement(body: dict, request: Request):
    user_id = admin_uid(request)
    if not body.get("title") or not body.get("content") or body.get("type") not in ("info", "warning", "critical"):
        fail(400, "Invalid request")
    with st().db.session() as s:
        item = Announcement(id=str(ObjectId()), title=body["title"], content=body["content"], type=body["type"], is_active=bool(body.get("is_active")), published_at=now() if body.get("is_active") else None, created_by=user_id, created_at=now(), updated_at=now())
        s.add(item)
        s.flush()
        return public(item)


@router.put("/api/admin/announcements/{id}")
def update_announcement(id: str, body: dict, request: Request):
    admin_uid(request)
    valid_id(id)
    with st().db.session() as s:
        item = s.get(Announcement, id)
        if item:
            for field in ("title", "content", "type", "is_active"):
                if field in body:
                    setattr(item, field, body[field])
            if body.get("publish"):
                item.is_active, item.published_at = True, now()
            if body.get("unpublish"):
                item.is_active, item.published_at = False, None
            item.updated_at = now()
    return {"message": "updated"}


@router.delete("/api/admin/announcements/{id}")
def delete_announcement(id: str, request: Request):
    admin_uid(request)
    valid_id(id)
    with st().db.session() as s:
        if item := s.get(Announcement, id):
            s.delete(item)
    return {"message": "deleted"}


@router.post("/api/feedback")
def submit_feedback(body: dict, request: Request):
    rate_limit(request, st().db, 5, "/api/feedback")
    if body.get("type") not in ("bug", "feature", "other") or not body.get("content") or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", body.get("user_email", "")):
        fail(400, "Invalid request")
    with st().db.session() as s:
        s.add(Feedback(id=str(ObjectId()), user_email=body["user_email"], type=body["type"], content=body["content"], meta=body.get("meta"), status="open", created_at=now(), updated_at=now()))
    return {"message": "submitted"}


@router.get("/api/admin/feedbacks")
def feedbacks(request: Request):
    admin_uid(request)
    with st().db.session() as s:
        return public(s.query(Feedback).order_by(Feedback.created_at.desc()).all())


@router.put("/api/admin/feedbacks/{id}/status")
def feedback_status(id: str, body: dict, request: Request):
    admin_uid(request)
    valid_id(id)
    if body.get("status") not in ("open", "replied", "closed"):
        fail(400, "Invalid request")
    with st().db.session() as s:
        if item := s.get(Feedback, id):
            item.status, item.updated_at = body["status"], now()
    return {"message": "status updated"}


@router.post("/api/admin/feedbacks/{id}/reply")
def reply_feedback(id: str, body: dict, request: Request):
    admin_uid(request)
    valid_id(id)
    if not body.get("reply_content"):
        fail(400, "Invalid request")
    with st().db.session() as s:
        item = s.get(Feedback, id)
        if not item:
            fail(404, "Feedback not found")
        item.status, item.reply_content, item.replied_at, item.updated_at = "replied", body["reply_content"], now(), now()
        recipient = item.user_email
        original = item.content
    threading.Thread(target=lambda: _send_message(recipient, "AL Chat 反馈回复通知", f"您的反馈：\n{original}\n\n我们的回复：\n{body['reply_content']}"), daemon=True).start()
    return {"message": "Replied successfully"}


@router.delete("/api/admin/feedbacks/{id}")
def delete_feedback(id: str, request: Request):
    admin_uid(request)
    valid_id(id)
    with st().db.session() as s:
        if item := s.get(Feedback, id):
            s.delete(item)
    return {"message": "deleted"}
