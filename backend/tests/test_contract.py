import json
from pathlib import Path
from types import SimpleNamespace

from bson import ObjectId
from fastapi.testclient import TestClient

from app.config import Settings
from app.ai import CompatibleChatModel, HermesResponsesModel
from app.core import check_password, decrypt, encrypt, hash_password, token
from app.main import app
from app.streams import StreamManager


def test_all_legacy_routes_are_registered():
    expected = {tuple(item) for item in json.loads((Path(__file__).parent / "legacy_routes.json").read_text(encoding="utf-8"))}
    def expanded(routes):
        for route in routes:
            if hasattr(route, "original_router"):
                yield from expanded(route.original_router.routes)
            else:
                yield route

    actual = {(method, route.path) for route in expanded(app.routes) for method in (getattr(route, "methods", None) or set()) if method in {"GET", "POST", "PUT", "DELETE"}}
    assert len(expected) == 80
    agent_routes = {("POST", "/api/agent/runs"), ("GET", "/api/agent/runs/{id}"), ("GET", "/api/agent/runs/{id}/events"), ("POST", "/api/agent/runs/{id}/cancel")}
    assert actual == expected | agent_routes


def test_legacy_password_jwt_and_encrypted_key_formats():
    cfg = Settings(MYSQL_DSN="root:x@tcp(localhost:3306)/alchat", JWT_SECRET="legacy-secret-with-at-least-32-characters", CUSTOM_MODEL_ENCRYPTION_KEY="legacy-encryption-secret")
    hashed = hash_password("old-user-password")
    assert hashed.startswith("$2b$") and check_password("old-user-password", hashed)
    import jwt
    claims = jwt.decode(token(cfg, str(ObjectId()), "admin"), cfg.JWT_SECRET, algorithms=["HS256"])
    assert claims["role"] == "admin" and claims["jti"]
    assert decrypt(cfg, encrypt(cfg, "persisted-provider-key")) == "persisted-provider-key"


def test_sse_replays_and_ends_with_original_event_shape():
    streams = StreamManager()
    streams.start("conversation")
    streams.publish("conversation", "token", "你好")
    streams.publish("conversation", "done", data={"credits": 42})
    streams.close("conversation")
    assert list(streams.subscribe("conversation")) == [
        'data: {"type":"token","content":"你好"}\n\n',
        'data: {"type":"done","data":{"credits":42}}\n\n',
    ]


def test_validation_is_400_and_trailing_slash_does_not_redirect():
    client = TestClient(app)
    response = client.post("/api/auth/login", content="{", headers={"content-type": "application/json"})
    assert response.status_code == 400
    assert client.get("/health/").status_code != 307


def test_provider_reasoning_and_hermes_raw_events_survive_langchain(monkeypatch):
    def chat_create(**kwargs):
        assert kwargs["stream"] is True
        yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content="答", model_extra={"reasoning_content": "想"}))])

    chat_client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=chat_create)))
    monkeypatch.setattr(CompatibleChatModel, "_client", lambda self: chat_client)
    model = CompatibleChatModel(model="test", base_url="https://example.com/v1", api_key="secret")
    chunks = list(model.stream("你好"))
    assert "".join(c.content for c in chunks) == "答"
    assert chunks[0].additional_kwargs["reasoning_content"] == "想"

    raw = [
        SimpleNamespace(model_dump=lambda **_: {"type": "response.output_text.delta", "delta": "你好", "response_id": "resp_1"}),
        SimpleNamespace(model_dump=lambda **_: {"type": "response.completed", "response": {"id": "resp_1"}}),
    ]
    hermes_client = SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: iter(raw)))
    monkeypatch.setattr(HermesResponsesModel, "_client", lambda self: hermes_client)
    hermes = HermesResponsesModel(model="hermes", base_url="https://example.com", api_key="secret", previous_response_id="resp_old")
    events = list(hermes.stream("继续"))
    assert events[0].content == "你好"
    assert events[1].additional_kwargs["hermes_event"]["type"] == "response.completed"
