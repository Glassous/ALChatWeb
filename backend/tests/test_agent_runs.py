"""Basic Agent API checks using real LangChain graphs and disposable stores."""
from __future__ import annotations

import json
import threading
import time
from typing import Any
from uuid import uuid4

import pytest
from bson import ObjectId
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field
from sqlalchemy.exc import ProgrammingError
from pymysql.err import ProgrammingError as DriverProgrammingError

from app.agents import AGENT_MIGRATION_ERROR, AgentManager, agent_indexes
from app.ai import AIService
from app.storage import AgentUsage, Base, User, oid
from tests.conftest import auth, make_user, sse_events


class ScriptModel(BaseChatModel):
    script: list[Any] = Field(default_factory=list)
    inputs: list[Any] = Field(default_factory=list)
    bound_names: list[str] = Field(default_factory=list)

    @property
    def _llm_type(self):
        return "script-agent-test"

    def bind_tools(self, tools, **kwargs):
        self.bound_names = [tool.name for tool in tools]
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        self.inputs.append(messages)
        item = self.script.pop(0)
        answer = item(run_manager) if callable(item) else item
        if isinstance(answer, Exception):
            raise answer
        return ChatResult(generations=[ChatGeneration(message=answer)])


def answer(text="完成 ref(1)", calls=None):
    return AIMessage(content=text, tool_calls=calls or [], usage_metadata={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30})


def search_call(name="search_bocha", query="关键词", id="search-1"):
    return {"id": id, "name": name, "args": {"query": query}, "type": "tool_call"}


@pytest.fixture()
def agent(state, monkeypatch):
    state.cfg = state.cfg.model_copy(update={"BOCHA_API_KEY": "test-search-key", "TAVILY_API_KEY": "test-tavily-key"})
    model = ScriptModel(script=[answer("直接回答")])
    chosen = []

    def model_for(mode, runtime=None, timeout=240):
        chosen.append((mode, runtime, timeout))
        return model

    monkeypatch.setattr(state.ai, "model_for", model_for)
    monkeypatch.setattr(state.ai, "messages", AIService(state.cfg).messages)
    monkeypatch.setattr(state.ai, "search", lambda query, source, timeout=None: [{"title": source, "url": f"https://example.com/{query}", "snippet": "搜索摘要"}])
    state.agents = AgentManager(state)
    agent_indexes(state.db)
    user, jwt = make_user(state)
    conv = state.conversations.create(user["id"])
    yield state, model, chosen, user, jwt, conv
    for thread in list(state.agents.threads.values()):
        thread.join(timeout=3)


def start(client, agent, **kwargs):
    state, model, chosen, user, jwt, conv = agent
    body = {"conversation_id": conv["id"], "message": "查找资料", "request_id": str(uuid4()), **kwargs}
    response = client.post("/api/agent/runs", json=body, headers=auth(jwt))
    assert response.status_code == 201, response.text
    return response.json(), body


