"""REST contract checks: auth, admin, conversations, shares, ALing and misc routes."""
from __future__ import annotations

import time

import jwt as pyjwt
from bson import ObjectId

import app.routes.admin_routes as admin_routes
import app.routes.auth_routes as auth_routes
import app.routes.misc_routes as misc_routes
from app.core import hash_password, now
from app.storage import User
from tests.conftest import CFG, auth, make_user, sse_events


def test_register_login_and_legacy_credentials(client, state, monkeypatch):
    monkeypatch.setattr(auth_routes, "_send_mail", lambda address, code: state.db.redis.set(f"sent:{address}", code, ex=10))
    response = client.post("/api/auth/send-code", json={"email": "new@example.com", "scene": "register"})
    assert response.status_code == 200 and response.json() == {"message": "Verification code sent"}
    code = state.db.redis.get("sent:new@example.com")
    assert state.db.redis.ttl("email_verify:new@example.com") == 600
    assert state.db.redis.ttl("email_limit:new@example.com") == 60
    assert client.post("/api/auth/send-code", json={"email": "new@example.com", "scene": "register"}).json() == {"error": "Please wait a minute before requesting another code"}
    assert client.post("/api/auth/send-code", json={"email": "ghost@example.com", "scene": "reset"}).json() == {"error": "User with this email not found"}

    registered = client.post("/api/auth/register", json={"email": "new@example.com", "nickname": "新用户", "password": "secret123", "confirm_password": "secret123", "code": code})
    assert registered.status_code == 200
    body = registered.json()
    assert set(body) == {"token", "user"}
    assert body["user"]["member_type"] == "free" and body["user"]["credits"] == 1000
    assert "password" not in body["user"]
    assert pyjwt.decode(body["token"], CFG.JWT_SECRET, algorithms=["HS256"])["role"] == "user"
    assert state.db.redis.exists("email_verify:new@example.com") == 0
    assert client.post("/api/auth/register", json={"email": "new@example.com", "nickname": "x", "password": "secret123", "confirm_password": "secret123", "code": "000000"}).json() == {"error": "Invalid or expired verification code"}

    # A password hash written by the Go service (bcrypt $2a/$2b) must keep working.
    legacy, _ = make_user(state, email="legacy@example.com", password="legacy-pass")
    with state.db.session() as session:
        session.get(User, legacy["id"]).password = hash_password("legacy-pass")
    login = client.post("/api/auth/login", json={"email": "legacy@example.com", "password": "legacy-pass"})
    assert login.status_code == 200 and login.json()["user"]["id"] == legacy["id"]
    assert client.post("/api/auth/login", json={"email": "legacy@example.com", "password": "nope"}).json() == {"error": "Invalid email or password"}


def test_old_jwt_is_renewed_through_response_header(client, state):
    user, jwt = make_user(state)
    aged = pyjwt.encode({"user_id": user["id"], "role": "user", "jti": "legacy-jti", "exp": int(time.time()) + 86400}, CFG.JWT_SECRET, algorithm="HS256")
    response = client.get("/api/auth/profile", headers=auth(aged))
    assert response.status_code == 200
    renewed = response.headers["X-New-Token"]
    claims = pyjwt.decode(renewed, CFG.JWT_SECRET, algorithms=["HS256"])
    assert claims["user_id"] == user["id"] and claims["jti"] != "legacy-jti"
    assert "X-New-Token" not in client.get("/api/auth/profile", headers=auth(jwt)).headers


def test_logout_blacklists_and_auth_errors(client, state):
    user, jwt = make_user(state)
    assert client.get("/api/auth/profile").json() == {"error": "Authorization header is required"}
    assert client.get("/api/auth/profile", headers={"Authorization": "Token abc"}).json() == {"error": "Invalid authorization header format"}
    assert client.get("/api/auth/profile", headers={"Authorization": "Bearer broken"}).json() == {"error": "Invalid or expired token"}
    assert client.post("/api/auth/logout", headers=auth(jwt)).json() == {"message": "Logged out successfully"}
    revoked = client.get("/api/auth/profile", headers=auth(jwt))
    assert revoked.status_code == 401 and revoked.json() == {"error": "Token has been revoked"}


