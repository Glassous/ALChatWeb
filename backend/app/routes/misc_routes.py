from __future__ import annotations

import re
import secrets
from urllib.parse import urlparse

import httpx
from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import Response
from pymongo import DESCENDING

from ..ai import HermesResponsesModel, Runtime
from ..core import admin, auth, decrypt, encrypt, fail, now, validate_public_url
from ..media import COS
from ..storage import CustomModelConfig, HermesConfig, User, oid, public

router = APIRouter()


def st():
    from ..main import current
    return current()


def uid(request: Request) -> str:
    return auth(request, st().db)["user_id"]


def _model_view(c):
    return {"enabled": bool(c.enabled), "base_url": c.base_url or "", "model": c.model or "", "daily_enabled": bool(c.daily_enabled), "expert_enabled": bool(c.expert_enabled), "search_enabled": bool(c.search_enabled), "has_api_key": bool(c.api_key_ciphertext), "api_key_masked": "••••••••" if c.api_key_ciphertext else "", "response_mode": c.response_mode or "", "last_tested_at": public(c.last_tested_at) if c.last_tested_at else None}


@router.get("/api/auth/custom-model")
def get_custom(request: Request):
    user_id = uid(request)
    with st().db.session() as s:
        return _model_view(s.get(CustomModelConfig, user_id) or CustomModelConfig(user_id=user_id))


@router.put("/api/auth/custom-model")
def update_custom(body: dict, request: Request):
    user_id = uid(request)
    base, model, key = (str(body.get(k, "")).strip() for k in ("base_url", "model", "api_key"))
    if len(base) > 512 or len(model) > 255 or len(key) > 4096:
        fail(400, "Custom model setting is too long")
    if base:
        try:
            validate_public_url(base)
        except ValueError as exc:
            fail(400, str(exc))
    with st().db.session() as s:
        cfg = s.get(CustomModelConfig, user_id)
        if cfg is None:
            cfg = CustomModelConfig(user_id=user_id, created_at=now())
            s.add(cfg)
        changed = cfg.base_url != base or cfg.model != model or bool(key) or body.get("clear_api_key")
        cfg.base_url, cfg.model = base.rstrip("/"), model
        if body.get("clear_api_key"):
            cfg.api_key_ciphertext = ""
        if key:
            cfg.api_key_ciphertext = encrypt(st().cfg, key)
        cfg.enabled = bool(body.get("enabled"))
        cfg.daily_enabled = bool(body.get("daily_enabled"))
        cfg.expert_enabled = bool(body.get("expert_enabled"))
        cfg.search_enabled = bool(body.get("search_enabled"))
        if changed:
            cfg.response_mode = ""
            cfg.last_tested_at = None
        if cfg.enabled and not all((cfg.base_url, cfg.model, cfg.api_key_ciphertext, cfg.response_mode)):
            fail(400, "请先完整填写配置并通过连通性检测")
        cfg.updated_at = now()
        s.flush()
        return _model_view(cfg)


@router.post("/api/auth/custom-model/test")
def test_custom(body: dict, request: Request):
    user_id = uid(request)
    base, model, key = (str(body.get(k, "")).strip() for k in ("base_url", "model", "api_key"))
    try:
        validate_public_url(base)
    except ValueError as exc:
        fail(400, str(exc))
    with st().db.session() as s:
        cfg = s.get(CustomModelConfig, user_id)
        if cfg is None:
            cfg = CustomModelConfig(user_id=user_id, created_at=now())
            s.add(cfg)
        if not key and cfg.api_key_ciphertext:
            key = decrypt(st().cfg, cfg.api_key_ciphertext)
        if not key or not model:
            fail(400, "Base URL、API Key 和 Model 均为必填项")
        rt = Runtime(key, base, model)
        test_messages = st().ai.messages([{"role": "user", "content": "Reply with OK"}])
        mode = "stream"
        try:
            result = list(st().ai.model_for("daily", rt, timeout=8).stream(test_messages))
            if not any(c.content or c.additional_kwargs.get("reasoning_content") for c in result):
                raise ValueError("empty stream")
        except Exception:
            try:
                text, thought = st().ai.non_stream([{"role": "user", "content": "Reply with OK"}], "daily", "", rt, timeout=30)
                if not text and not thought:
                    raise ValueError("model connected but returned no content")
                mode = "non_stream"
            except Exception as exc:
                fail(502, "连通性检测失败: " + str(exc))
        cfg.base_url, cfg.model = base.rstrip("/"), model
        if body.get("api_key"):
            cfg.api_key_ciphertext = encrypt(st().cfg, key)
        cfg.response_mode, cfg.last_tested_at, cfg.updated_at = mode, now(), now()
        return {"connected": True, "response_mode": mode, "last_tested_at": public(cfg.last_tested_at)}


def _hermes_view(c):
    return {"base_url": c.base_url or "", "model": c.model or "", "has_api_key": bool(c.api_key_ciphertext), "tested": bool(c.tested), "context_version": c.context_version or 0, "last_tested_at": public(c.last_tested_at) if c.last_tested_at else None}