def wait(state, id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        run = state.agents.runs.find_one({"_id": oid(id)})
        if run["status"] not in ("running", "cancelling"):
            return state.agents.snapshot(run)
        time.sleep(.01)
    pytest.fail("Agent did not finish within five seconds")


def test_direct_answer_real_graph_and_atomic_billing(client, agent):
    state, model, chosen, user, jwt, conv = agent
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "completed" and done["content"] == "直接回答"
    assert done["credits"] == pytest.approx(999.91)
    assert all(mode == "daily" and runtime is None and timeout <= 60 for mode, runtime, timeout in chosen)
    assert model.bound_names == ["search_bocha", "search_tavily"]
    stored = state.conversations.get(user["id"], conv["id"])["messages"][-1]
    assert stored["agent_status"] == "completed" and stored["agent_run_id"] == run["id"]
    assert stored["agent_trace"][0]["type"] == "model"
    state.agents.charge(state.agents.runs.find_one({"_id": oid(run["id"])}), f"{run['id']}:model:1", 10, 20)
    with state.db.session() as session:
        assert session.query(AgentUsage).count() == 1
        assert float(session.get(User, user["id"]).credits) == pytest.approx(999.91)


def test_multiround_search_numbers_and_current_branch(client, agent):
    state, model, chosen, user, jwt, conv = agent
    first = state.conversations.save(user["id"], conv["id"], "user", "当前分支")
    unrelated = state.conversations.save(user["id"], conv["id"], "user", "其他分支")
    model.script = [answer("正在查找", [search_call(query="第一条")]), answer("再查找", [search_call("search_tavily", "第二条", "search-2")]), answer("整理答案 ref(1) ref(2)")]
    run, _ = start(client, agent, parent_message_id=first["id"])
    done = wait(state, run["id"])
    assert done["status"] == "completed", done
    assert len(done["steps"]) == 5
    assert [s["number"] for s in state.agents.runs.find_one({"_id": oid(run["id"])})["sources"]] == [1, 2]
    assert "整理答案 ref(1) ref(2)" in done["content"] and "<search>" in done["content"]
    assert "正在查找" not in done["content"]
    assert any(m.content == "当前分支" for m in model.inputs[0])
    assert not any(m.content == unrelated["content"] for m in model.inputs[0])
    assert any(isinstance(m, ToolMessage) for m in model.inputs[-1])
    assert done["credits"] == pytest.approx(999.73)


def test_search_failure_can_switch_provider_and_redacts_secrets(client, agent, monkeypatch):
    state, model, chosen, user, jwt, conv = agent
    def search(query, source, timeout=None):
        assert timeout <= 30
        if source == "bocha":
            raise RuntimeError("Authorization Bearer SECRET-KEY")
        return [{"title": "结果", "url": "https://example.com", "snippet": "摘要"}]
    monkeypatch.setattr(state.ai, "search", search)
    model.script = [answer("", [search_call()]), answer("", [search_call("search_tavily", id="search-2")]), answer()]
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "completed"
    assert [s["status"] for s in done["steps"] if s["type"] == "search"] == ["failed", "completed"]
    assert "SECRET-KEY" not in json.dumps(done)


def test_model_not_supporting_tools_reports_configuration_error(client, agent, monkeypatch):
    state, model, chosen, user, jwt, conv = agent
    monkeypatch.setattr(ScriptModel, "bind_tools", lambda *args, **kwargs: (_ for _ in ()).throw(NotImplementedError()))
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "failed" and "不支持工具调用" in done["error"]


def test_snapshot_sse_replay_expired_log_and_terminal_close(client, agent):
    state, model, chosen, user, jwt, conv = agent
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    snapshot = client.get(f"/api/agent/runs/{run['id']}", headers=auth(jwt)).json()
    assert snapshot["seq"] == done["seq"]
    response = client.get(f"/api/agent/runs/{run['id']}/events", headers=auth(jwt))
    events = sse_events(response.text)
    assert [event["seq"] for event in events] == list(range(1, done["seq"] + 1))
    assert events[-1]["type"] == "terminal" and events[-1]["data"]["seq"] == done["seq"]
    after = client.get(f"/api/agent/runs/{run['id']}/events?after_seq={events[1]['seq']}", headers=auth(jwt))
    assert all(event["seq"] > events[1]["seq"] for event in sse_events(after.text))
    assert client.get(f"/api/agent/runs/{run['id']}/events?after_seq={done['seq']}", headers=auth(jwt)).text == ""
    state.agents.events.delete_many({"run_id": run["id"]})
    expired = client.get(f"/api/agent/runs/{run['id']}/events", headers=auth(jwt))
    assert sse_events(expired.text)[0]["type"] == "snapshot"


def test_idempotency_parent_validation_and_authorization(client, agent):
    state, model, chosen, user, jwt, conv = agent
    run, body = start(client, agent)
    wait(state, run["id"])
    repeat = client.post("/api/agent/runs", json=body, headers=auth(jwt))
    assert repeat.status_code == 200 and repeat.json()["id"] == run["id"]
    assert len(state.conversations.get(user["id"], conv["id"])["messages"]) == 2
    assert client.post("/api/agent/runs", json={**body, "message": "改变任务"}, headers=auth(jwt)).status_code == 409
    other, other_jwt = make_user(state, email="other@example.com")
    for suffix in ("", "/events"):
        assert client.get(f"/api/agent/runs/{run['id']}{suffix}", headers=auth(other_jwt)).status_code == 404
    assert client.post(f"/api/agent/runs/{run['id']}/cancel", headers=auth(other_jwt)).status_code == 404
    assert client.post("/api/agent/runs", json=body, headers=auth(other_jwt)).status_code == 404
    assert client.get(f"/api/agent/runs/{run['id']}").status_code == 401
    another = state.conversations.create(user["id"])
    parent = state.conversations.save(user["id"], another["id"], "user", "别的会话")
    assert client.post("/api/agent/runs", json={**body, "request_id": "bad-parent", "parent_message_id": parent["id"]}, headers=auth(jwt)).status_code == 400
    assert client.get(f"/api/agent/runs/{run['id']}/events?after_seq=-1", headers=auth(jwt)).status_code == 400


def test_cancel_blocks_other_generation_and_keeps_completed_call(client, agent):
    state, model, chosen, user, jwt, conv = agent
    entered, release = threading.Event(), threading.Event()
    def blocked(run_manager):
        entered.set()
        assert release.wait(timeout=3)
        return answer("已完成的部分", [search_call()])
    model.script = [blocked]
    run, body = start(client, agent)
    assert entered.wait(timeout=2)
    try:
        assert client.post("/api/agent/runs", json={**body, "request_id": "another"}, headers=auth(jwt)).status_code == 409
        for path, payload in (("/api/chat", {"message": "普通聊天", "mode": "daily"}), ("/api/chat/image", {"prompt": "图片"})):
            assert client.post(path, json={"conversation_id": conv["id"], **payload}, headers=auth(jwt)).status_code == 409
        assert client.delete(f"/api/conversations/{conv['id']}", headers=auth(jwt)).status_code == 409
        cancelled = client.post(f"/api/agent/runs/{run['id']}/cancel", headers=auth(jwt)).json()
        assert cancelled["status"] == "cancelling"
        assert client.post(f"/api/agent/runs/{run['id']}/cancel", headers=auth(jwt)).json()["seq"] == cancelled["seq"]
    finally:
        release.set()
    done = wait(state, run["id"])
    assert done["status"] == "cancelled" and len(model.inputs) == 1
    assert not any(step["type"] == "search" for step in done["steps"])
    assert done["steps"][0]["summary"] == "已完成的部分"
    assert done["credits"] == pytest.approx(999.91)
    events = list(state.agents.events.find({"run_id": run["id"]}).sort("seq", 1))
    assert [e["seq"] for e in events] == list(range(1, done["seq"] + 1))


@pytest.mark.parametrize("limit", ["AGENT_MAX_MODEL_CALLS", "AGENT_MAX_SEARCH_CALLS"])
def test_call_limits_reserve_final_answer(client, agent, limit):
    state, model, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={limit: 1})
    model.script = [answer()] if limit == "AGENT_MAX_MODEL_CALLS" else [answer("", [search_call()]), answer()]
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "completed" and done["budget"]["phase"] == "summarizing"
    assert done["finish_reason"] == ("model_limit" if limit == "AGENT_MAX_MODEL_CALLS" else "search_limit")
    assert len(model.inputs) <= 2