def test_profile_and_system_prompt_contract(client, state):
    user, jwt = make_user(state)
    profile = client.get("/api/auth/profile", headers=auth(jwt)).json()
    assert profile["include_datetime"] is False and "include_date_time" not in profile
    assert "member_expiry" not in profile
    assert profile["created_at"].endswith("Z")
    updated = client.put("/api/auth/profile", json={"nickname": "新昵称"}, headers=auth(jwt))
    assert updated.json() == {"message": "Profile updated successfully"}
    assert client.get("/api/auth/profile", headers=auth(jwt)).json()["nickname"] == "新昵称"
    assert client.put("/api/auth/system-prompt", json={"system_prompt": "你是助手", "include_datetime": True, "include_location": False}, headers=auth(jwt)).json() == {"message": "System prompt updated successfully"}
    assert client.get("/api/auth/system-prompt", headers=auth(jwt)).json() == {"system_prompt": "你是助手", "include_datetime": True, "include_location": False}


def test_password_reset_flow(client, state, monkeypatch):
    monkeypatch.setattr(auth_routes, "_send_mail", lambda address, code: state.db.redis.set(f"sent:{address}", code, ex=10))
    user, _ = make_user(state, email="reset@example.com")
    assert client.post("/api/auth/reset-password", json={"email": "reset@example.com", "new_password": "short", "confirm_password": "short", "code": "123456"}).json() == {"error": "Invalid request"}
    assert client.post("/api/auth/send-code", json={"email": "reset@example.com", "scene": "reset"}).status_code == 200
    code = state.db.redis.get("sent:reset@example.com")
    assert client.post("/api/auth/reset-password", json={"email": "reset@example.com", "new_password": "brandnew1", "confirm_password": "brandnew1", "code": code}).json() == {"message": "Password reset successfully"}
    assert client.post("/api/auth/login", json={"email": "reset@example.com", "password": "brandnew1"}).status_code == 200


def test_avatar_and_upgrade_contract(client, state, fake_cos):
    user, jwt = make_user(state, email="avatar@example.com")
    with state.db.session() as session:
        session.get(User, user["id"]).avatar = "https://cdn.example.com/avatars/old.png"
    presign = client.post("/api/cos/presign", json={"filename": "me.png", "folder": "avatars", "mime_type": "image/png"}, headers=auth(jwt)).json()
    assert presign["url"] == "https://cdn.example.com/avatars/me.png" and presign["upload_url"].startswith("https://cos.example.com/avatars/me.png")
    assert client.post("/api/cos/presign", json={"filename": "me.png", "folder": "bad", "mime_type": "image/png"}, headers=auth(jwt)).json() == {"error": "Invalid folder name"}
    updated = client.post("/api/auth/avatar", json={"avatar_url": "https://cdn.example.com/avatars/new.png"}, headers=auth(jwt)).json()
    assert updated == {"message": "Avatar updated successfully", "avatar": "https://cdn.example.com/avatars/new.png"}

    state.db.mongo["invitation_codes"].insert_one({"_id": ObjectId(), "code": "PROCODE123", "type": "pro", "duration_months": 1, "is_used": False, "created_at": now()})
    upgraded = client.post("/api/auth/upgrade", json={"code": "PROCODE123"}, headers=auth(jwt)).json()
    assert upgraded == {"message": "Successfully upgraded", "member_type": "pro"}
    profile = client.get("/api/auth/profile", headers=auth(jwt)).json()
    assert profile["member_type"] == "pro" and profile["credits"] == 5000
    assert client.post("/api/auth/upgrade", json={"code": "PROCODE123"}, headers=auth(jwt)).json() == {"error": "Invalid or used invitation code"}


