"""Chat, search, image, temp-conversation and Hermes streaming verification."""
from __future__ import annotations

import threading
from datetime import datetime
from types import SimpleNamespace

import pytest
from bson import ObjectId
from langchain_core.messages import AIMessageChunk

import app.routes.chat_routes as chat_routes
from app.ai import AIService, CompatibleChatModel, ReasoningChatOpenAI, Runtime
from app.core import count_tokens, encrypt, now
from app.storage import CustomModelConfig, HermesConfig, User
from app.streams import StreamManager
from tests.conftest import CFG, auth, make_user, stream_of


def create_conversation(client, jwt, title="New Conversation"):
    response = client.post("/api/conversations", json={"title": title}, headers=auth(jwt))
    assert response.status_code == 201
    return response.json()


def send(client, jwt, conversation_id, message, mode="daily", parent_message_id=""):
    body = {"conversation_id": conversation_id, "message": message, "mode": mode}
    if parent_message_id:
        body["parent_message_id"] = parent_message_id
    response = client.post("/api/chat", json=body, headers=auth(jwt))
    assert response.status_code == 200, response.text
    return response.json()


def test_daily_chat_stream_replays_events_in_order(client, state):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], "你好")
    events = stream_of(client, jwt, conversation["id"])
    assert [event["type"] for event in events] == ["generation_mode", "reasoning", "token", "token", "title", "done"]
    assert events[0]["content"] == "stream"
    assert events[1]["content"] == "想"
    assert "".join(event["content"] for event in events if event["type"] == "token") == "答案"
    assert events[4]["content"] == "生成的标题"
    # MySQL/SQLite DECIMAL(10,2) rounds the stored balance to two decimals.
    expected = round(1000 - (count_tokens("你好") * 0.001 + count_tokens("答案") * 0.004), 2)
    assert events[-1]["data"]["credits"] == pytest.approx(expected)
    stored = state.db.mongo["messages"].find_one({"_id": ObjectId(events[-1]["data"]["assistant_message_id"])})
    assert stored["content"] == "答案"
    assert stored["reasoning"] == "想"
    assert stored["mode"] == "daily"
    assert "search" not in stored


def test_late_subscriber_replays_buffered_events_then_follows_live_stream():
    streams = StreamManager()
    streams.start("conv")
    streams.publish("conv", "token", "早")
    collected: list[list[str]] = []

    def subscribe():
        collected.append(list(streams.subscribe("conv")))

    thread = threading.Thread(target=subscribe)
    thread.start()
    streams.publish("conv", "token", "晚")
    streams.close("conv")
    thread.join(timeout=5)
    assert collected == [['data: {"type":"token","content":"早"}\n\n', 'data: {"type":"token","content":"晚"}\n\n']]


def test_search_mode_publishes_search_events_and_search_tag(client, state):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], "今天有什么新闻", mode="search")
    events = stream_of(client, jwt, conversation["id"])
    search_events = [event["data"] for event in events if event["type"] == "search"]
    assert search_events[0] == {"query": "关键词", "status": "searching", "source": "bocha"}
    assert search_events[1]["status"] == "completed"
    assert search_events[1]["results"] == state.ai.results
    tag = next(event["content"] for event in events if event["type"] == "token")
    assert tag.startswith("\n<search>\n") and tag.endswith("\n</search>\n")
    assert '"query": "关键词"' in tag and "https://example.com/a" in tag
    assert events[-1]["data"]["assistant_message_id"]


def test_search_without_results_omits_results_key(client, state):
    state.ai.results = []
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], "今天有什么新闻", mode="search")
    events = stream_of(client, jwt, conversation["id"])
    completed = [event["data"] for event in events if event["type"] == "search"][1]
    assert "results" not in completed
    assert '"results": []' in next(event["content"] for event in events if event["type"] == "token")


def test_multimodal_message_skips_search_when_provider_configured(client, state):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], '<image src="https://cdn.example.com/a.png">\n看图', mode="search")
    events = stream_of(client, jwt, conversation["id"])
    assert not [event for event in events if event["type"] == "search"]


def test_search_runs_for_image_message_without_multimodal_provider(client, state):
    state.ai.multimodal_api_key = ""
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], '<image src="https://cdn.example.com/a.png">\n看图', mode="search")
    events = stream_of(client, jwt, conversation["id"])
    assert [event["type"] for event in events if event["type"] == "search"] == ["search", "search"]


