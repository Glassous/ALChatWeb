from __future__ import annotations

import io
import mimetypes
import os
import uuid
from urllib.parse import urlparse

from .config import Settings


MAX_IMAGE_BYTES = 50 * 1024 * 1024


def image_file_metadata(content: bytes) -> tuple[str, str]:
    """Return a filename and MIME type for a supported image format."""
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image.png", "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image.jpg", "image/jpeg"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image.webp", "image/webp"
    raise ValueError("Unsupported image format; expected PNG, JPEG, or WebP")


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
        mime = mimetypes.guess_type(filename)[0]
        options = {"ContentType": mime} if mime else {}
        self.client.put_object(Bucket=self.cfg.COS_BUCKET, Body=io.BytesIO(content), Key=key, **options)
        return self.url(key)

    def download_image(self, url: str) -> bytes:
        parsed = urlparse(url)
        hosts = {
            urlparse(self.url("")).netloc,
            f"{self.cfg.COS_BUCKET}.cos.{self.cfg.COS_REGION}.myqcloud.com",
        }
        key = parsed.path.lstrip("/")
        if parsed.scheme != "https" or parsed.netloc not in hosts or parsed.query or parsed.fragment or not key.startswith(("images/", "reference_files/")):
            raise ValueError("Reference image must be hosted in this project's COS bucket")
        response = self.client.get_object(Bucket=self.cfg.COS_BUCKET, Key=key)
        stream = response["Body"].get_raw_stream()
        try:
            content = stream.read(MAX_IMAGE_BYTES + 1)
        finally:
            stream.close()
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError("Reference image is empty or exceeds the 50MB limit")
        image_file_metadata(content)
        return content

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.cfg.COS_BUCKET, Key=key)

    def presign(self, folder: str, filename: str, mime: str) -> tuple[str, str]:
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        signed = self.client.get_presigned_url(Method="PUT", Bucket=self.cfg.COS_BUCKET, Key=key, Expired=3600, Headers={"Content-Type": mime})
        return signed, self.url(key)