def test_admin_permissions_and_user_management(client, state):
    admin_user, admin_jwt = make_user(state, email="admin@example.com", role="admin")
    user, jwt = make_user(state, email="member@example.com")
    assert client.get("/api/admin/dashboard", headers=auth(jwt)).status_code == 403
    assert client.get("/api/admin/dashboard", headers=auth(jwt)).json() == {"error": "Admin access required"}
    dashboard = client.get("/api/admin/dashboard", headers=auth(admin_jwt)).json()
    assert set(dashboard) == {"total_users", "today_new_users", "total_conversations", "today_active_convs", "total_messages", "today_new_messages"}
    users = client.get("/api/admin/users", headers=auth(admin_jwt)).json()
    assert [item["email"] for item in users][0] == "member@example.com"
    assert client.get(f"/api/admin/users/{user['id']}", headers=auth(admin_jwt)).status_code == 200
    assert client.get("/api/admin/users/not-an-id", headers=auth(admin_jwt)).json() == {"error": "Invalid user ID"}
    assert client.get(f"/api/admin/users/{ObjectId()}", headers=auth(admin_jwt)).json() == {"error": "User not found"}
    assert client.put(f"/api/admin/users/{user['id']}/role", json={"role": "admin"}, headers=auth(admin_jwt)).json() == {"message": "User role updated successfully"}
    assert client.put(f"/api/admin/users/{user['id']}/credits", json={"credits": 321.5}, headers=auth(admin_jwt)).json() == {"message": "User credits updated successfully"}
    assert client.put(f"/api/admin/users/{user['id']}/member-type", json={"member_type": "max"}, headers=auth(admin_jwt)).json() == {"message": "User member type updated successfully"}
    assert client.put(f"/api/admin/users/{user['id']}/member", json={"credits": 10, "member_type": "pro", "member_expiry": "2026-12-31T00:00:00Z"}, headers=auth(admin_jwt)).json() == {"message": "User member settings updated successfully"}
    profile = client.get("/api/auth/profile", headers=auth(jwt)).json()
    assert profile["role"] == "admin" and profile["member_type"] == "pro" and profile["member_expiry"].startswith("2027-01-01")
    assert client.put(f"/api/admin/users/{user['id']}/role", json={}, headers=auth(admin_jwt)).json() == {"error": "Invalid request"}
    state.db.mongo["conversations"].insert_one({"_id": ObjectId(), "user_id": ObjectId(user["id"]), "title": "x", "created_at": now(), "updated_at": now()})
    assert client.delete(f"/api/admin/users/{user['id']}", headers=auth(admin_jwt)).json() == {"message": "User and their data deleted successfully"}
    assert state.db.mongo["conversations"].count_documents({"user_id": ObjectId(user["id"])}) == 0


def test_admin_announcements_and_feedback(client, state, monkeypatch):
    admin_user, admin_jwt = make_user(state, email="admin@example.com", role="admin")
    state.db.mongo["system_settings"].delete_many({})
    monkeypatch.setattr(admin_routes, "_send_message", lambda *args: None)
    created = client.post("/api/admin/announcements", json={"title": "标题", "content": "内容", "type": "info", "is_active": True}, headers=auth(admin_jwt)).json()
    assert created["published_at"].endswith("Z") and created["is_active"] is True
    assert client.post("/api/admin/announcements", json={"title": "x", "content": "y", "type": "bad"}, headers=auth(admin_jwt)).json() == {"error": "Invalid request"}
    assert [item["id"] for item in client.get("/api/announcements").json()] == [created["id"]]
    assert client.put(f"/api/admin/announcements/{created['id']}", json={"unpublish": True}, headers=auth(admin_jwt)).json() == {"message": "updated"}
    assert client.get("/api/announcements").json() == []
    assert "published_at" not in client.get("/api/admin/announcements", headers=auth(admin_jwt)).json()[0]
    assert client.delete(f"/api/admin/announcements/{created['id']}", headers=auth(admin_jwt)).json() == {"message": "deleted"}

    submitted = client.post("/api/feedback", json={"type": "bug", "content": "坏了", "user_email": "user@example.com"})
    assert submitted.json() == {"message": "submitted"}
    assert client.post("/api/feedback", json={"type": "bad", "content": "x", "user_email": "user@example.com"}).json() == {"error": "Invalid request"}
    feedback = client.get("/api/admin/feedbacks", headers=auth(admin_jwt)).json()[0]
    assert feedback["status"] == "open" and "meta" not in feedback
    assert client.put(f"/api/admin/feedbacks/{feedback['id']}/status", json={"status": "closed"}, headers=auth(admin_jwt)).json() == {"message": "status updated"}
    assert client.put(f"/api/admin/feedbacks/{feedback['id']}/status", json={"status": "nope"}, headers=auth(admin_jwt)).json() == {"error": "Invalid request"}
    assert client.post(f"/api/admin/feedbacks/{feedback['id']}/reply", json={"reply_content": "已修复"}, headers=auth(admin_jwt)).json() == {"message": "Replied successfully"}
    replied = client.get("/api/admin/feedbacks", headers=auth(admin_jwt)).json()[0]
    assert replied["status"] == "replied" and replied["reply_content"] == "已修复" and replied["replied_at"].endswith("Z")
    assert client.delete(f"/api/admin/feedbacks/{feedback['id']}", headers=auth(admin_jwt)).json() == {"message": "deleted"}


