from __future__ import annotations

import io
import mimetypes
import os
import re
import time
import uuid
from urllib.parse import urlparse

from .config import Settings


MAX_IMAGE_BYTES = 50 * 1024 * 1024
MEDIA_TAG = re.compile(r'<(image|file|video)\s+src="([^"]+)">', re.I)


def attachment_type(url: str, tag: str = "file", mime: str = "") -> str:
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    guessed = mimetypes.guess_type(urlparse(url).path)[0] or ""
    if guessed.startswith("video/") or tag.lower() == "video":
        return "video"
    if guessed.startswith("image/") or tag.lower() == "image":
        return "image"
    return "unknown"


def attachment_text(url: str, kind: str) -> str:
    label = {"image": "图片", "video": "视频", "unknown": "未知类型附件"}[kind]
    notice = "；当前做不到视频内容分析" if kind == "video" else ""
    return f"[附件：{label}；原始 COS URL：{url}{notice}]"


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
    def __init__(self, cfg: Settings, timeout: float = 10):
        if not all((cfg.COS_SECRET_ID, cfg.COS_SECRET_KEY, cfg.COS_BUCKET, cfg.COS_REGION)):
            raise ValueError("COS configuration is missing")
        from qcloud_cos import CosConfig, CosS3Client
        self.cfg = cfg
        self.timeout = timeout
        self.client = CosS3Client(CosConfig(Region=cfg.COS_REGION, SecretId=cfg.COS_SECRET_ID, SecretKey=cfg.COS_SECRET_KEY, Scheme="https", Timeout=timeout), retry=0)

    def url(self, key: str) -> str:
        domain = self.cfg.COS_CUSTOM_DOMAIN.removeprefix("https://").rstrip("/") or f"{self.cfg.COS_BUCKET}.cos.{self.cfg.COS_REGION}.myqcloud.com"
        return f"https://{domain}/{key}"

    def upload(self, content: bytes, filename: str, folder: str) -> str:
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}" if folder else f"{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        mime = mimetypes.guess_type(filename)[0]
        options = {"ContentType": mime} if mime else {}
        self.client.put_object(Bucket=self.cfg.COS_BUCKET, Body=io.BytesIO(content), Key=key, **options)
        return self.url(key)

    def reference_key(self, url: str) -> str:
        parsed = urlparse(url)
        hosts = {
            urlparse(self.url("")).netloc,
            f"{self.cfg.COS_BUCKET}.cos.{self.cfg.COS_REGION}.myqcloud.com",
        }
        key = parsed.path.lstrip("/")
        if parsed.scheme != "https" or parsed.netloc not in hosts or parsed.query or parsed.fragment or not key.startswith(("images/", "reference_files/")):
            raise ValueError("Reference image must be hosted in this project's COS bucket")
        if any(part in (".", "..") for part in key.split("/")):
            raise ValueError("Invalid COS object path")
        return key

    def metadata(self, url: str) -> dict:
        response = self.client.head_object(Bucket=self.cfg.COS_BUCKET, Key=self.reference_key(url))
        return {"mime_type": str(response.get("Content-Type", "")).split(";")[0].lower(),
                "size": int(response.get("Content-Length", 0))}

    def download_reference(self, url: str, limit: int = MAX_IMAGE_BYTES) -> bytes:
        key = self.reference_key(url)
        deadline = time.monotonic() + getattr(self, "timeout", 10)
        response = self.client.get_object(Bucket=self.cfg.COS_BUCKET, Key=key)
        stream = response["Body"].get_raw_stream()
        try:
            chunks, size = [], 0
            while size <= limit:
                if time.monotonic() >= deadline:
                    raise TimeoutError("COS download timed out")
                data = stream.read(min(65536, limit + 1 - size))
                if not data:
                    break
                chunks.append(data)
                size += len(data)
            content = b"".join(chunks)
        finally:
            stream.close()
        if not content or len(content) > limit:
            raise ValueError(f"Reference image is empty or exceeds the {limit // (1024 * 1024)}MB limit")
        return content

    def download_image(self, url: str) -> bytes:
        content = self.download_reference(url)
        image_file_metadata(content)
        return content

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.cfg.COS_BUCKET, Key=key)

    def presign(self, folder: str, filename: str, mime: str) -> tuple[str, str]:
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        signed = self.client.get_presigned_url(Method="PUT", Bucket=self.cfg.COS_BUCKET, Key=key, Expired=3600, Headers={"Content-Type": mime})
        return signed, self.url(key)
