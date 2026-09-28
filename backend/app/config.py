from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[1] / ".env", extra="ignore")
    PORT: int = 8080
    GIN_MODE: str = "debug"  # Legacy /health field and deployment setting.
    ALLOW_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:3001"
    MONGODB_URI: str = "mongodb://localhost:27017"
    MONGODB_DATABASE: str = ""
    MONGODB_DB: str = "alchat"
    MYSQL_DSN: str = ""
    REDIS_ADDR: str = "localhost:6379"
    REDIS_PASSWORD: str = ""
    REDIS_DB: int = 0
    JWT_SECRET: str = "your-secret-key"
    CUSTOM_MODEL_ENCRYPTION_KEY: str = ""
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-3.5-turbo"
    EXPERT_API_KEY: str = ""
    EXPERT_BASE_URL: str = "https://api.openai.com/v1"
    EXPERT_MODEL: str = "gpt-4"
    TITLE_AI_API_KEY: str = ""
    TITLE_AI_BASE_URL: str = ""
    TITLE_AI_MODEL: str = ""
    SEARCH_API_KEY: str = ""
    SEARCH_BASE_URL: str = "https://api.openai.com/v1"
    SEARCH_MODEL: str = "gpt-4"
    MULTIMODAL_API_KEY: str = ""
    MULTIMODAL_BASE_URL: str = "https://api.openai.com/v1"
    MULTIMODAL_MODEL: str = "gpt-4o"
    ALING_API_KEY: str = ""
    ALING_BASE_URL: str = "https://api.openai.com/v1"
    ALING_MODEL: str = "gpt-4o"
    BOCHA_API_KEY: str = ""
    TAVILY_API_KEY: str = ""
    OPENAI_IMAGES_API_KEY: str = ""
    OPENAI_IMAGES_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_IMAGES_MODEL: str = ""
    OPENAI_IMAGES_PROTOCOL: Literal["openai", "openrouter"] = "openai"
    COS_SECRET_ID: str = ""
    COS_SECRET_KEY: str = ""
    COS_BUCKET: str = ""
    COS_REGION: str = ""
    COS_CUSTOM_DOMAIN: str = ""
    SMTP_HOST: str = "smtp.office365.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = ""

    @property
    def mongo_db(self) -> str:
        return self.MONGODB_DATABASE or self.MONGODB_DB

    @property
    def encryption_key(self) -> str:
        return self.CUSTOM_MODEL_ENCRYPTION_KEY or self.JWT_SECRET


@lru_cache
def settings() -> Settings:
    return Settings()
