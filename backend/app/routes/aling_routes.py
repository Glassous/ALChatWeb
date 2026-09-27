from __future__ import annotations

import json
from typing import Iterator

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pymongo import DESCENDING

from ..core import auth, count_tokens, deduct, fail, now, reset_credits
from ..storage import User, oid, public

router = APIRouter(prefix="/api/aling")
DEFAULT_LANGUAGES = ["中文", "英语", "日语", "韩语", "法语", "西班牙语"]


def st():
    from ..main import current
    return current()


def uid(request: Request) -> str:
    return auth(request, st().db)["user_id"]


def _languages(user_id: str):
    collection = st().db.mongo["aling_translator_languages"]
    doc = collection.find_one({"user_id": oid(user_id)})
    if not doc:
        doc = {"_id": ObjectId(), "user_id": oid(user_id), "languages": DEFAULT_LANGUAGES.copy(), "updated_at": now()}
        collection.insert_one(doc)
    return doc


@router.get("/tools")
def tools(request: Request):
    uid(request)
    return {"tools": [{"id": "translator", "name": "AL翻译", "description": "多语言翻译", "icon": "translate", "route": "/aling/translator", "enabled": True}]}


@router.get("/translator/languages")
def languages(request: Request):
    return {"languages": _languages(uid(request))["languages"]}


@router.post("/translator/languages")
def add_language(body: dict, request: Request):
    user_id = uid(request)
    if not body.get("language"):
        fail(400, "Language name is required")
    language = str(body["language"]).strip()
    if not language:
        fail(400, "语言名称不能为空")
    doc = _languages(user_id)
    if language.lower() in [v.strip().lower() for v in doc["languages"]]:
        fail(400, "该语言已存在于选择列表中，不能重复添加")
    st().db.mongo["aling_translator_languages"].update_one({"_id": doc["_id"]}, {"$push": {"languages": language}, "$set": {"updated_at": now()}})
    return {"message": "Language added successfully"}


@router.delete("/translator/languages")
def delete_language(body: dict, request: Request):
    user_id = uid(request)
    if not body.get("language"):
        fail(400, "Language name is required")
    doc = _languages(user_id)
    remaining = [v for v in doc["languages"] if v.strip().lower() != body["language"].strip().lower()]
    st().db.mongo["aling_translator_languages"].update_one({"_id": doc["_id"]}, {"$set": {"languages": remaining, "updated_at": now()}})
    return {"message": "Language deleted successfully"}


@router.post("/translator/languages/reset")
def reset_languages(request: Request):
    user_id = uid(request)
    # The legacy service only updated an existing document; it never created one here.
    st().db.mongo["aling_translator_languages"].update_one({"user_id": oid(user_id)}, {"$set": {"languages": DEFAULT_LANGUAGES.copy(), "updated_at": now()}})
    return {"languages": DEFAULT_LANGUAGES.copy()}


@router.get("/translator/history")
def translation_history(request: Request):
    user_id = uid(request)
    records = list(st().db.mongo["aling_translation_history"].find({"user_id": oid(user_id)}).sort("created_at", DESCENDING))
    return {"history": public(records)}


@router.delete("/translator/history/{id}")
def delete_translation(id: str, request: Request):
    user_id = uid(request)
    if not ObjectId.is_valid(id):
        fail(400, "Invalid history ID")
    st().db.mongo["aling_translation_history"].delete_one({"_id": oid(id), "user_id": oid(user_id)})
    return {"message": "History deleted successfully"}


@router.post("/translator/translate")
def translate(body: dict, request: Request):
    user_id = uid(request)
    text, lang = body.get("text", ""), body.get("target_lang", "")
    if not text or not lang:
        fail(400, "Text and target_lang are required")
    with st().db.session() as s:
        user = s.get(User, user_id)
        reset_credits(st().db, user)
        if user.credits <= 0:
            fail(403, "Insufficient credits", credits=float(user.credits))

    def event(value: dict) -> str:
        return "data: " + json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n\n"

    def generate() -> Iterator[str]:
        prompt = f"You are a professional, highly accurate, context-aware translation engine. Detect the source language and translate into {lang}. Preserve tone and formatting. Output ONLY translated text."
        chunks: list[str] = []
        try:
            model = st().ai.model_for("aling")
            for chunk in model.stream(st().ai.messages([{"role": "user", "content": text}], prompt)):
                value = chunk.content if isinstance(chunk.content, str) else ""
                if value:
                    chunks.append(value)
                    yield event({"type": "token", "content": value})
            translated = "".join(chunks)
            record = {"_id": ObjectId(), "user_id": oid(user_id), "source_text": text, "target_text": translated, "target_lang": lang, "created_at": now()}
            st().db.mongo["aling_translation_history"].insert_one(record)
            credits = deduct(st().db, user_id, count_tokens(text), count_tokens(translated))
            yield event({"type": "done", "history_id": str(record["_id"]), "target_text": translated, "credits": credits})
        except Exception as exc:
            yield event({"type": "error", "content": str(exc)})

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})
