"""Agent HTTP smoke checks.

python smoke_agent_api.py --isolated
python smoke_agent_api.py --base-url http://localhost:8080

Isolated mode uses an ephemeral loopback Uvicorn server, test stores and a
scripted model with the real LangChain graph. External mode reads the JWT from
ALCHAT_SMOKE_TOKEN and uses a disposable conversation; real calls cost credits.
"""
from __future__ import annotations

import argparse
import os
import socket
import threading
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx


def isolated_server():
    import uvicorn
    import app.main as main
    from app.agents import AgentManager, agent_indexes
    from app.ai import AIService
    from app.conversations import Conversations, TemporaryConversations
    from app.streams import StreamManager
    from tests.conftest import CFG, FakeAI, TestStorage, make_user
    from tests.test_agent_runs import ScriptModel, answer, search_call

    cfg = CFG.model_copy(update={"BOCHA_API_KEY": "isolated-search"})
    state = SimpleNamespace(cfg=cfg, db=TestStorage(cfg), streams=StreamManager(), ai=FakeAI(cfg))
    state.conversations = Conversations(state.db)
    state.temp = TemporaryConversations(state.db)
    state.agents = AgentManager(state)
    agent_indexes(state.db)
    def slow_model(run_manager):
        time.sleep(.15)
        run_manager.on_llm_new_token("准备搜索")
        return answer("准备搜索", [search_call()])
    model = ScriptModel(script=[slow_model, answer("脚本化模型完成搜索整理 ref(1)")])
    state.ai.model_for = lambda mode, runtime=None, timeout=240: model
    state.ai.messages = AIService(cfg).messages
    state.ai.search = lambda query, source, timeout=None: [{"title": "隔离搜索结果", "url": "https://example.com/agent", "snippet": "用于验证真实 Agent 循环的确定性搜索结果"}]
    main.state = state
    _, jwt = make_user(state, email="agent-smoke@example.com")
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(main.app, lifespan="off", log_level="warning"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(.01)
    if not server.started:
        raise RuntimeError("隔离 HTTP 服务未启动")
    return f"http://127.0.0.1:{port}", jwt, server, thread, state


def checks(client: httpx.Client, jwt: str):
    import json
    headers = {"Authorization": f"Bearer {jwt}"}
    passed = 0
    def check(label, condition):
        nonlocal passed
        if not condition:
            raise AssertionError(label)
        passed += 1
        print(f"PASS {label}")

    conv = client.post("/api/conversations", json={"title": "Agent HTTP 冒烟测试"}, headers=headers)
    check("创建测试会话", conv.status_code == 201)
    cid = conv.json()["id"]
    run_id = None
    try:
        body = {"conversation_id": cid, "message": "请搜索 LangChain Agent 官方文档，并简要总结，给出来源引用。", "request_id": str(uuid4())}
        missing = client.post("/api/agent/runs", json=body)
        check("提交接口要求鉴权", missing.status_code == 401)
        created = client.post("/api/agent/runs", json=body, headers=headers)
        check("启动 Agent", created.status_code == 201)
        run = created.json()
        run_id = run["id"]
        duplicate = client.post("/api/agent/runs", json=body, headers=headers)
        check("重复提交不创建新任务", duplicate.status_code == 200 and duplicate.json()["id"] == run_id)
        check("快照接口要求鉴权", client.get(f"/api/agent/runs/{run_id}").status_code == 401)
        check("事件接口要求鉴权", client.get(f"/api/agent/runs/{run_id}/events").status_code == 401)
        check("取消接口要求鉴权", client.post(f"/api/agent/runs/{run_id}/cancel").status_code == 401)
        with client.stream("GET", f"/api/agent/runs/{run_id}/events", headers=headers) as response:
            check("SSE 连接成功", response.status_code == 200 and response.headers["content-type"].startswith("text/event-stream"))
            events = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: ")]
        check("事件序号连续且任务归属正确", bool(events) and [item["seq"] for item in events] == list(range(1, len(events) + 1)) and all(item["run_id"] == run_id for item in events))
        check("SSE 以终态事件结束", events[-1]["type"] == "terminal")
        final = client.get(f"/api/agent/runs/{run_id}", headers=headers).json()
        check("任务完成并保存答案", final["status"] == "completed" and bool(final["content"]))
        check("模型执行步骤已保存", any(step["type"] == "model" for step in final["steps"]))
        replay = client.get(f"/api/agent/runs/{run_id}/events?after_seq={events[-2]['seq']}", headers=headers)
        check("游标重连仅重放后续事件", [json.loads(line[6:])["seq"] for line in replay.text.splitlines() if line.startswith("data: ")] == [events[-1]["seq"]])
        cancelled = client.post(f"/api/agent/runs/{run_id}/cancel", headers=headers).json()
        check("完成任务的取消请求幂等", cancelled["status"] == "completed" and cancelled["seq"] == final["seq"])
        messages = client.get(f"/api/conversations/{cid}", headers=headers).json()["messages"]
        check("会话保存 Agent 步骤与结果", messages[-1]["agent_run_id"] == run_id and messages[-1]["content"] == final["content"])
        print(f"Agent HTTP smoke: {passed} passed")
    finally:
        if run_id:
            client.post(f"/api/agent/runs/{run_id}/cancel", headers=headers)
            deadline = time.monotonic() + 65
            while time.monotonic() < deadline:
                run = client.get(f"/api/agent/runs/{run_id}", headers=headers).json()
                if run.get("status") not in ("running", "cancelling"):
                    break
                time.sleep(.2)
        removed = client.delete(f"/api/conversations/{cid}", headers=headers)
        if removed.status_code != 200:
            print(f"测试会话清理失败 ({removed.status_code}): {cid}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--isolated", action="store_true")
    parser.add_argument("--base-url", default="http://localhost:8080")
    args = parser.parse_args()
    server = thread = state = None
    base, jwt = args.base_url, os.environ.get("ALCHAT_SMOKE_TOKEN", "")
    if args.isolated:
        base, jwt, server, thread, state = isolated_server()
    elif not jwt:
        parser.error("真实服务测试需要 ALCHAT_SMOKE_TOKEN（请使用独立测试账号）")
    try:
        with httpx.Client(base_url=base, timeout=httpx.Timeout(30, read=240), trust_env=False) as client:
            checks(client, jwt)
    finally:
        if server:
            server.should_exit = True
            thread.join(timeout=5)
            state.db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
