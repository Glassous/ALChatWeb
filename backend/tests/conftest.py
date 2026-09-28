"""Shared fixtures: an in-process backend bound to disposable fakes.

The suites below exercise the real FastAPI routes, SQLAlchemy models and PyMongo
queries, but swap MySQL/MongoDB/Redis and the AI providers for local fakes so the
legacy contract (paths, status codes, JSON fields, SSE events) can be verified
without any external service.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace

import fakeredis
import mongomock
import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as main
from app.ai import Runtime
from app.config import Settings
from app.conversations import Conversations, TemporaryConversations
from app.core import hash_password, token
from app.storage import Base, Storage, User, public
from app.streams import StreamManager

CFG = Settings(
    _env_file=None,
    PORT=8080,
    GIN_MODE="debug",
    ALLOW_ORIGINS="http://localhost:5173",
    JWT_SECRET="legacy-secret-with-at-least-32-characters",
    CUSTOM_MODEL_ENCRYPTION_KEY="legacy-encryption-secret",
)


class TestStorage(Storage):
    def __init__(self, cfg: Settings = CFG):
        self.cfg = cfg
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.mongo_client = mongomock.MongoClient()
        self.mongo = self.mongo_client[cfg.mongo_db]
        self.redis = fakeredis.FakeStrictRedis(decode_responses=True)


class FakeModel:
    """Stands in for a LangChain chat model in ALing/non-stream paths."""

    def __init__(self, owner: "FakeAI", mode: str, runtime: Runtime | None):
        self.owner = owner
        self.mode = mode
        self.runtime = runtime

    def stream(self, messages):
        for piece in self.owner.reply:
            yield SimpleNamespace(content=piece, additional_kwargs={"reasoning_content": ""})

    def invoke(self, messages):
        return SimpleNamespace(content="".join(self.owner.reply), additional_kwargs={"reasoning_content": self.owner.reasoning})


class FakeAI:
    """Deterministic replacement for the LangChain powered AI layer."""

    def __init__(self, cfg: Settings = CFG):
        self.cfg = cfg
        self.overrides: dict[str, Runtime] = {}
        self.reply = ["答", "案"]
        self.reasoning = "想"
        self.classification = "DIRECT"
        self.title_value = "生成的标题"
        self.keywords_value = "关键词"
        self.results = [{"title": "标题", "url": "https://example.com/a", "snippet": "摘要", "site_name": "example.com"}]
        self.image_bytes = b"\x89PNG\r\n\x1a\nfake-image"
        self.fail_next_runtime_call = False
        self.multimodal_api_key = "multimodal-key"
        self.captured: list[dict] = []

    def runtime(self, mode: str) -> Runtime:
        if mode in self.overrides:
            return self.overrides[mode]
        key = self.multimodal_api_key if mode == "multimodal" else f"{mode}-key"
        return Runtime(key, f"https://{mode}.example.com/v1", f"{mode}-model")

    def configure(self, mode: str, api_key: str, base_url: str, model: str) -> None:
        old = self.runtime(mode)
        self.overrides[mode] = Runtime(api_key or old.api_key, base_url or old.base_url, model or old.model)

    def model_for(self, mode: str, runtime: Runtime | None = None, timeout: float = 240):
        return FakeModel(self, mode, runtime)

    def has_multimodal(self, history: list[dict], system_prompt: str = "") -> bool:
        if system_prompt and ("<file" in system_prompt or "<image" in system_prompt):
            return True
        return any("<file" in m.get("content", "") or "<image" in m.get("content", "") for m in history)

    def messages(self, history: list[dict], system_prompt: str = "", multimodal: bool = False, leading: tuple[str, ...] = ()):
        return SimpleNamespace(history=history, system_prompt=system_prompt, multimodal=multimodal, leading=leading)

    def stream(self, history: list[dict], mode: str, system_prompt: str, runtime: Runtime | None, emit, leading: tuple[str, ...] = ()) -> None:
        self.captured.append({"mode": mode, "runtime": runtime, "leading": leading, "system_prompt": system_prompt})
        if runtime and self.fail_next_runtime_call:
            self.fail_next_runtime_call = False
            raise RuntimeError("custom model unavailable")
        if self.reasoning:
            emit("", self.reasoning)
        for piece in self.reply:
            emit(piece, "")

    def non_stream(self, history: list[dict], mode: str, system_prompt: str, runtime: Runtime | None, leading: tuple[str, ...] = (), timeout: float = 240) -> tuple[str, str]:
        if runtime and self.fail_next_runtime_call:
            self.fail_next_runtime_call = False
            raise RuntimeError("custom model unavailable")
        return "".join(self.reply), self.reasoning

    def complete(self, history: list[dict], mode: str) -> str:
        return self.classification

    def title(self, history: list[dict]) -> str:
        return self.title_value

    def keywords(self, history: list[dict], runtime: Runtime | None = None) -> str:
        return self.keywords_value

    def search(self, query: str, source: str) -> list[dict]:
        return list(self.results)

    def image(self, prompt: str, size: str, reference: str) -> bytes:
        return self.image_bytes


@pytest.fixture()
def state(monkeypatch):
    instance = SimpleNamespace(cfg=CFG, db=TestStorage(), streams=StreamManager())
    instance.ai = FakeAI()
    instance.conversations = Conversations(instance.db)
    instance.temp = TemporaryConversations(instance.db)
    monkeypatch.setattr(main, "state", instance)
    yield instance
    main.state = None


@pytest.fixture()
def client(state):
    return TestClient(main.app)


def make_user(instance, email: str = "user@example.com", role: str = "user", password: str = "secret123", credits: float = 1000) -> tuple[dict, str]:
    with instance.db.session() as session:
        user = User(
            id=str(ObjectId()),
            email=email,
            nickname="昵称",
            password=hash_password(password),
            role=role,
            member_type="free",
            credits=credits,
            last_credit_reset_at=datetime.now(timezone.utc).replace(tzinfo=None),
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        session.add(user)
        session.flush()
        view = public(user)
    return view, token(CFG, view["id"], role)


def auth(jwt: str) -> dict:
    return {"Authorization": f"Bearer {jwt}"}


def sse_events(text: str) -> list[dict]:
    return [json.loads(line[len("data: ") :]) for line in text.splitlines() if line.startswith("data: ")]


def stream_of(client: TestClient, jwt: str, conversation_id: str) -> list[dict]:
    response = client.get("/api/chat/stream", params={"conversation_id": conversation_id}, headers=auth(jwt))
    assert response.status_code == 200
    return sse_events(response.text)


@pytest.fixture()
def fake_cos(monkeypatch):
    class FakeCOS:
        deleted: list[str] = []

        def __init__(self, cfg):
            self.cfg = cfg

        def url(self, key: str) -> str:
            return f"https://cdn.example.com/{key}"

        def upload(self, content: bytes, filename: str, folder: str) -> str:
            return self.url(f"{folder}/uploaded{filename}")

        def delete(self, key: str) -> None:
            FakeCOS.deleted.append(key)

        def presign(self, folder: str, filename: str, mime: str) -> tuple[str, str]:
            return f"https://cos.example.com/{folder}/{filename}?signature=1", self.url(f"{folder}/{filename}")

    import app.routes.auth_routes as auth_routes
    import app.routes.chat_routes as chat_routes

    monkeypatch.setattr(chat_routes, "COS", FakeCOS)
    monkeypatch.setattr(auth_routes, "COS", FakeCOS)
    return FakeCOS
