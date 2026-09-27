"""URL 冒烟测试：按旧版 Go 契约逐项检查已启动的 Python 后端。

用法（在 backend/ 目录执行）：
    python smoke_api.py --base-url http://localhost:8080
    python smoke_api.py --base-url http://localhost:8080 --redis-container alchat-redis
    python smoke_api.py --base-url http://localhost:8080 --redis-container alchat-redis --ai

参数说明：
    --base-url         后端地址，默认 http://localhost:8080
    --redis-container  可选，Docker 容器名；提供后会创建测试账号并验证鉴权接口
    --ai               额外调用真实 AI provider，验证 /api/chat 的 SSE 事件顺序

脚本只读校验公开与错误响应；提供 --redis-container 时会注册一个测试账号
（邮箱形如 api-smoke-<时间戳>@example.com），并在结束时删除该账号由测试创建的会话。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from typing import Any

import httpx

RESULTS: list[tuple[str, bool, str]] = []
# 真实聊天会消耗 /api/chat 的 10/min 配额，限流断言需要按已用次数推进。
CHAT_CALLS_USED = 0
AUTH_ROUTES = ("/api/auth/send-code", "/api/auth/register", "/api/auth/login", "/api/auth/reset-password")
RATE_LIMITS_USED: dict[str, int] = {}


def check(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{(' -> ' + detail) if detail and not ok else ''}")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--redis-container", default="")
    parser.add_argument("--ai", action="store_true")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    # trust_env=False: 直连目标地址，避免本机代理环境变量拦截 localhost。
    client = httpx.Client(base_url=base, timeout=httpx.Timeout(30, read=180), trust_env=False)

    public_contract(client)
    token = ""
    if args.redis_container:
        clear_rate_limits(args.redis_container)
        token, email = register_flow(client, args.redis_container)
    if token:
        authenticated_contract(client, token)
        if args.ai:
            chat_sse_flow(client, token)
            aling_sse_flow(client, token)
        rate_limit_contract(client, token)
    else:
        rate_limit_contract(client, "")

    failed = [item for item in RESULTS if not item[1]]
    print("\n==== 结果 ====")
    print(f"通过 {len(RESULTS) - len(failed)} / {len(RESULTS)}")
    for name, _, detail in failed:
        print(f"  FAIL {name} -> {detail}")
    return 1 if failed else 0


def expect(name: str, response: httpx.Response, status: int, body: Any | None = None) -> bool:
    ok = response.status_code == status
    if ok and body is not None:
        try:
            actual = response.json()
        except ValueError:
            actual = response.text
        ok = actual == body
        return check(name, ok, f"期望 {status} {body}，实际 {response.status_code} {actual}")
    return check(name, ok, f"期望 {status}，实际 {response.status_code} {response.text[:200]}")


def public_contract(client: httpx.Client) -> None:
    health = client.get("/health")
    body = health.json()
    check("/health 字段与状态", health.status_code == 200 and set(body) == {"status", "mongodb", "redis", "version", "gin_mode"} and body["status"] == "ok", str(body))
    check("/health/ 不重定向", client.get("/health/").status_code != 307)
    expect("POST /api/auth/login 非法请求体 400", client.post("/api/auth/login", content="{", headers={"content-type": "application/json"}), 400, {"error": "Invalid request"})
    expect("GET /api/auth/profile 缺少鉴权 401", client.get("/api/auth/profile"), 401, {"error": "Authorization header is required"})
    expect("GET /api/auth/profile 非法头 401", client.get("/api/auth/profile", headers={"Authorization": "Token x"}), 401, {"error": "Invalid authorization header format"})
    expect("GET /api/auth/profile 坏令牌 401", client.get("/api/auth/profile", headers={"Authorization": "Bearer broken"}), 401, {"error": "Invalid or expired token"})
    expect("GET /api/conversations 缺少鉴权 401", client.get("/api/conversations"), 401, {"error": "Authorization header is required"})
    announcements = client.get("/api/announcements")
    check("GET /api/announcements 公开可访问", announcements.status_code == 200 and isinstance(announcements.json(), list), announcements.text[:120])
    expect("GET /api/proxy/icon 缺少参数 400", client.get("/api/proxy/icon"), 400, {"error": "url parameter is required"})
    expect("GET /api/proxy/icon 非法协议 400", client.get("/api/proxy/icon", params={"url": "ftp://x"}), 400, {"error": "invalid url"})
    expect("GET /api/shared/{token} 不存在 404", client.get("/api/shared/unknown-token"), 404, {"error": "分享链接不存在"})
    check("OPTIONS 预检放行合法来源", client.options("/api/chat", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization"}).status_code in (200, 204))
    check("OPTIONS 预检拒绝非法来源", client.options("/api/chat", headers={"Origin": "http://evil.example.com", "Access-Control-Request-Method": "POST"}).status_code == 400)


def redis_get(container: str, key: str) -> str:
    result = subprocess.run(["docker", "exec", container, "redis-cli", "GET", key], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def clear_rate_limits(container: str) -> None:
    """清掉本机遗留的限流计数，保证脚本可连续重复运行（只影响 ratelimit:* 键）。"""
    subprocess.run(["docker", "exec", container, "sh", "-c", "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli DEL"], capture_output=True, text=True)


def post(client: httpx.Client, path: str, payload: dict | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    """功能调用：若撞上未过期的限流窗口，等待窗口重置后重试一次。"""
    response = client.post(path, json=payload, headers=headers)
    if path in AUTH_ROUTES:
        RATE_LIMITS_USED[path] = RATE_LIMITS_USED.get(path, 0) + 1
    if response.status_code == 429:
        time.sleep(61)
        response = client.post(path, json=payload, headers=headers)
        if path in AUTH_ROUTES:
            RATE_LIMITS_USED[path] = RATE_LIMITS_USED.get(path, 0) + 1
    return response


def login(client: httpx.Client, email: str, password: str) -> httpx.Response:
    return post(client, "/api/auth/login", {"email": email, "password": password})


def register_flow(client: httpx.Client, container: str) -> tuple[str, str]:
    email = f"api-smoke-{int(time.time())}@example.com"
    credentials = {"email": email, "nickname": "冒烟", "password": "secret123", "confirm_password": "secret123"}
    sent = post(client, "/api/auth/send-code", {"email": email, "scene": "register"})
    check("POST /api/auth/send-code 发送验证码", sent.status_code == 200, sent.text[:200])
    if sent.status_code != 200:
        return "", email
    code = redis_get(container, f"email_verify:{email}")
    check("验证码已写入 Redis(email_verify)", len(code) == 6, code)
    expect("POST /api/auth/register 验证码错误 400", post(client, "/api/auth/register", {**credentials, "code": "000000"}), 400, {"error": "Invalid or expired verification code"})
    registered = post(client, "/api/auth/register", {**credentials, "code": code})
    body = registered.json() if registered.status_code == 200 else {}
    check("POST /api/auth/register 成功返回 token+user", registered.status_code == 200 and set(body) == {"token", "user"} and body["user"]["credits"] == 1000 and "password" not in body["user"], registered.text[:200])
    logged_in = login(client, email, "secret123")
    check("POST /api/auth/login 成功", logged_in.status_code == 200 and logged_in.json()["user"]["email"] == email, logged_in.text[:200])
    expect("POST /api/auth/login 错误密码 401", login(client, email, "wrong"), 401, {"error": "Invalid email or password"})
    # 同一邮箱 60 秒内重复取码会被 email_limit 拦截（不重试，直接观察 429）。
    throttled = client.post("/api/auth/send-code", json={"email": email, "scene": "register"})
    check("POST /api/auth/send-code 60s 内重复 429", throttled.status_code == 429 and throttled.json() == {"error": "Please wait a minute before requesting another code"}, throttled.text[:200])
    # 验证码是一次性的：清除节流键后取新码，重复注册才会走到邮箱重复检查。
    subprocess.run(["docker", "exec", container, "redis-cli", "DEL", f"email_limit:{email}"], capture_output=True, text=True)
    post(client, "/api/auth/send-code", {"email": email, "scene": "register"})
    fresh_code = redis_get(container, f"email_verify:{email}")
    expect("POST /api/auth/register 重复邮箱 409", post(client, "/api/auth/register", {**credentials, "code": fresh_code}), 409, {"error": "Email already registered"})
    return (logged_in.json()["token"] if logged_in.status_code == 200 else ""), email


def authenticated_contract(client: httpx.Client, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    profile = client.get("/api/auth/profile", headers=headers)
    body = profile.json()
    check("GET /api/auth/profile 字段契约", profile.status_code == 200 and "include_datetime" in body and "include_date_time" not in body and "password" not in body and body["created_at"].endswith("Z"), profile.text[:200])
    expect("PUT /api/auth/profile 成功", client.put("/api/auth/profile", json={"nickname": "冒烟改名"}, headers=headers), 200, {"message": "Profile updated successfully"})
    expect("PUT /api/auth/system-prompt 成功", client.put("/api/auth/system-prompt", json={"system_prompt": "你是助手", "include_datetime": True, "include_location": False}, headers=headers), 200, {"message": "System prompt updated successfully"})
    system_prompt = client.get("/api/auth/system-prompt", headers=headers).json()
    check("GET /api/auth/system-prompt 回读", system_prompt == {"system_prompt": "你是助手", "include_datetime": True, "include_location": False}, str(system_prompt))
    custom = client.get("/api/auth/custom-model", headers=headers).json()
    check("GET /api/auth/custom-model 视图字段", set(custom) == {"enabled", "base_url", "model", "daily_enabled", "expert_enabled", "search_enabled", "has_api_key", "api_key_masked", "response_mode", "last_tested_at"} and custom["has_api_key"] is False, str(custom))
    hermes = client.get("/api/auth/hermes", headers=headers).json()
    check("GET /api/auth/hermes 视图字段", set(hermes) == {"base_url", "model", "has_api_key", "tested", "context_version", "last_tested_at"}, str(hermes))
    tools = client.get("/api/aling/tools", headers=headers).json()
    check("GET /api/aling/tools", tools["tools"][0]["id"] == "translator", str(tools))
    languages = client.get("/api/aling/translator/languages", headers=headers).json()
    check("GET /api/aling/translator/languages 预设", languages == {"languages": ["中文", "英语", "日语", "韩语", "法语", "西班牙语"]}, str(languages))

    created = client.post("/api/conversations", json={"title": "冒烟会话"}, headers=headers)
    conversation = created.json()
    check("POST /api/conversations 201", created.status_code == 201 and conversation["title"] == "冒烟会话", created.text[:200])
    conversation_id = conversation["id"]
    expect("PUT /api/conversations/{id}/title 空标题 400", client.put(f"/api/conversations/{conversation_id}/title", json={"title": ""}, headers=headers), 400, {"error": "Title is required"})
    expect("PUT /api/conversations/{id}/title 成功", client.put(f"/api/conversations/{conversation_id}/title", json={"title": "冒烟改名"}, headers=headers), 200, {"message": "Title updated successfully"})
    fetched = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
    check("GET /api/conversations/{id} 结构", set(fetched) == {"id", "user_id", "title", "created_at", "updated_at", "messages"} and fetched["messages"] == [], str(fetched)[:200])
    expect("GET /api/conversations/{id} 非法 ID 404", client.get("/api/conversations/not-an-id", headers=headers), 404, {"error": "invalid conversation ID"})
    invalid_delete = client.delete("/api/conversations/not-an-id", headers=headers)
    check("DELETE /api/conversations/{id} 非法 ID 500 JSON", invalid_delete.status_code == 500 and invalid_delete.json() == {"error": "invalid conversation ID"}, invalid_delete.text[:200])
    expect("POST /api/conversations/{id}/share 空会话 400", client.post(f"/api/conversations/{conversation_id}/share", json={}, headers=headers), 400, {"error": "对话中没有消息"})
    expect("GET /api/admin/dashboard 非管理员 403", client.get("/api/admin/dashboard", headers=headers), 403, {"error": "Admin access required"})
    listed = client.get("/api/conversations", headers=headers).json()
    check("GET /api/conversations 列表包含新会话", any(item["id"] == conversation_id for item in listed), str(listed)[:200])
    expect("DELETE /api/conversations/{id} 成功", client.delete(f"/api/conversations/{conversation_id}", headers=headers), 200, {"message": "Conversation deleted successfully"})
    expect("DELETE /api/conversations/{id} 重复删除 404", client.delete(f"/api/conversations/{conversation_id}", headers=headers), 404, {"error": "conversation not found or access denied"})


def chat_sse_flow(client: httpx.Client, token: str) -> None:
    global CHAT_CALLS_USED
    headers = {"Authorization": f"Bearer {token}"}
    conversation = client.post("/api/conversations", json={"title": "New Conversation"}, headers=headers).json()
    conversation_id = conversation["id"]
    CHAT_CALLS_USED += 1
    started = client.post("/api/chat", json={"conversation_id": conversation_id, "message": "用一句话说明什么是二分查找", "mode": "daily"}, headers=headers)
    check("POST /api/chat 返回消息 ID", started.status_code == 200 and set(started.json()) == {"user_message_id", "assistant_message_id"}, started.text[:200])
    if started.status_code != 200:
        return
    events = collect_sse(client, f"/api/chat/stream?conversation_id={conversation_id}", headers)
    types = [event.get("type") for event in events]
    print(f"       SSE 事件序列: {types}")
    reasoning = "".join(event.get("content", "") for event in events if event.get("type") == "reasoning")
    answer = "".join(event.get("content", "") for event in events if event.get("type") == "token")
    print(f"       reasoning 长度={len(reasoning)} 回答前 60 字: {answer[:60]}")
    check("GET /api/chat/stream 事件序列", bool(types) and types[0] == "generation_mode" and types[-1] in ("done", "error"), str(types))
    check("SSE done 事件字段", not events or types[-1] != "done" or set(events[-1]["data"]) >= {"user_message_id", "assistant_message_id", "credits"}, str(events[-1:] if events else []))
    stored = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
    assistant = [message for message in stored["messages"] if message["role"] == "assistant"]
    check("助手消息已持久化", bool(assistant) and bool(assistant[0]["content"]), str(stored["messages"])[:200])
    if assistant and assistant[0]["content"]:
        share = client.post(f"/api/conversations/{conversation_id}/share", json={}, headers=headers)
        check("POST /api/conversations/{id}/share 成功", share.status_code == 200 and len(share.json()["share_token"]) == 8, share.text[:200])
        if share.status_code == 200:
            token_value = share.json()["share_token"]
            public = client.get(f"/api/shared/{token_value}").json()
            check("GET /api/shared/{token} active 且带消息", public.get("status") == "active" and len(public.get("messages", [])) >= 2, str(public)[:200])
            check("GET /api/my/shared 包含分享", any(item["share_token"] == token_value for item in client.get("/api/my/shared", headers=headers).json()))
            expect("DELETE /api/shared/{token} 成功", client.delete(f"/api/shared/{token_value}", headers=headers), 200, {"message": "分享已删除"})
            check("分享删除后状态", client.get(f"/api/shared/{token_value}").json().get("status") == "deleted")
    client.delete(f"/api/conversations/{conversation_id}", headers=headers)


def collect_sse(client: httpx.Client, path: str, headers: dict[str, str]) -> list[dict]:
    events: list[dict] = []
    with client.stream("GET", path, headers=headers) as response:
        for line in response.iter_lines():
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[len("data: "):]))
                except ValueError:
                    continue
    return events


def aling_sse_flow(client: httpx.Client, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/api/aling/translator/translate", json={"text": "今天天气很好。", "target_lang": "英语"}, headers=headers)
    events = sse_of_text(response.text)
    types = [event.get("type") for event in events]
    print(f"       ALing SSE 事件序列: {types}")
    check("翻译 SSE 事件序列", bool(types) and types[:-1] == ["token"] * (len(types) - 1) and types[-1] in ("done", "error"), str(types))
    if types and types[-1] == "done":
        done = events[-1]
        check("翻译 done 字段", {"history_id", "target_text", "credits"} <= set(done) and bool(done["target_text"]), str(done)[:200])
        history = client.get("/api/aling/translator/history", headers=headers).json()["history"]
        check("翻译历史已写入", bool(history) and history[0]["id"] == done["history_id"], str(history)[:200])
        expect("DELETE /api/aling/translator/history/{id} 成功", client.delete(f"/api/aling/translator/history/{done['history_id']}", headers=headers), 200, {"message": "History deleted successfully"})


def sse_of_text(text: str) -> list[dict]:
    events: list[dict] = []
    for line in text.splitlines():
        if line.startswith("data: "):
            try:
                events.append(json.loads(line[len("data: "):]))
            except ValueError:
                continue
    return events


def rate_limit_contract(client: httpx.Client, token: str) -> None:
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    def probe(count: int) -> list[int]:
        if token:
            return [client.post("/api/chat", json={"conversation_id": "x", "message": "m", "mode": "ghost"}, headers=headers).status_code for _ in range(count)]
        return [client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"}).status_code for _ in range(count)]

    used = CHAT_CALLS_USED if token else RATE_LIMITS_USED.get("/api/auth/login", 0)
    allowed = (10 if token else 5) - used
    statuses = probe(allowed + 1)
    if statuses and statuses[0] == 429:
        # 上一轮运行或其他客户端占用了窗口，等待重置后重新探测。
        time.sleep(61)
        statuses = probe(allowed + 1)
    scope = "/api/chat 10/min" if token else "/api/auth/login 5/min"
    check(f"{scope} 触发 429（本脚本已用 {used} 次）", statuses[:allowed] == [400 if token else 401] * allowed and statuses[allowed] == 429, str(statuses))


if __name__ == "__main__":
    sys.exit(main())