@router.get("/api/auth/hermes")
def get_hermes(request: Request):
    user_id = uid(request)
    with st().db.session() as s:
        return _hermes_view(s.get(HermesConfig, user_id) or HermesConfig(user_id=user_id, context_version=0))


@router.put("/api/auth/hermes")
def update_hermes(body: dict, request: Request):
    user_id = uid(request)
    base, model, key = (str(body.get(k, "")).strip() for k in ("base_url", "model", "api_key"))
    if base:
        try:
            validate_public_url(base)
        except ValueError as exc:
            fail(400, str(exc))
    with st().db.session() as s:
        cfg = s.get(HermesConfig, user_id)
        if cfg is None:
            cfg = HermesConfig(user_id=user_id, created_at=now(), context_version=0)
            s.add(cfg)
        old_key = decrypt(st().cfg, cfg.api_key_ciphertext) if cfg.api_key_ciphertext else ""
        changed = cfg.base_url != base or cfg.model != model or (key and key != old_key) or (body.get("clear_api_key") and bool(old_key))
        cfg.base_url, cfg.model = base, model
        if body.get("clear_api_key"):
            cfg.api_key_ciphertext = ""
        if key:
            cfg.api_key_ciphertext = encrypt(st().cfg, key)
        if changed:
            cfg.context_version = (cfg.context_version or 0) + 1
            cfg.tested = False
            cfg.last_tested_at = None
        if not all((cfg.base_url, cfg.model, cfg.api_key_ciphertext)):
            cfg.tested = False
        cfg.updated_at = now()
        return _hermes_view(cfg)


@router.post("/api/auth/hermes/test")
def test_hermes(body: dict, request: Request):
    user_id = uid(request)
    base, model, key = (str(body.get(k, "")).strip() for k in ("base_url", "model", "api_key"))
    try:
        validate_public_url(base)
    except ValueError as exc:
        fail(400, str(exc))
    with st().db.session() as s:
        cfg = s.get(HermesConfig, user_id)
        if cfg is None:
            cfg = HermesConfig(user_id=user_id, created_at=now(), context_version=0)
            s.add(cfg)
        old_key = decrypt(st().cfg, cfg.api_key_ciphertext) if cfg.api_key_ciphertext else ""
        key = key or old_key
        if not key or not model:
            fail(400, "Base URL、API Key 和 Model 均为必填项")
        got_text = False
        try:
            for chunk in HermesResponsesModel(model=model, base_url=base, api_key=key).stream(st().ai.messages([{"role": "user", "content": "Reply with OK"}])):
                if isinstance(chunk.content, str) and chunk.content:
                    got_text = True
        except Exception as exc:
            fail(502, "Hermes 连通性检测失败: " + str(exc))
        if not got_text:
            fail(502, "Hermes 连通性检测失败: http: request body not allowed")
        changed = cfg.base_url != base or cfg.model != model or (key != old_key)
        if changed or not cfg.context_version:
            cfg.context_version = (cfg.context_version or 0) + 1
        cfg.base_url, cfg.model = base, model
        if body.get("api_key"):
            cfg.api_key_ciphertext = encrypt(st().cfg, key)
        cfg.tested, cfg.last_tested_at, cfg.updated_at = True, now(), now()
        return _hermes_view(cfg)


@router.post("/api/conversations/{id}/share")
def create_share(id: str, request: Request, body: dict | None = None):
    user_id = uid(request)
    if not ObjectId.is_valid(id):
        fail(400, "Invalid conversation ID")
    conv = st().db.mongo["conversations"].find_one({"_id": oid(id), "user_id": oid(user_id)})
    if not conv:
        fail(400, "对话不存在或无权限")
    with st().db.session() as s:
        user = s.get(User, user_id)
        if not user:
            fail(400, "用户不存在")
        nickname, avatar = user.nickname or user.email, user.avatar
    requested_leaf = str((body or {}).get("leaf_message_id") or "")
    messages = list(st().db.mongo["messages"].find({"conversation_id": oid(id)}).sort([("created_at", -1), ("_id", -1)]))
    leaf = next((m for m in messages if requested_leaf and str(m["_id"]) == requested_leaf), None)
    if requested_leaf and ObjectId.is_valid(requested_leaf) and not leaf:
        fail(400, "未找到消息")
    if leaf is None:
        if not messages:
            fail(400, "对话中没有消息")
        leaf = messages[0]
    by_id = {str(m["_id"]): m for m in messages}
    branch = []
    cursor = str(leaf["_id"])
    while cursor in by_id:
        item = by_id[cursor]
        branch.append(item)
        cursor = str(item.get("parent_id", ""))
    messages = branch[::-1]
    share = {"_id": ObjectId(), "share_token": secrets.token_hex(4), "conversation_id": oid(id), "user_id": oid(user_id), "user_nickname": nickname, "user_avatar": avatar, "title": conv.get("title", ""), "message_ids": [m["_id"] for m in messages], "leaf_message_id": leaf["_id"], "is_deleted": False, "created_at": now(), "updated_at": now(), "view_count": 0}
    st().db.mongo["shared_conversations"].insert_one(share)
    return public(share)


