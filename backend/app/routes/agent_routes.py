from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..agents import manager, request_hash, require_agent_schema
from ..core import auth, fail, now, rate_limit, reset_credits
from ..storage import User, oid
from .chat_routes import _cleanup_history, _system_prompt

router = APIRouter()


def st():
    from ..main import current
    return current()


class StartRun(BaseModel):
    conversation_id: str
    message: str = Field(min_length=1, max_length=20000)
    parent_message_id: str | None = None
    request_id: str = Field(min_length=1, max_length=100)
    location: str = Field(default="", max_length=200)


@router.post("/api/agent/runs")
def start(body: StartRun, request: Request):
    state = st()
    user_id = auth(request, state.db)["user_id"]
    service = manager(state)
    cid, message, parent = body.conversation_id, body.message.strip(), body.parent_message_id or ""
    if not ObjectId.is_valid(cid) or not message:
        fail(400, "Agent 仅支持普通持久会话中的任务")
    with service.condition:
        if not state.conversations.convs.find_one({"_id": oid(cid), "user_id": oid(user_id)}):
            fail(404, "会话不存在")
        fingerprint = request_hash(cid, message, parent)
        previous = service.runs.find_one({"user_id": user_id, "request_id": body.request_id})
        if previous:
            if previous["request_hash"] != fingerprint:
                fail(409, "请求标识已被其他任务使用")
            return service.snapshot(previous)
        rate_limit(request, state.db, 10, "/api/agent/runs", user_id)
        if parent and (not ObjectId.is_valid(parent) or not state.conversations.messages.find_one({"_id": oid(parent), "conversation_id": oid(cid)})):
            fail(400, "父消息不属于当前会话")
        service.assert_idle(cid)
        if not (state.cfg.BOCHA_API_KEY or state.cfg.TAVILY_API_KEY or state.cfg.SUPERBOX_ENABLED or state.cfg.MULTIMODAL_API_KEY):
            fail(400, "请先配置搜索、多模态服务或启用 Superbox")
        if not state.ai.runtime("daily").api_key:
            fail(400, "请先配置项目日常模型")
        require_agent_schema(state.db)
        with state.db.session() as session:
            user = session.get(User, user_id)
            reset_credits(state.db, user)
            if user.credits <= 0:
                fail(403, "Insufficient credits", credits=float(user.credits))
            credits = float(user.credits)
            prompt = _system_prompt(user, body.location)
        user_message = state.conversations.save(user_id, cid, "user", message, parent)
        assistant = state.conversations.save(user_id, cid, "assistant", "", user_message["id"])
        user_message["mode"] = "agent"
        state.conversations.update_message(user_message)
        run = {"_id": ObjectId(), "user_id": user_id, "conversation_id": cid, "user_message_id": user_message["id"], "assistant_message_id": assistant["id"], "request_id": body.request_id, "request_hash": fingerprint,
            "message": message, "content": "", "status": "running", "steps": [], "sources": [], "credits": credits, "seq": 0, "created_at": now(), "updated_at": now(), "error": ""}
        run.update(budget={"search_used": 0, "search_limit": state.cfg.AGENT_MAX_SEARCH_CALLS,
            "model_used": 0, "model_limit": state.cfg.AGENT_MAX_MODEL_CALLS, "phase": "research", "reason": ""}, notice="", finish_reason="")
        run["budget"].update(plugin_used=0, plugin_limit=state.cfg.AGENT_MAX_PLUGIN_CALLS, exhausted=[])
        service.runs.insert_one(run)
        service.persist(run, "status", {"status": "running"})
        history = _cleanup_history(state.conversations.branch(cid, user_message["id"]))
        snapshot = service.snapshot(run)
        service.launch(run, history, prompt)
        return JSONResponse(snapshot, status_code=201)


@router.get("/api/agent/runs/{id}")
def get(id: str, request: Request):
    service = manager(st())
    with service.condition:
        return service.snapshot(service.get(auth(request, st().db)["user_id"], id))


@router.get("/api/agent/runs/{id}/events")
def events(id: str, request: Request, after_seq: int = 0):
    user_id = auth(request, st().db)["user_id"]
    service = manager(st())
    service.get(user_id, id)
    if after_seq < 0:
        fail(400, "事件序号不得为负数")
    return StreamingResponse(service.subscribe(user_id, id, after_seq), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/api/agent/runs/{id}/cancel")
def cancel(id: str, request: Request):
    service = manager(st())
    with service.condition:
        return service.cancel(service.get(auth(request, st().db)["user_id"], id))
