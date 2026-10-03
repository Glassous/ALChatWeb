from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import timedelta
from typing import Any

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING

from .core import now
from .storage import Storage, oid, public


def temp_id(prefix: str = "temp_") -> str:
    if prefix.startswith("temp_"):
        prefix = prefix.removeprefix("temp_")
    return f"temp_{prefix}{int(time.time() * 1000)}_{secrets.token_hex(2)[:3]}"


def is_temp(value: str) -> bool:
    return value.startswith("temp_")


PLACEHOLDER_TITLES = ("", " ", "New Conversation", "临时对话")


def title_source(messages: list[dict]) -> list[dict]:
    """Strip rendered tags from assistant turns before title generation."""
    import re

    re_search = re.compile(r"(?s)\n?<(?:search|weather)>.*?</(?:search|weather)>\n?")
    re_image = re.compile(r'(?i)<image src="([^"]+)">')
    output = []
    for message in messages:
        content = message.get("content", "")
        if message.get("role") == "assistant":
            content = re_search.sub("", content)
            content = re_image.sub(r"![image](\1)", content).strip() or "[已为您完成]"
        output.append({**message, "content": content})
    return output


class Conversations:
    def __init__(self, db: Storage):
        self.db = db
        self.convs = db.mongo["conversations"]
        self.messages = db.mongo["messages"]

    def create(self, user_id: str, title: str = "") -> dict:
        value = {"_id": ObjectId(), "user_id": oid(user_id), "title": title, "created_at": now(), "updated_at": now()}
        self.convs.insert_one(value)
        return public(value)

    def all(self, user_id: str) -> list[dict]:
        return public(list(self.convs.find({"user_id": oid(user_id)}).sort("updated_at", DESCENDING)))

    def get(self, user_id: str, conversation_id: str) -> dict | None:
        value = self.convs.find_one({"_id": oid(conversation_id), "user_id": oid(user_id)})
        if not value:
            return None
        value = public(value)
        value["messages"] = public(list(self.messages.find({"conversation_id": oid(conversation_id)}).sort("created_at", ASCENDING)))
        return value

    def save(self, user_id: str, conversation_id: str, role: str, content: str, parent_id: str = "") -> dict:
        # Existing Go implementation accepts any syntactically valid conversation ID.
        parent = oid(parent_id) if ObjectId.is_valid(parent_id) else None
        value = {"_id": ObjectId(), "conversation_id": oid(conversation_id), "role": role, "content": content, "created_at": now()}
        if parent:
            value["parent_id"] = parent
        self.messages.insert_one(value)
        self.convs.update_one({"_id": oid(conversation_id)}, {"$set": {"updated_at": now()}})
        if parent:
            self.db.redis.delete(f"alchat:branch:{parent}")
        return public(value)

    def update_message(self, value: dict) -> None:
        fields = {
            "content": value.get("content") or "",
            "reasoning": value.get("reasoning") or "",
            "mode": value.get("mode") or "",
            "hermes_response_id": value.get("hermes_response_id") or "",
            "hermes_context_version": value.get("hermes_context_version") or 0,
            "hermes_response_completed": bool(value.get("hermes_response_completed")),
        }
        # Go used bson omitempty for these optional fields; only write them when set.
        if value.get("search") is not None:
            fields["search"] = value["search"]
        if value.get("hermes_trace"):
            fields["hermes_trace"] = value["hermes_trace"]
        for key in ("attachments", "attachment_texts", "agent_run_id", "agent_status", "agent_trace", "agent_error", "agent_budget", "agent_notice", "agent_finish_reason", "agent_discovery"):
            if key in value:
                fields[key] = value[key]
        self.messages.update_one({"_id": oid(value["id"])}, {"$set": fields})
        self.db.redis.delete(f"alchat:branch:{value['id']}")

    def branch(self, conversation_id: str, leaf_id: str) -> list[dict]:
        cache_key = f"alchat:branch:{leaf_id}"
        cached = self.db.redis.get(cache_key)
        if cached:
            try:
                return json.loads(cached)
            except ValueError:
                pass
        all_messages = list(self.messages.find({"conversation_id": oid(conversation_id)}).sort("created_at", ASCENDING))
        by_id = {str(m["_id"]): m for m in all_messages}
        branch = []
        cursor = leaf_id
        while cursor in by_id:
            message = by_id[cursor]
            branch.append(message)
            cursor = str(message.get("parent_id", ""))
        result = public(branch[::-1])
        self.db.redis.set(cache_key, json.dumps(result, ensure_ascii=False), ex=86400)
        return result

    def delete(self, user_id: str, conversation_id: str) -> bool:
        if not self.convs.find_one({"_id": oid(conversation_id), "user_id": oid(user_id)}):
            return False
        self.messages.delete_many({"conversation_id": oid(conversation_id)})
        self.convs.delete_one({"_id": oid(conversation_id)})
        return True

    def title(self, user_id: str, conversation_id: str, value: str) -> None:
        self.convs.update_one({"_id": oid(conversation_id), "user_id": oid(user_id)}, {"$set": {"title": value, "updated_at": now()}})

    def auto_title(self, user_id: str, conversation_id: str) -> str:
        """Generate a title while the conversation still carries a placeholder."""
        conversation = self.convs.find_one({"_id": oid(conversation_id)})
        if not conversation:
            return ""
        if conversation.get("title", "") not in PLACEHOLDER_TITLES:
            return conversation["title"]
        messages = public(list(self.messages.find({"conversation_id": oid(conversation_id)}).sort("created_at", ASCENDING)))
        if not messages:
            return ""
        from .main import current

        title = current().ai.title(title_source(messages))
        if not title:
            return ""
        self.title(user_id, conversation_id, title)
        return title