@router.get("/api/shared/{token}")
def shared(token: str):
    record = st().db.mongo["shared_conversations"].find_one({"share_token": token})
    if not record:
        fail(404, "分享链接不存在")
    data = {"title": record.get("title", ""), "sharer_nickname": record.get("user_nickname", ""), "sharer_avatar": record.get("user_avatar", ""), "created_at": public(record.get("created_at"))}
    if record.get("is_deleted"):
        return {"status": "deleted", **data}
    if record.get("expires_at") and record["expires_at"] < now():
        return {"status": "expired", **data}
    if not st().db.mongo["conversations"].find_one({"_id": record["conversation_id"]}):
        return {"status": "conversation_deleted", **data}
    st().db.mongo["shared_conversations"].update_one({"_id": record["_id"]}, {"$inc": {"view_count": 1}})
    found = {m["_id"]: m for m in st().db.mongo["messages"].find({"_id": {"$in": record["message_ids"]}})}
    messages = [found[mid] for mid in record["message_ids"] if mid in found]
    if not messages:
        return {"status": "messages_deleted", **data}
    return {"status": "active" if len(messages) == len(record["message_ids"]) else "partial", **data, "messages": public(messages)}


@router.get("/api/my/shared")
def my_shares(request: Request):
    return public(list(st().db.mongo["shared_conversations"].find({"user_id": oid(uid(request))}).sort("created_at", DESCENDING)))


@router.delete("/api/shared/{token}")
def delete_share(token: str, request: Request):
    result = st().db.mongo["shared_conversations"].update_one({"share_token": token, "user_id": oid(uid(request))}, {"$set": {"is_deleted": True, "updated_at": now()}})
    if not result.matched_count:
        fail(400, "分享不存在或无权限")
    return {"message": "分享已删除"}


@router.post("/api/shared/{token}/save")
def save_share(token: str, request: Request):
    user_id = uid(request)
    record = st().db.mongo["shared_conversations"].find_one({"share_token": token})
    if not record or record.get("is_deleted"):
        fail(400, "分享不存在或已失效")
    found = {m["_id"]: m for m in st().db.mongo["messages"].find({"_id": {"$in": record["message_ids"]}})}
    source = [found[mid] for mid in record["message_ids"] if mid in found]
    if not source:
        fail(400, "对话内容已被删除")
    new = st().conversations.create(user_id, "[来自分享] " + record["title"])
    ids = {}
    for message in source:
        parent = ids.get(str(message.get("parent_id", "")), "")
        copied = st().conversations.save(user_id, new["id"], message["role"], message.get("content", ""), parent)
        copied["attachments"] = message.get("attachments", [])
        ids[str(message["_id"])] = copied["id"]
        copied["reasoning"] = message.get("reasoning", "")
        copied["search"] = message.get("search")
        if message.get("mode") == "agent":
            copied.update(mode="agent", agent_trace=message.get("agent_trace", []), agent_status=message.get("agent_status", "completed"), agent_error=message.get("agent_error", ""))
            copied.update(agent_budget=message.get("agent_budget", {}), agent_notice=message.get("agent_notice", ""), agent_finish_reason=message.get("agent_finish_reason", ""))
            copied["agent_discovery"] = message.get("agent_discovery", {})
            if copied["agent_status"] in ("running", "cancelling"):
                copied["agent_status"] = "interrupted"
                copied["agent_error"] = "分享副本仅包含保存时的执行结果"
        st().conversations.update_message(copied)
    return {"conversation_id": new["id"]}


@router.post("/api/location/resolve")
def resolve_location(body: dict, request: Request):
    uid(request)
    if not body.get("lat") or not body.get("lng"):
        fail(400, "lat and lng are required")
    lat, lng = float(body["lat"]), float(body["lng"])
    try:
        result = httpx.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat, "lon": lng, "format": "json", "accept-language": "zh", "zoom": 18, "addressdetails": 1}, headers={"User-Agent": "ALChat/1.0 (https://alchat.fiacloud.top)"}, timeout=5).json()["address"]
        city = result.get("city") or result.get("town") or result.get("village")
        parts = [result.get("state"), city if city != result.get("state") else "", result.get("suburb") or result.get("district"), result.get("neighbourhood"), result.get("road")]
        address = ", ".join(p for p in parts if p)
        if result.get("house_number"):
            address += " " + result["house_number"]
    except Exception:
        address = ""
    return {"address": address or f"{lat:.6f}, {lng:.6f}"}


@router.get("/api/proxy/icon")
def proxy_icon(url: str = ""):
    if not url:
        fail(400, "url parameter is required")
    if urlparse(url).scheme not in ("http", "https"):
        fail(400, "invalid url")
    try:
        response = httpx.get(url, timeout=8, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0", "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"})
    except Exception as exc:
        fail(502, "failed to fetch icon: " + str(exc))
    mime = response.headers.get("content-type", "")
    return Response(content=response.content, status_code=response.status_code, media_type=mime if mime.startswith("image/") or mime == "application/octet-stream" else "image/x-icon", headers={"Cache-Control": response.headers.get("cache-control", "public, max-age=86400")})