def test_admin_invitation_codes_configs_and_settings(client, state):
    admin_user, admin_jwt = make_user(state, email="admin@example.com", role="admin")
    codes = client.post("/api/admin/invitation-codes", json={"count": 2, "type": "max", "duration_months": 3}, headers=auth(admin_jwt)).json()["codes"]
    assert len(codes) == 2 and all(len(code) == 10 for code in codes)
    assert client.post("/api/admin/invitation-codes", json={"count": 0, "type": "max"}, headers=auth(admin_jwt)).json() == {"error": "Invalid request"}
    listed = client.get("/api/admin/invitation-codes", headers=auth(admin_jwt)).json()
    assert {item["code"] for item in listed} == set(codes) and all(item["is_used"] is False for item in listed)

    assert client.get("/api/admin/configs", headers=auth(admin_jwt)).json() == []
    assert client.put("/api/admin/configs", json={"mode": "daily", "base_url": "https://ai.example.com/v1", "api_key": "sk-1", "model": "qwen", "is_active": True}, headers=auth(admin_jwt)).json() == {"message": "Config updated successfully"}
    stored = client.get("/api/admin/configs", headers=auth(admin_jwt)).json()[0]
    assert set(stored) == {"mode", "base_url", "api_key", "model", "is_active", "updated_at"}
    assert state.ai.overrides["daily"].api_key == "sk-1"
    assert client.put("/api/admin/configs", json={"base_url": "https://ai.example.com/v1"}, headers=auth(admin_jwt)).status_code == 500

    assert client.get("/api/admin/settings", headers=auth(admin_jwt)).json() == {"id": "000000000000000000000000", "campaign_config": {"is_active": False, "campaign_credits": {}}, "updated_at": "0001-01-01T00:00:00Z"}
    assert client.put("/api/admin/settings", json={"campaign_config": {"is_active": True, "campaign_credits": {"free": 777}}}, headers=auth(admin_jwt)).json() == {"message": "System settings updated successfully and credits refresh started"}


def test_admin_conversation_and_message_search(client, state):
    admin_user, admin_jwt = make_user(state, email="admin@example.com", role="admin")
    user, jwt = make_user(state, email="member@example.com")
    conversation = client.post("/api/conversations", json={"title": "会话"}, headers=auth(jwt)).json()
    state.db.mongo["messages"].insert_one({"_id": ObjectId(), "conversation_id": ObjectId(conversation["id"]), "role": "user", "content": "查找关键字", "created_at": now()})
    assert [item["id"] for item in client.get("/api/admin/conversations", headers=auth(admin_jwt)).json()] == [conversation["id"]]
    detail = client.get(f"/api/admin/conversations/{conversation['id']}", headers=auth(admin_jwt)).json()
    assert detail["conversation"]["title"] == "会话" and len(detail["messages"]) == 1
    assert client.get("/api/admin/conversations/not-an-id", headers=auth(admin_jwt)).json() == {"error": "Invalid conversation ID"}
    assert client.get("/api/admin/conversations/" + str(ObjectId()), headers=auth(admin_jwt)).json() == {"error": "Conversation not found"}
    assert client.get("/api/admin/messages/search", headers=auth(admin_jwt)).json() == {"error": "Query parameter 'q' is required"}
    assert [item["content"] for item in client.get("/api/admin/messages/search", params={"q": "关键字"}, headers=auth(admin_jwt)).json()] == ["查找关键字"]
    assert client.delete(f"/api/admin/conversations/{conversation['id']}", headers=auth(admin_jwt)).json() == {"message": "Conversation and its messages deleted successfully"}