def test_custom_model_failure_falls_back_and_charges_credits(client, state):
    user, jwt = make_user(state)
    with state.db.session() as session:
        session.add(CustomModelConfig(user_id=user["id"], enabled=True, base_url="https://custom.example.com/v1", api_key_ciphertext=encrypt(CFG, "custom-key"), model="custom-model", daily_enabled=True, response_mode="stream", created_at=now(), updated_at=now()))
    state.ai.fail_next_runtime_call = True
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], "你好")
    events = stream_of(client, jwt, conversation["id"])
    types = [event["type"] for event in events]
    assert types == ["generation_mode", "fallback", "generation_mode", "reasoning", "token", "token", "title", "done"]
    assert events[0]["content"] == "stream" and events[2]["content"] == "stream"
    assert events[1]["content"] == "自定义模型不可用，已回退到项目模型并将正常扣费"
    assert state.ai.captured[0]["runtime"] is not None and state.ai.captured[1]["runtime"] is None
    expected = round(1000 - (count_tokens("你好") * 0.001 + count_tokens("答案") * 0.004), 2)
    assert events[-1]["data"]["credits"] == pytest.approx(expected)


def test_custom_model_failure_without_credits_reports_legacy_error(client, state):
    user, jwt = make_user(state, credits=0)
    with state.db.session() as session:
        session.add(CustomModelConfig(user_id=user["id"], enabled=True, base_url="https://custom.example.com/v1", api_key_ciphertext=encrypt(CFG, "custom-key"), model="custom-model", daily_enabled=True, response_mode="non_stream", created_at=now(), updated_at=now()))
    state.ai.fail_next_runtime_call = True
    conversation = create_conversation(client, jwt)
    send(client, jwt, conversation["id"], "你好")
    events = stream_of(client, jwt, conversation["id"])
    error = next(event for event in events if event["type"] == "error")
    assert error["content"].startswith("自定义模型调用失败且项目额度不足: custom model unavailable")
    assert not [event for event in events if event["type"] in ("fallback", "done")]


def test_insufficient_credits_returns_403_with_credits_field(client, state):
    user, jwt = make_user(state, credits=0)
    conversation = create_conversation(client, jwt)
    response = client.post("/api/chat", json={"conversation_id": conversation["id"], "message": "你好", "mode": "daily"}, headers=auth(jwt))
    assert response.status_code == 403
    assert response.json() == {"error": "Insufficient credits", "credits": 0}


def test_chat_validates_mode_and_payload(client, state):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    assert client.post("/api/chat", json={"conversation_id": conversation["id"], "mode": "daily"}, headers=auth(jwt)).json() == {"error": "conversation_id and message are required"}
    assert client.post("/api/chat", json={"conversation_id": conversation["id"], "message": "hi", "mode": "ghost"}, headers=auth(jwt)).json() == {"error": "unsupported chat mode"}
    assert client.post("/api/chat", json={"conversation_id": "temp_chat_1", "message": "hi", "mode": "hermes"}, headers=auth(jwt)).json() == {"error": "Hermes 模式不支持临时会话"}


def test_image_generation_publishes_events_and_deducts_flat_credits(client, state, fake_cos):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    response = client.post("/api/chat/image", json={"conversation_id": conversation["id"], "prompt": "画一只猫", "resolution": "1024x1024"}, headers=auth(jwt))
    assert response.status_code == 200
    events = stream_of(client, jwt, conversation["id"])
    assert [event["type"] for event in events] == ["image_gen_start", "token", "title", "done"]
    assert events[0]["content"] == "1024x1024"
    assert events[1]["content"] == '<image src="https://cdn.example.com/images/uploadedimage.png">'
    assert events[-1]["data"]["credits"] == pytest.approx(950)


def test_image_generation_failure_does_not_deduct_credits(client, state, fake_cos, monkeypatch):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)

    def fail(prompt, size, reference):
        raise RuntimeError("Images API unavailable")

    monkeypatch.setattr(state.ai, "image", fail)
    response = client.post("/api/chat/image", json={"conversation_id": conversation["id"], "prompt": "画一只猫"}, headers=auth(jwt))
    assert response.status_code == 200
    events = stream_of(client, jwt, conversation["id"])
    assert [event["type"] for event in events] == ["image_gen_start", "error"]
    assert "Images API unavailable" in events[-1]["content"]
    with state.db.session() as session:
        assert float(session.get(User, user["id"]).credits) == pytest.approx(1000)


