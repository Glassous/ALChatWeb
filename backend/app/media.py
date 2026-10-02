from __future__ import annotations

import io
import mimetypes
import os
import re
import time
import uuid
import zipfile
from urllib.parse import urlparse, quote, unquote

from .config import Settings


MAX_IMAGE_BYTES = 50 * 1024 * 1024
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_TRANSFER_BYTES = 10 * 1024 * 1024
DOCUMENT_MIMES = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
TEXT_EXTENSIONS = {"txt", "md", "markdown", "csv", "tsv", "log", "json", "jsonl", "ndjson", "yaml", "yml", "xml", "ini", "cfg", "conf", "toml", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "sh", "bat", "ps1", "sql", "r", "java", "kt", "kts", "c", "h", "cpp", "hpp", "rs", "go", "tex"}


def text_file_metadata(filename: str, content: str) -> tuple[str, bytes]:
    if not isinstance(filename, str) or not filename.strip() or clean_filename(filename) != filename or "." not in filename or not filename.rsplit(".", 1)[0].strip(". ") or filename.rsplit(".", 1)[-1].lower() not in TEXT_EXTENSIONS:
        raise ValueError("请指定有效的文件名和纯文本扩展名，例如 报告.txt、笔记.md、数据.csv")
    if not isinstance(content, str) or not content.strip() or "\x00" in content:
        raise ValueError("必须提供非空纯文本内容，不能包含二进制空字符")
    data = content.encode("utf-8")
    if len(data) > MAX_TRANSFER_BYTES:
        raise ValueError("创建的文本文件不能超过 10 MiB")
    mime = {"md": "text/markdown", "markdown": "text/markdown", "csv": "text/csv", "tsv": "text/tab-separated-values", "json": "application/json", "xml": "application/xml"}.get(filename.rsplit(".", 1)[-1].lower(), "text/plain")
    return mime + "; charset=utf-8", data
MEDIA_TAG = re.compile(r'<(image|file|video)\s+src="([^"]+)">', re.I)


def clean_filename(value: str) -> str:
    return re.sub(r'[\x00-\x1f\x7f]', '', str(value).replace('\\', '/').split('/')[-1])[:240] or "file"


def is_document(filename: str, mime: str = "") -> bool:
    return os.path.splitext(urlparse(filename).path)[1].lower() in DOCUMENT_MIMES or mime in DOCUMENT_MIMES.values()


def document_metadata(content: bytes, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext not in DOCUMENT_MIMES:
        raise ValueError("仅支持 PDF、DOCX、XLSX 文档")
    if not content or len(content) > MAX_DOCUMENT_BYTES:
        raise ValueError("文档大小必须大于零且不超过 5 MiB")
    if ext == ".pdf":
        if not re.match(br"%PDF-(?:1\.[0-9]|2\.0)", content) or b"%%EOF" not in content[-2048:]:
            raise ValueError("PDF 文件内容无效")
    else:
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                required = "word/document.xml" if ext == ".docx" else "xl/workbook.xml"
                names = {entry.filename for entry in entries}
                if not {"[Content_Types].xml", required} <= names or len(entries) > 2000 or sum(e.file_size for e in entries) > 50 * 1024 * 1024 or any(e.flag_bits & 1 or "vbaProject.bin" in e.filename for e in entries):
                    raise ValueError("Office 文档结构无效、加密或超过限制")
        except zipfile.BadZipFile as exc:
            raise ValueError("Office 文档内容无效") from exc
    return DOCUMENT_MIMES[ext]


def validate_message_attachments(cfg, content: str, supplied=None, agent=False) -> list[dict]:
    """The object HEAD, not client metadata, decides type and size."""
    from .core import fail
    if supplied is not None and (not isinstance(supplied, list) or len(supplied) > 100 or any(not isinstance(item, dict) or not isinstance(item.get("url"), str) for item in supplied)):
        fail(400, "附件描述必须是有效的 URL 列表（最多 100 项）")
    descriptors = {item["url"]: item for item in (supplied or [])}
    result = []
    references = {match.group(2): match.group(1) for match in MEDIA_TAG.finditer(content)}
    references.update({url: references.get(url, "file") for url in descriptors})
    for url, tag in references.items():
        try:
            info = COS(cfg).metadata(url)
        except Exception:
            fail(400, "附件不可用，请重新上传")
        filename = clean_filename(info.get("filename") or descriptors.get(url, {}).get("filename") or unquote(urlparse(url).path.split('/')[-1]))
        mime = info.get("mime_type", "")
        if info["size"] <= 0:
            fail(400, "附件为空，请重新上传")
        if is_document(url, mime) or is_document(filename, mime):
            if not agent:
                fail(400, "文档附件仅限 Agent 模式")
            if info["size"] > MAX_DOCUMENT_BYTES:
                fail(400, "文档大小不能超过 5 MiB")
        kind = attachment_type(url, "file", mime)
        if not agent and kind not in ("image", "video"):
            fail(400, "普通模式仅支持图片或视频附件")
        if not any(item["url"] == url for item in result):
            result.append({"url": url, "filename": filename, "mime_type": mime, "size": info["size"], "type": kind})
    return result


def attachment_type(url: str, tag: str = "file", mime: str = "") -> str:
    if is_document(url, mime):
        return "document"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    guessed = mimetypes.guess_type(urlparse(url).path)[0] or ""
    if guessed.startswith("video/") or tag.lower() == "video":
        return "video"
    if guessed.startswith("image/") or tag.lower() == "image":
        return "image"
    return "file"


def attachment_text(url: str, kind: str) -> str:
    label = {"image": "图片", "video": "视频", "document": "文档", "file": "文件", "unknown": "文件"}.get(kind, "文件")
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

    def upload(self, content: bytes, filename: str, folder: str, mime: str = "") -> str:
        filename = clean_filename(filename)
        key = f"{folder}/{uuid.uuid4()}{os.path.splitext(filename)[1]}" if folder else f"{uuid.uuid4()}{os.path.splitext(filename)[1]}"
        mime = mime or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        options = {"ContentType": mime, "Metadata": {"filename": quote(filename, safe="")}}
        if not mime.startswith(("image/", "video/")) or mime == "image/svg+xml":
            options["ContentDisposition"] = "attachment; filename*=UTF-8''" + quote(filename, safe="")
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
        return {"filename": unquote(str(response.get("x-cos-meta-filename", ""))), "mime_type": str(response.get("Content-Type", "")).split(";")[0].lower(),
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