def test_timeout_partial_failure_and_usage_fallback(client, agent):
    state, model, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={"AGENT_TIMEOUT_SECONDS": .1})
    def delayed(run_manager):
        time.sleep(.2)
        return answer("迟到的答案")
    model.script = [delayed]
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "failed" and "超时" in done["error"]
    assert done["content"] == "迟到的答案" and done["credits"] < 1000
    state.cfg = state.cfg.model_copy(update={"AGENT_TIMEOUT_SECONDS": 180})
    def broken(run_manager):
        run_manager.on_llm_new_token("部分输出")
        raise RuntimeError("secret provider error")
    model.script = [broken]
    run, _ = start(client, agent, request_id="partial-failure")
    done = wait(state, run["id"])
    assert done["status"] == "failed" and done["content"] == "部分输出"
    with state.db.session() as session:
        usage = session.get(AgentUsage, f"{run['id']}:model:1")
        assert usage.output_tokens > 0 and usage.input_tokens > 0
    assert "secret" not in json.dumps(done)


def test_restart_recovery_and_idempotent_migration_indexes(client, agent):
    state, model, chosen, user, jwt, conv = agent
    run, _ = start(client, agent)
    wait(state, run["id"])
    state.agents.runs.update_one({"_id": oid(run["id"])}, {"$set": {"status": "running"}})
    state.agents.recover()
    once = client.get(f"/api/agent/runs/{run['id']}", headers=auth(jwt)).json()
    assert once["status"] == "interrupted" and "重启" in once["error"]
    state.agents.recover()
    assert client.get(f"/api/agent/runs/{run['id']}", headers=auth(jwt)).json()["seq"] == once["seq"]
    Base.metadata.create_all(state.db.engine)
    agent_indexes(state.db)
    Base.metadata.create_all(state.db.engine)
    agent_indexes(state.db)
    assert state.db.mongo.agent_events.index_information()["expires_at_1"]["expireAfterSeconds"] == 0