def test_temp_conversation_flow_uses_redis_and_promotes(client, state):
    user, jwt = make_user(state)
    conversation_id = "temp_chat_a1b2c3"
    send(client, jwt, conversation_id, "临时问题")
    events = stream_of(client, jwt, conversation_id)
    assert events[-1]["type"] == "done"
    temp = client.get(f"/api/conversations/temp/{conversation_id}", headers=auth(jwt)).json()
    assert temp["id"] == conversation_id
    assert [message["role"] for message in temp["messages"]] == ["user", "assistant"]
    assert all(len(message["id"]) == 24 for message in temp["messages"])
    promoted = client.post(f"/api/conversations/temp/{conversation_id}/promote", headers=auth(jwt))
    assert promoted.status_code == 200
    body = promoted.json()
    assert body["title"] == "生成的标题"
    stored = client.get(f"/api/conversations/{body['id']}", headers=auth(jwt)).json()
    assert [message["content"] for message in stored["messages"]] == ["临时问题", "答案"]
    assert client.get(f"/api/conversations/temp/{conversation_id}", headers=auth(jwt)).status_code == 404


def test_temp_conversation_requires_temp_id_and_messages(client, state):
    user, jwt = make_user(state)
    assert client.get("/api/conversations/temp/not-temp", headers=auth(jwt)).json() == {"error": "Not a temp conversation ID"}
    state.temp.create("temp_chat_empty")
    response = client.post("/api/conversations/temp/temp_chat_empty/promote", headers=auth(jwt))
    assert response.status_code == 500
    assert response.json() == {"error": "no messages found in temporary conversation"}


class FakeHermesModel:
    """Scripted stand-in for HermesResponsesModel so SSE handling can be verified."""

    scripts: list = []
    calls: list[dict] = []

    def __init__(self, model: str = "", base_url: str = "", api_key: str = "", previous_response_id: str = ""):
        self.previous_response_id = previous_response_id
        FakeHermesModel.calls.append({"previous_response_id": previous_response_id, "messages": None})

    def stream(self, messages):
        FakeHermesModel.calls[-1]["messages"] = messages
        script = FakeHermesModel.scripts.pop(0)
        if isinstance(script, Exception):
            raise script
        completed = False
        for raw in script:
            completed = completed or raw.get("type") == "response.completed"
            text = raw.get("delta", "") if raw.get("type") == "response.output_text.delta" else ""
            yield AIMessageChunk(content=text, additional_kwargs={"hermes_event": raw})
        if not completed:
            raise RuntimeError("Hermes stream ended before response.completed")


@pytest.fixture()
def hermes(monkeypatch):
    FakeHermesModel.scripts = []
    FakeHermesModel.calls = []
    monkeypatch.setattr(chat_routes, "HermesResponsesModel", FakeHermesModel)
    return FakeHermesModel


def hermes_user(state, client, email="hermes@example.com", title="New Conversation"):
    user, jwt = make_user(state, email=email)
    with state.db.session() as session:
        session.add(HermesConfig(user_id=user["id"], base_url="https://hermes.example.com", api_key_ciphertext=encrypt(CFG, "hermes-key"), model="hermes-model", tested=True, context_version=1, created_at=now(), updated_at=now()))
    # title=None keeps the conversation untitled (the API always fills in a default).
    conversation = state.conversations.create(user["id"], "") if title is None else create_conversation(client, jwt, title)
    return user, jwt, conversation


HERMES_TURN = [
    {"type": "response.output_item.added", "item_id": "item-1", "item": {"type": "web_search", "name": "web_search"}, "authorization": "Bearer sk-secret"},
    {"type": "response.reasoning_summary_text.delta", "item_id": "item-2", "delta": "部分"},
    {"type": "response.reasoning_summary_text.delta", "item_id": "item-2", "delta": "累加"},
    {"type": "response.output_text.delta", "delta": "你好", "response_id": "resp_1"},
    {"type": "response.completed", "response": {"id": "resp_1"}},
]