class TemporaryConversations:
    ttl = 3600

    def __init__(self, db: Storage):
        self.db = db
        self.redis = db.redis

    def conv_key(self, id: str) -> str:
        return f"alchat:temp:conv:{id}"

    def list_key(self, id: str) -> str:
        return f"alchat:temp:conv:{id}:msgs"

    def msg_key(self, id: str) -> str:
        return f"alchat:temp:msg:{id}"

    def create(self, id: str, title: str = "临时对话") -> dict:
        t = public(now())
        value = {"id": id, "title": title, "created_at": t, "updated_at": t}
        self.redis.set(self.conv_key(id), json.dumps(value, ensure_ascii=False), ex=self.ttl)
        return value

    def get(self, id: str) -> dict | None:
        raw = self.redis.get(self.conv_key(id))
        return json.loads(raw) if raw else None

    def save(self, conversation_id: str, role: str, content: str, parent_id: str = "") -> dict:
        id = temp_id("temp_msg_")
        value = {"id": id, "conversation_id": conversation_id, "role": role, "content": content, "created_at": public(now())}
        if parent_id:
            value["parent_id"] = parent_id
        self.redis.set(self.msg_key(id), json.dumps(value, ensure_ascii=False), ex=self.ttl)
        self.redis.rpush(self.list_key(conversation_id), id)
        self.refresh(conversation_id)
        return value

    def update(self, value: dict) -> None:
        self.redis.set(self.msg_key(value["id"]), json.dumps(value, ensure_ascii=False), ex=self.ttl)

    def refresh(self, id: str) -> None:
        keys = [self.conv_key(id), self.list_key(id)] + [self.msg_key(m) for m in self.redis.lrange(self.list_key(id), 0, -1)]
        for key in keys:
            self.redis.expire(key, self.ttl)

    def messages(self, id: str) -> list[dict]:
        return [json.loads(raw) for mid in self.redis.lrange(self.list_key(id), 0, -1) if (raw := self.redis.get(self.msg_key(mid)))]

    @staticmethod
    def legacy_message(value: dict) -> dict:
        # The Go GET endpoint exposed deterministic pseudo ObjectIDs while the
        # Redis records kept their original temp IDs for branch traversal.
        def pseudo(raw: str) -> str:
            return raw if ObjectId.is_valid(raw) else hashlib.md5(raw.encode()).digest()[:12].hex()
        result = value.copy()
        result["id"] = pseudo(value["id"])
        result["conversation_id"] = pseudo(value["conversation_id"])
        if value.get("parent_id"):
            result["parent_id"] = pseudo(value["parent_id"])
        return result

    def branch(self, id: str, leaf_id: str) -> list[dict]:
        by_id = {m["id"]: m for m in self.messages(id)}
        output = []
        while leaf_id in by_id:
            value = by_id[leaf_id]
            output.append(value)
            leaf_id = value.get("parent_id", "")
        return output[::-1]

    def delete(self, id: str) -> None:
        keys = [self.conv_key(id), self.list_key(id)] + [self.msg_key(mid) for mid in self.redis.lrange(self.list_key(id), 0, -1)]
        self.redis.delete(*keys)

    def promote(self, id: str, user_id: str, permanent: Conversations) -> dict:
        temp = self.get(id)
        if not temp:
            raise ValueError("Temp conversation not found or expired")
        new = permanent.create(user_id, "临时对话")
        id_map: dict[str, str] = {}
        for message in self.messages(id):
            saved = permanent.save(user_id, new["id"], message["role"], message["content"], id_map.get(message.get("parent_id", ""), ""))
            saved.update({k: message[k] for k in ("reasoning", "search") if k in message})
            permanent.update_message(saved)
            id_map[message["id"]] = saved["id"]
        self.delete(id)
        return new
