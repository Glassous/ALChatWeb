from __future__ import annotations

import re
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Iterator
from urllib.parse import quote, urlparse

from bson import ObjectId
from pymongo import MongoClient
from redis import Redis
from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, Numeric, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import Settings


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    nickname: Mapped[str] = mapped_column(String(255), default="")
    password: Mapped[str] = mapped_column(String(255))
    avatar: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(50), default="user")
    system_prompt: Mapped[str] = mapped_column(Text, default="")
    include_date_time: Mapped[bool] = mapped_column(Boolean, default=False)
    include_location: Mapped[bool] = mapped_column(Boolean, default=False)
    member_type: Mapped[str] = mapped_column(String(50), default="free")
    member_expiry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    credits: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    last_credit_reset_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class ModelConfig(Base):
    __tablename__ = "model_configs"
    mode: Mapped[str] = mapped_column(String(50), primary_key=True)
    base_url: Mapped[str] = mapped_column(String(255), default="")
    api_key: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class CustomModelConfig(Base):
    __tablename__ = "custom_model_configs"
    user_id: Mapped[str] = mapped_column(String(24), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    base_url: Mapped[str] = mapped_column(String(512), default="")
    api_key_ciphertext: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    daily_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    expert_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    search_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    response_mode: Mapped[str] = mapped_column(String(20), default="")
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class HermesConfig(Base):
    __tablename__ = "hermes_configs"
    user_id: Mapped[str] = mapped_column(String(24), primary_key=True)
    base_url: Mapped[str] = mapped_column(String(512), default="")
    api_key_ciphertext: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(255), default="")
    tested: Mapped[bool] = mapped_column(Boolean, default=False)
    context_version: Mapped[int] = mapped_column(Integer, default=1)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class Announcement(Base):
    __tablename__ = "announcements"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(50), default="info")
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


class Feedback(Base):
    __tablename__ = "feedbacks"
    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(24), nullable=True)
    user_email: Mapped[str] = mapped_column(String(255), default="")
    type: Mapped[str] = mapped_column(String(50), default="other")
    content: Mapped[str] = mapped_column(Text, default="")
    meta: Mapped[dict[str, str] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")
    reply_content: Mapped[str] = mapped_column(Text, default="")
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, onupdate=datetime.now)


def mysql_url(dsn: str) -> str:
    if dsn.startswith("mysql+"):
        return dsn
    m = re.fullmatch(r"([^:]+):([^@]*)@tcp\(([^:)]+)(?::(\d+))?\)/([^?]+)(?:\?.*)?", dsn)
    if not m:
        raise ValueError("MYSQL_DSN must be a Go mysql DSN or mysql+pymysql URL")
    user, password, host, port, database = m.groups()
    return f"mysql+pymysql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port or '3306'}/{database}?charset=utf8mb4"


class Storage:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.engine = create_engine(mysql_url(cfg.MYSQL_DSN), pool_pre_ping=True, pool_size=10, max_overflow=90)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.mongo_client = MongoClient(cfg.MONGODB_URI, serverSelectionTimeoutMS=10000)
        self.mongo = self.mongo_client[cfg.mongo_db]
        host, _, port = cfg.REDIS_ADDR.partition(":")
        self.redis = Redis(host=host, port=int(port or 6379), password=cfg.REDIS_PASSWORD or None, db=cfg.REDIS_DB, decode_responses=True)

    def connect(self) -> None:
        self.mongo_client.admin.command("ping")
        self.redis.ping()
        with self.engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
        # Schema changes are an explicit migration step; startup only checks connectivity.

    @contextmanager
    def session(self) -> Iterator[Any]:
        with self.sessions() as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    def close(self) -> None:
        self.mongo_client.close()
        self.redis.close()
        self.engine.dispose()


MESSAGE_OPTIONAL_FIELDS = (
    "parent_id",
    "reasoning",
    "search",
    "mode",
    "hermes_trace",
    "hermes_response_id",
    "hermes_context_version",
    "hermes_response_completed",
)


def _trim_message(value: dict) -> dict:
    # The Go service serialized messages with omitempty on optional fields.
    if "role" not in value or "content" not in value or "title" in value:
        return value
    for field in MESSAGE_OPTIONAL_FIELDS:
        if field in value and not value[field]:
            value.pop(field)
    return value


def _timestamp(value: datetime) -> str:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat(timespec="microseconds").rstrip("0").rstrip(".") + "Z"


def public(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return _timestamp(value)
    if isinstance(value, Decimal):
        number = float(value)
        return int(number) if number.is_integer() else number
    if isinstance(value, list):
        return [public(v) for v in value]
    if isinstance(value, dict):
        return _trim_message({("id" if k == "_id" else k): public(v) for k, v in value.items()})
    if isinstance(value, Base):
        result = {("include_datetime" if c.name == "include_date_time" else c.name): public(getattr(value, c.name)) for c in value.__table__.columns if c.name not in {"password", "api_key_ciphertext"}}
        if isinstance(value, User) and result.get("member_expiry") is None:
            result.pop("member_expiry", None)
        if isinstance(value, Announcement) and result.get("published_at") is None:
            result.pop("published_at", None)
        if isinstance(value, Feedback):
            for optional in ("user_id", "meta", "replied_at"):
                if result.get(optional) is None:
                    result.pop(optional, None)
            if not result.get("reply_content"):
                result.pop("reply_content", None)
        return result
    return value


def oid(value: str) -> ObjectId:
    return ObjectId(value)
