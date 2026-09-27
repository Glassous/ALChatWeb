from __future__ import annotations

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pymongo import ASCENDING

from ..conversations import is_temp
from ..core import auth, fail
from ..storage import oid, public

router = APIRouter()


def st():
    from ..main import current
    return current()


def uid(request: Request) -> str:
    return auth(request, st().db)["user_id"]


@router.get("/api/conversations")
def list_conversations(request: Request):
    return st().conversations.all(uid(request))


@router.post("/api/conversations")
def create_conversation(body: dict, request: Request):
    return JSONResponse(st().conversations.create(uid(request), body.get("title") or "New Conversation"), status_code=201)


@router.get("/api/conversations/temp/{id}")
def get_temp(id: str, request: Request):
    uid(request)
    if not is_temp(id):
        fail(400, "Not a temp conversation ID")
    conv = st().temp.get(id)
    if not conv:
        fail(404, "Temp conversation not found or expired")
    return {"id": id, "title": conv.get("title", ""), "messages": [st().temp.legacy_message(m) for m in st().temp.messages(id)]}


@router.post("/api/conversations/temp/{id}/promote")
def promote_temp(id: str, request: Request):
    user = uid(request)
    if not is_temp(id):
        fail(400, "Not a temp conversation ID")
    if not st().temp.messages(id):
        fail(500, "no messages found in temporary conversation")
    try:
        promoted = st().temp.promote(id, user, st().conversations)
    except ValueError as exc:
        fail(500, str(exc))
    try:
        title = st().conversations.auto_title(user, promoted["id"])
        if title:
            promoted["title"] = title
    except Exception:
        pass
    return promoted


@router.delete("/api/conversations/temp/{id}")
def delete_temp(id: str, request: Request):
    uid(request)
    if not is_temp(id):
        fail(400, "Not a temp conversation ID")
    st().temp.delete(id)
    return {"message": "Temp conversation deleted"}


@router.get("/api/conversations/{id}")
def get_conversation(id: str, request: Request):
    user = uid(request)
    if not ObjectId.is_valid(id):
        fail(404, "invalid conversation ID")
    result = st().conversations.get(user, id)
    if not result:
        fail(404, "conversation not found")
    return result


@router.put("/api/conversations/{id}/title")
def update_title(id: str, body: dict, request: Request):
    user = uid(request)
    if not body.get("title"):
        fail(400, "Title is required")
    if not ObjectId.is_valid(id):
        fail(500, "invalid conversation ID")
    st().conversations.title(user, id, body["title"])
    return {"message": "Title updated successfully"}


@router.post("/api/conversations/{id}/generate-title")
def generate_title(id: str, request: Request):
    user = uid(request)
    if not ObjectId.is_valid(id):
        fail(500, "Failed to fetch messages")
    messages = public(list(st().db.mongo["messages"].find({"conversation_id": oid(id)}).sort("created_at", ASCENDING)))
    if not messages:
        fail(400, "No messages in conversation")
    try:
        title = st().ai.title(messages)
    except Exception as exc:
        fail(500, "Failed to generate title: " + str(exc))
    try:
        st().conversations.title(user, id, title)
    except Exception as exc:
        fail(500, "Failed to update title: " + str(exc))
    return {"title": title}


@router.delete("/api/conversations/{id}/messages/after/{messageId}")
def delete_messages_after(id: str, messageId: str, request: Request):
    uid(request)
    # Branches are immutable in the existing backend; endpoint remains a no-op.
    return {"message": "Messages deleted successfully"}


@router.delete("/api/conversations/{id}")
def delete_conversation(id: str, request: Request):
    user = uid(request)
    if not ObjectId.is_valid(id):
        fail(500, "invalid conversation ID")
    if not st().conversations.delete(user, id):
        fail(404, "conversation not found or access denied")
    return {"message": "Conversation deleted successfully"}