def test_chat_endpoints_are_rate_limited(client, state):
    user, jwt = make_user(state)
    for _ in range(10):
        assert client.post("/api/chat", json={"conversation_id": "c", "message": "m", "mode": "ghost"}, headers=auth(jwt)).status_code == 400
    limited = client.post("/api/chat", json={"conversation_id": "c", "message": "m", "mode": "ghost"}, headers=auth(jwt))
    assert limited.status_code == 429 and limited.json() == {"error": "Too many requests. Please try again in a minute."}
    state.streams.start("c")
    state.streams.close("c")
    assert client.get("/api/chat/stream", params={"conversation_id": "c"}, headers=auth(jwt)).status_code == 200


def test_conversation_crud_contract(client, state):
    user, jwt = make_user(state)
    created = client.post("/api/conversations", json={}, headers=auth(jwt))
    assert created.status_code == 201 and created.json()["title"] == "New Conversation"
    conversation_id = created.json()["id"]
    assert [item["id"] for item in client.get("/api/conversations", headers=auth(jwt)).json()] == [conversation_id]
    fetched = client.get(f"/api/conversations/{conversation_id}", headers=auth(jwt)).json()
    assert set(fetched) == {"id", "user_id", "title", "created_at", "updated_at", "messages"}
    assert client.get("/api/conversations/not-an-id", headers=auth(jwt)).json() == {"error": "invalid conversation ID"}
    assert client.get(f"/api/conversations/{ObjectId()}", headers=auth(jwt)).json() == {"error": "conversation not found"}
    assert client.put(f"/api/conversations/{conversation_id}/title", json={"title": ""}, headers=auth(jwt)).json() == {"error": "Title is required"}
    assert client.put(f"/api/conversations/{conversation_id}/title", json={"title": "改名"}, headers=auth(jwt)).json() == {"message": "Title updated successfully"}
    assert client.delete(f"/api/conversations/{conversation_id}/messages/after/{ObjectId()}", headers=auth(jwt)).json() == {"message": "Messages deleted successfully"}
    invalid_delete = client.delete("/api/conversations/not-an-id", headers=auth(jwt))
    assert invalid_delete.status_code == 500 and invalid_delete.json() == {"error": "invalid conversation ID"}
    assert client.delete("/api/conversations/not-an-id", headers=auth(jwt)).json() == {"error": "invalid conversation ID"}
    assert client.delete(f"/api/conversations/{conversation_id}", headers=auth(jwt)).json() == {"message": "Conversation deleted successfully"}
    assert client.delete(f"/api/conversations/{conversation_id}", headers=auth(jwt)).status_code == 404


def test_generate_title_endpoint(client, state):
    user, jwt = make_user(state)
    conversation = client.post("/api/conversations", json={"title": "标题"}, headers=auth(jwt)).json()
    assert client.post(f"/api/conversations/{conversation['id']}/generate-title", headers=auth(jwt)).json() == {"error": "No messages in conversation"}
    state.db.mongo["messages"].insert_one({"_id": ObjectId(), "conversation_id": ObjectId(conversation["id"]), "role": "user", "content": "问题", "created_at": now()})
    response = client.post(f"/api/conversations/{conversation['id']}/generate-title", headers=auth(jwt)).json()
    assert response == {"title": "生成的标题"}
    assert client.get(f"/api/conversations/{conversation['id']}", headers=auth(jwt)).json()["title"] == "生成的标题"
    assert client.post("/api/conversations/not-an-id/generate-title", headers=auth(jwt)).json() == {"error": "Failed to fetch messages"}


