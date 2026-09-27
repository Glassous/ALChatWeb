from __future__ import annotations

import io
import os
import uuid

from .config import Settings


class COS:
    def __init__(self, cfg: Settings):
        if not all((cfg.COS_SECRET_ID, cfg.COS_SECRET_KEY, cfg.COS_BUCKET, cfg.COS_REGION)):
            raise ValueError("COS configuration is missing")
        from qcloud_cos import CosConfig, CosS3Client
        self.cfg = cfg
        self.client = CosS3Client(CosConfig(Region=cfg.COS_REGION, SecretId=cfg.COS_SECRET_ID, SecretKey=cfg.COS_SECRET_KEY, Scheme="https"))

    def url(self, key: str) -> str:
        domain = self.cfg.COS_CUSTOM_DOMAIN.removeprefix("https://").rstrip("/") or f"{self.cfg.COS_BUCKET}.cos.{self.cfg.COS_REGION}.myqcloud.com"
        return f"https://{domain}/{key}"

    def upload(self, content: bytes, filename: str, folder: str) -> str:
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}" if folder else f"{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        self.client.put_object(Bucket=self.cfg.COS_BUCKET, Body=io.BytesIO(content), Key=key)
        return self.url(key)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.cfg.COS_BUCKET, Key=key)

    def presign(self, folder: str, filename: str, mime: str) -> tuple[str, str]:
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        signed = self.client.get_presigned_url(Method="PUT", Bucket=self.cfg.COS_BUCKET, Key=key, Expired=3600, Headers={"Content-Type": mime})
        return signed, self.url(key)