@pytest.mark.parametrize("patch,body,status", [
    ({"BOCHA_API_KEY": "", "TAVILY_API_KEY": ""}, {}, 400),
    ({}, {"conversation_id": "temp_agent"}, 400),
    ({}, {"message": '<file src="https://example.com">问题'}, 400),
    ({}, {"message": " "}, 400),
    ({}, {"request_id": ""}, 400),
])
def test_start_validation(client, agent, patch, body, status):
    state, model, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update=patch)
    response = client.post("/api/agent/runs", json={"conversation_id": conv["id"], "message": "问题", "request_id": "validation", **body}, headers=auth(jwt))
    assert response.status_code == status
    assert state.agents.runs.count_documents({}) == 0


def test_insufficient_credits_prevents_next_call(client, agent):
    state, model, chosen, user, jwt, conv = agent
    with state.db.session() as session:
        session.get(User, user["id"]).credits = .01
    model.script = [answer("", [search_call()]), answer()]
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "failed" and "积分不足" in done["error"]
    assert len(model.inputs) == 1


def test_shared_copy_has_trace_without_live_run(client, agent):
    state, model, chosen, user, jwt, conv = agent
    run, _ = start(client, agent)
    wait(state, run["id"])
    share = client.post(f"/api/conversations/{conv['id']}/share", json={"leaf_message_id": run["assistant_message_id"]}, headers=auth(jwt)).json()
    assert client.get(f"/api/shared/{share['share_token']}").json()["messages"][-1]["agent_trace"]
    copied = client.post(f"/api/shared/{share['share_token']}/save", headers=auth(jwt)).json()
    message = state.conversations.get(user["id"], copied["conversation_id"])["messages"][-1]
    assert message["mode"] == "agent" and message["agent_trace"]
    assert "agent_run_id" not in message


def test_only_configured_tools_are_registered(client, agent):
    state, model, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={"BOCHA_API_KEY": ""})
    run, _ = start(client, agent)
    assert wait(state, run["id"])["status"] == "completed"
    assert model.bound_names == ["search_tavily"]