def test_share_lifecycle_and_statuses(client, state):
    user, jwt = make_user(state, email="sharer@example.com")
    other, other_jwt = make_user(state, email="reader@example.com")
    conversation = client.post("/api/conversations", json={"title": "分享会话"}, headers=auth(jwt)).json()
    user_message = state.db.mongo["messages"].insert_one({"_id": ObjectId(), "conversation_id": ObjectId(conversation["id"]), "role": "user", "content": "问题", "created_at": now()})
    assistant = state.db.mongo["messages"].insert_one({"_id": ObjectId(), "conversation_id": ObjectId(conversation["id"]), "role": "assistant", "content": "答案", "parent_id": user_message.inserted_id, "created_at": now()})
    assert client.post("/api/conversations/not-an-id/share", headers=auth(jwt)).json() == {"error": "Invalid conversation ID"}
    assert client.post(f"/api/conversations/{ObjectId()}/share", headers=auth(jwt)).json() == {"error": "对话不存在或无权限"}
    share = client.post(f"/api/conversations/{conversation['id']}/share", json={"leaf_message_id": str(ObjectId())}, headers=auth(jwt))
    assert share.json() == {"error": "未找到消息"}
    share = client.post(f"/api/conversations/{conversation['id']}/share", json={}, headers=auth(jwt)).json()
    assert len(share["share_token"]) == 8 and share["message_ids"] == [str(user_message.inserted_id), str(assistant.inserted_id)]
    assert share["leaf_message_id"] == str(assistant.inserted_id) and share["user_nickname"] == "昵称"

    public = client.get(f"/api/shared/{share['share_token']}").json()
    assert public["status"] == "active" and public["sharer_nickname"] == "昵称" and len(public["messages"]) == 2
    assert "password" not in public["messages"][0]
    assert client.get("/api/shared/unknown").status_code == 404
    assert client.get("/api/my/shared", headers=auth(jwt)).json()[0]["share_token"] == share["share_token"]

    saved = client.post(f"/api/shared/{share['share_token']}/save", headers=auth(other_jwt)).json()
    copied = client.get(f"/api/conversations/{saved['conversation_id']}", headers=auth(other_jwt)).json()
    assert copied["title"] == "[来自分享] 分享会话"
    assert [message["content"] for message in copied["messages"]] == ["问题", "答案"]

    assert client.delete(f"/api/shared/{share['share_token']}", headers=auth(other_jwt)).json() == {"error": "分享不存在或无权限"}
    assert client.delete(f"/api/shared/{share['share_token']}", headers=auth(jwt)).json() == {"message": "分享已删除"}
    assert client.get(f"/api/shared/{share['share_token']}").json()["status"] == "deleted"
    assert client.post(f"/api/shared/{share['share_token']}/save", headers=auth(other_jwt)).json() == {"error": "分享不存在或已失效"}


def test_aling_translator_contract(client, state):
    user, jwt = make_user(state)
    assert client.get("/api/aling/tools", headers=auth(jwt)).json()["tools"][0]["id"] == "translator"
    assert client.get("/api/aling/translator/languages", headers=auth(jwt)).json() == {"languages": ["中文", "英语", "日语", "韩语", "法语", "西班牙语"]}
    assert client.post("/api/aling/translator/languages", json={"language": ""}, headers=auth(jwt)).json() == {"error": "Language name is required"}
    assert client.post("/api/aling/translator/languages", json={"language": "   "}, headers=auth(jwt)).json() == {"error": "语言名称不能为空"}
    assert client.post("/api/aling/translator/languages", json={"language": "德语"}, headers=auth(jwt)).json() == {"message": "Language added successfully"}
    assert client.post("/api/aling/translator/languages", json={"language": "德语"}, headers=auth(jwt)).json() == {"error": "该语言已存在于选择列表中，不能重复添加"}
    assert client.request("DELETE", "/api/aling/translator/languages", json={"language": "德语"}, headers=auth(jwt)).json() == {"message": "Language deleted successfully"}
    assert "德语" not in client.get("/api/aling/translator/languages", headers=auth(jwt)).json()["languages"]
    assert client.post("/api/aling/translator/languages/reset", headers=auth(jwt)).json() == {"languages": ["中文", "英语", "日语", "韩语", "法语", "西班牙语"]}

    response = client.post("/api/aling/translator/translate", json={"text": "你好", "target_lang": "英语"}, headers=auth(jwt))
    events = sse_events(response.text)
    assert [event["type"] for event in events] == ["token", "token", "done"]
    assert events[-1]["target_text"] == "答案" and events[-1]["history_id"]
    history = client.get("/api/aling/translator/history", headers=auth(jwt)).json()["history"]
    assert history[0]["source_text"] == "你好" and history[0]["target_lang"] == "英语"
    assert client.delete("/api/aling/translator/history/not-an-id", headers=auth(jwt)).json() == {"error": "Invalid history ID"}
    assert client.delete(f"/api/aling/translator/history/{history[0]['id']}", headers=auth(jwt)).json() == {"message": "History deleted successfully"}
    assert client.get("/api/aling/translator/history", headers=auth(jwt)).json() == {"history": []}