def test_hermes_stream_keeps_steps_context_and_completion(client, state, hermes):
    user, jwt, conversation = hermes_user(state, client)
    hermes.scripts = [list(HERMES_TURN)]
    send(client, jwt, conversation["id"], "继续", mode="hermes")
    events = stream_of(client, jwt, conversation["id"])
    assert events[0] == {"type": "hermes_context", "content": "new"}
    assert [event["content"] for event in events if event["type"] == "token"] == ["你好"]
    steps = [event["data"] for event in events if event["type"] == "hermes_event"]
    assert [step["type"] for step in steps] == ["response.output_item.added", "response.reasoning_summary_text.delta", "response.reasoning_summary_text.delta", "response.completed"]
    assert steps[0]["title"] == "web_search" and steps[0]["status"] == "running"
    assert "sk-secret" not in steps[0]["details"] and "[REDACTED]" in steps[0]["details"]
    assert steps[0]["raw"]["authorization"] == "[REDACTED]"
    assert steps[1]["summary"] == "部分" and steps[2]["summary"] == "部分累加"
    assert steps[-1]["status"] == "completed"
    done = events[-1]["data"]
    assert done["hermes_response_id"] == "resp_1"
    assert done["hermes_context_version"] == 1
    assert done["hermes_response_completed"] is True
    assert not [event for event in events if event["type"] == "title"]
    stored = state.db.mongo["messages"].find_one({"_id": ObjectId(done["assistant_message_id"])})
    assert stored["mode"] == "hermes" and stored["hermes_response_completed"] is True
    assert isinstance(stored["hermes_trace"][0]["started_at"], datetime)
    # The second delta merges into its step, so the trace keeps three entries.
    assert len(stored["hermes_trace"]) == 3


def test_hermes_continues_context_and_uses_single_user_input(client, state, hermes):
    user, jwt, conversation = hermes_user(state, client)
    hermes.scripts = [list(HERMES_TURN), list(HERMES_TURN)]
    first = send(client, jwt, conversation["id"], "第一问", mode="hermes")
    stream_of(client, jwt, conversation["id"])
    send(client, jwt, conversation["id"], "第二问", mode="hermes", parent_message_id=first["assistant_message_id"])
    events = stream_of(client, jwt, conversation["id"])
    assert events[0] == {"type": "hermes_context", "content": "continued"}
    assert hermes.calls[1]["previous_response_id"] == "resp_1"
    history = hermes.calls[1]["messages"].history
    assert [message["content"] for message in history] == ["第二问"]


def test_hermes_rebuilds_history_when_previous_response_expired(client, state, hermes):
    user, jwt, conversation = hermes_user(state, client)
    hermes.scripts = [list(HERMES_TURN), list(HERMES_TURN), list(HERMES_TURN)]
    first = send(client, jwt, conversation["id"], "第一问", mode="hermes")
    stream_of(client, jwt, conversation["id"])
    expired = RuntimeError("Hermes HTTP 404: previous response not found")
    expired.status_code = 404
    expired.response = SimpleNamespace(text="previous response not found")
    hermes.scripts = [expired, list(HERMES_TURN)]
    send(client, jwt, conversation["id"], "第二问", mode="hermes", parent_message_id=first["assistant_message_id"])
    events = stream_of(client, jwt, conversation["id"])
    assert [event["content"] for event in events if event["type"] == "hermes_context"] == ["continued", "rebuilt"]
    assert hermes.calls[2]["previous_response_id"] == ""
    assert [message["content"] for message in hermes.calls[2]["messages"].history] == ["第一问", "你好", "第二问"]
    assert events[-1]["type"] == "done"


def test_hermes_sets_first_message_title_when_conversation_is_untitled(client, state, hermes):
    user, jwt, conversation = hermes_user(state, client, title=None)
    message = "请帮我总结这篇很长的文章的要点并给出建议，同时说明下一步的行动计划"
    hermes.scripts = [list(HERMES_TURN)]
    send(client, jwt, conversation["id"], message, mode="hermes")
    events = stream_of(client, jwt, conversation["id"])
    title = next(event["content"] for event in events if event["type"] == "title")
    assert title == message[:32] + "…"
    stored = client.get(f"/api/conversations/{conversation['id']}", headers=auth(jwt)).json()
    assert stored["title"] == title