def test_admission_distinguishes_generation_from_empty_subscription(client, agent):
    from app.streams import StreamState
    state, model, chosen, user, jwt, conv = agent
    body = {"conversation_id": conv["id"], "message": "问题", "request_id": "busy"}
    state.streams.start(conv["id"])
    assert client.post("/api/agent/runs", json=body, headers=auth(jwt)).status_code == 409
    # A legacy subscription opened before any generation must not lock the chat.
    state.streams.states[conv["id"]] = StreamState()
    run, _ = start(client, agent)
    assert wait(state, run["id"])["status"] == "completed"


def test_actual_explicit_migration_can_be_repeated(agent, monkeypatch):
    import app.migrate as migration
    state, model, chosen, user, jwt, conv = agent
    monkeypatch.setattr(migration, "Storage", lambda cfg: state.db)
    monkeypatch.setattr(state.db, "close", lambda: None)
    first = migration.migrate()
    assert migration.migrate() == first
    with state.db.session() as session:
        assert session.query(AgentUsage).count() == 0
        assert session.get(User, user["id"]) is not None
    assert len(state.db.mongo.agent_runs.index_information()) == 3


def test_missing_billing_table_rejects_before_model_and_can_be_migrated(client, agent, monkeypatch):
    import app.migrate as migration
    state, model, chosen, user, jwt, conv = agent
    AgentUsage.__table__.drop(state.db.engine)
    body = {"conversation_id": conv["id"], "message": "问题", "request_id": "missing-schema"}
    response = client.post("/api/agent/runs", json=body, headers=auth(jwt))
    assert response.status_code == 503 and AGENT_MIGRATION_ERROR in response.text
    assert not model.inputs and not chosen
    assert state.agents.runs.count_documents({}) == 0
    assert state.conversations.get(user["id"], conv["id"])["messages"] == []
    monkeypatch.setattr(migration, "Storage", lambda cfg: state.db)
    monkeypatch.setattr(state.db, "close", lambda: None)
    # Agent-only migration must not import unrelated legacy accounts.
    legacy_id = ObjectId()
    state.db.mongo.users.insert_one({"_id": legacy_id, "email": "legacy@example.com"})
    assert migration.migrate(agent_only=True) == {"agent_schema": 1}
    assert migration.migrate(agent_only=True) == {"agent_schema": 1}
    with state.db.session() as session:
        assert session.get(User, str(legacy_id)) is None
        assert float(session.get(User, user["id"]).credits) == 1000
    accepted = client.post("/api/agent/runs", json=body, headers=auth(jwt))
    assert accepted.status_code == 201
    assert wait(state, accepted.json()["id"])["status"] == "completed"


@pytest.mark.parametrize("code,expected", [(1146, AGENT_MIGRATION_ERROR), (1054, AGENT_MIGRATION_ERROR), (2006, "Agent 数据库操作失败")])
def test_billing_error_keeps_output_and_closes_step_without_logging_parameters(client, agent, monkeypatch, caplog, code, expected):
    state, model, chosen, user, jwt, conv = agent
    def broken_charge(*args, **kwargs):
        raise ProgrammingError("sensitive sql SECRET-STATEMENT", {"key": "SECRET-PARAMETER"}, DriverProgrammingError(code, "SECRET-DRIVER-DETAIL"))
    monkeypatch.setattr(state.agents, "charge", broken_charge)
    run, _ = start(client, agent)
    done = wait(state, run["id"])
    assert done["status"] == "failed" and expected in done["error"]
    assert done["content"] == "直接回答" and done["credits"] == 1000
    step = done["steps"][0]
    assert step["status"] == "failed" and step["ended_at"] and step["duration_ms"] >= 0
    assert f"code={code}" in caplog.text and "broken_charge" in caplog.text
    assert "SECRET-STATEMENT" not in caplog.text and "SECRET-PARAMETER" not in caplog.text and "SECRET-DRIVER-DETAIL" not in caplog.text
    assert "SECRET" not in json.dumps(done)