def test_aling_translate_requires_credits(client, state):
    user, jwt = make_user(state, credits=0)
    response = client.post("/api/aling/translator/translate", json={"text": "你好", "target_lang": "英语"}, headers=auth(jwt))
    assert response.status_code == 403 and response.json() == {"error": "Insufficient credits", "credits": 0}
    assert client.post("/api/aling/translator/translate", json={"text": "", "target_lang": ""}, headers=auth(jwt)).json() == {"error": "Text and target_lang are required"}


def test_proxy_icon_and_location_contract(client, state, monkeypatch):
    class FakeResponse:
        def __init__(self, payload=None, headers=None, status_code=200):
            self._payload = payload or {}
            self.headers = headers or {}
            self.status_code = status_code
            self.content = b"icon-bytes"

        def json(self):
            return self._payload

    monkeypatch.setattr(misc_routes.httpx, "get", lambda url, **kwargs: FakeResponse({"address": {"state": "广东省", "city": "深圳市", "suburb": "南山区", "road": "科技路", "house_number": "1号"}}, {"content-type": "image/png"}, 200))
    user, jwt = make_user(state)
    assert client.get("/api/proxy/icon").json() == {"error": "url parameter is required"}
    assert client.get("/api/proxy/icon", params={"url": "ftp://x"}).json() == {"error": "invalid url"}
    icon = client.get("/api/proxy/icon", params={"url": "https://cdn.example.com/favicon.ico"})
    assert icon.status_code == 200 and icon.headers["content-type"] == "image/png" and icon.content == b"icon-bytes"
    assert client.post("/api/location/resolve", json={}, headers=auth(jwt)).json() == {"error": "lat and lng are required"}
    assert client.post("/api/location/resolve", json={"lat": 22.5, "lng": 114.0}, headers=auth(jwt)).json() == {"address": "广东省, 深圳市, 南山区, 科技路 1号"}

    monkeypatch.setattr(misc_routes.httpx, "get", lambda url, **kwargs: (_ for _ in ()).throw(RuntimeError("offline")))
    assert client.post("/api/location/resolve", json={"lat": 22.5, "lng": 114.0}, headers=auth(jwt)).json() == {"address": "22.500000, 114.000000"}
    assert client.get("/api/proxy/icon", params={"url": "https://cdn.example.com/a.png"}).status_code == 502


def test_upload_reference_and_delete(client, state, fake_cos):
    user, jwt = make_user(state)
    assert client.post("/api/chat/upload-reference", files=[("file", ("a.txt", b"hello", "text/plain"))], headers=auth(jwt)).json() == {"error": "Invalid file type. Only common image and video formats are allowed"}
    uploaded = client.post("/api/chat/upload-reference", files=[("file", ("a.png", b"\x89PNGdata", "image/png"))], headers=auth(jwt)).json()
    assert uploaded == {"url": "https://cdn.example.com/reference_files/uploadeda.png"}
    assert client.request("DELETE", "/api/chat/reference-image", json={"url": "https://cdn.example.com/reference_files/uploadeda.png"}, headers=auth(jwt)).json() == {"message": "Image deleted successfully"}
    assert fake_cos.deleted == ["reference_files/uploadeda.png"]
    assert client.request("DELETE", "/api/chat/reference-image", json={"url": "not-a-url"}, headers=auth(jwt)).json() == {"error": "Invalid image URL"}


def test_health_and_cors_contract(client, state):
    health = client.get("/health").json()
    assert set(health) == {"status", "mongodb", "redis", "version", "gin_mode"}
    assert health["status"] == "ok" and health["version"] == "1.0.0" and health["gin_mode"] == "debug"
    assert client.get("/health/").status_code != 307
    preflight = client.options("/api/chat", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"})
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert "X-New-Token" in response.headers["access-control-expose-headers"]
    assert "POST" in preflight.headers["access-control-allow-methods"]
    assert client.options("/api/chat", headers={"Origin": "http://evil.example.com", "Access-Control-Request-Method": "POST"}).status_code == 400