def test_hermes_failure_is_reported_and_partial_content_persisted(client, state, hermes):
    user, jwt, conversation = hermes_user(state, client)
    hermes.scripts = [[{"type": "response.output_text.delta", "delta": "半", "response_id": "resp_x"}]]
    send(client, jwt, conversation["id"], "继续", mode="hermes")
    events = stream_of(client, jwt, conversation["id"])
    assert [event["type"] for event in events][-1] == "error"
    assert events[-1]["content"] == "Hermes stream ended before response.completed"
    messages = list(state.db.mongo["messages"].find({"conversation_id": ObjectId(conversation["id"])}))
    assistant = [message for message in messages if message["role"] == "assistant"][0]
    assert assistant["content"] == "半"
    assert assistant["hermes_response_completed"] is False


def test_provider_model_selection_keeps_thinking_and_reasoning(monkeypatch):
    service = AIService(CFG)
    daily = service.model_for("daily")
    assert isinstance(daily, ReasoningChatOpenAI)
    assert daily.extra_body == {"thinking": {"type": "disabled"}}
    assert service.model_for("expert").extra_body is None
    custom = service.model_for("search", Runtime("k", "https://example.com/v1", "m", "non_stream"))
    assert isinstance(custom, CompatibleChatModel) and custom.thinking is False
    assert service.model_for("expert", Runtime("k", "https://example.com/v1", "m")).thinking is True

    chunk = {"id": "1", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "答", "reasoning_content": "想"}}]}
    generation = daily._convert_chunk_to_generation_chunk(chunk, AIMessageChunk, {})
    assert generation.message.content == "答"
    assert generation.message.additional_kwargs["reasoning_content"] == "想"
    result = daily._create_chat_result({"id": "1", "model": "m", "object": "chat.completion", "created": 0, "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "答", "reasoning_content": "想"}}]})
    assert result.generations[0].message.additional_kwargs["reasoning_content"] == "想"


def test_multimodal_messages_use_blocks_for_every_role():
    service = AIService(CFG)
    history = [
        {"role": "assistant", "content": '看图 <image src="https://cdn.example.com/a.png"> 说明'},
        {"role": "user", "content": "<file src=\"https://cdn.example.com/b.pdf\">分析"},
    ]
    messages = service.messages(history, multimodal=True)
    assistant = messages[0].content
    assert [block["type"] for block in assistant] == ["text", "image_url", "text"]
    assert assistant[1]["image_url"]["url"] == "https://cdn.example.com/a.png"
    assert messages[1].content[0] == {"type": "image_url", "image_url": {"url": "https://cdn.example.com/b.pdf"}}
    assert service.has_multimodal([{"role": "user", "content": "纯文本"}], "系统 <image src=\"x\">") is True
    assert service.has_multimodal([{"role": "user", "content": "纯文本"}], "") is False


def test_image_reference_is_copied_from_parent_branch(client, state, fake_cos, monkeypatch):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    references = []
    monkeypatch.setattr(state.ai, "image", lambda prompt, size, reference: references.append(reference) or state.ai.image_bytes)
    response = client.post("/api/chat/image", json={"conversation_id": conversation["id"], "prompt": "第二张"}, headers=auth(jwt))
    assert response.status_code == 200
    stream_of(client, jwt, conversation["id"])
    history = client.get(f"/api/conversations/{conversation['id']}", headers=auth(jwt)).json()["messages"]
    assert history[0]["content"] == "第二张"
    assert history[1]["content"].startswith('<image src="https://cdn.example.com/images/')
    assert references == [""]

    response = client.post("/api/chat/image", json={"conversation_id": conversation["id"], "parent_message_id": history[1]["id"], "prompt": "改成蓝色"}, headers=auth(jwt))
    assert response.status_code == 200
    stream_of(client, jwt, conversation["id"])
    assert references[1] == "https://cdn.example.com/images/uploadedimage.png"


def test_explicit_reference_and_output_extension(client, state, fake_cos, monkeypatch):
    user, jwt = make_user(state)
    conversation = create_conversation(client, jwt)
    references = []
    monkeypatch.setattr(state.ai, "image", lambda prompt, size, reference: references.append(reference) or b"\xff\xd8\xffimage")
    ref = "https://cdn.example.com/reference_files/a.jpg"
    response = client.post("/api/chat/image", json={"conversation_id": conversation["id"], "prompt": "换背景", "ref_image_url": ref}, headers=auth(jwt))
    assert response.status_code == 200
    events = stream_of(client, jwt, conversation["id"])
    assert references == [ref]
    assert events[1]["content"] == '<image src="https://cdn.example.com/images/uploadedimage.jpg">'
