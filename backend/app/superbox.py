"""Per-run Superbox discovery and validated, server-only HTTP tool transport."""
from __future__ import annotations

import hashlib
import asyncio
import json
import re
from copy import deepcopy
from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urlsplit

import httpx
from jsonschema import Draft202012Validator

from .media import image_file_metadata, MAX_DOCUMENT_BYTES

EXIF_INPUT_LIMIT = 20 * 1024 * 1024
EXIF_OUTPUT_LIMIT = 21 * 1024 * 1024
EXIF_PATHS = {"/exif/inspect", "/exif/edit"}


def exif_schema(edit):
    properties = {"image_url": {"type": "string", "minLength": 1, "maxLength": 2048}}
    required = ["image_url"]
    if edit:
        common = {"key": {"type": "string", "minLength": 1, "maxLength": 200}}
        properties["changes"] = {"type": "array", "minItems": 1, "maxItems": 100, "items": {"oneOf": [
            {"type": "object", "properties": {**common, "action": {"const": "set"}, "value": {"type": "string", "minLength": 1, "maxLength": 4096}}, "required": ["key", "action", "value"], "additionalProperties": False},
            {"type": "object", "properties": {**common, "action": {"const": "delete"}}, "required": ["key", "action"], "additionalProperties": False},
        ]}}
        required.append("changes")
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}

MANAGEMENT = {"/health", "/tools", "/tools/{slug}", "/skill", "/skill.json", "/openapi.json"}
SENSITIVE = re.compile(r"authorization|api[_-]?key|password|secret|access[_-]?token|cookie|credentials", re.I)


def safe_value(value):
    if isinstance(value, dict):
        return {str(k): "[已隐藏]" if SENSITIVE.search(str(k)) else safe_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [safe_value(v) for v in value]
    if isinstance(value, str):
        return re.sub(r"(?i)bearer\s+[\w./+=-]+", "Bearer [已隐藏]", value)
    return value


def preview(value, limit=8192):
    clean = safe_value(value)
    text = clean if isinstance(clean, str) else json.dumps(clean, ensure_ascii=False, indent=2)
    return text[:limit], len(text) > limit


def failure(code, message, **extra):
    return {"error": message, "code": code, "message": message, "details": None, "http_status": None, **extra}


class Unsupported(ValueError):
    pass


class ResponseTooLarge(Unsupported):
    pass


def resolve_schema(schema, document, refs=()):
    if len(refs) > 20:
        raise Unsupported("schema 引用层级过深")
    if isinstance(schema, list):
        return [resolve_schema(v, document, refs) for v in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        ref = schema["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#/") or ref in refs:
            raise Unsupported("不支持外部或循环 schema 引用")
        value = document
        try:
            for part in ref[2:].split("/"):
                value = value[part.replace("~1", "/").replace("~0", "~")]
        except (KeyError, TypeError):
            raise Unsupported("schema 引用不存在") from None
        merged = resolve_schema(value, document, (*refs, ref))
        return {**merged, **resolve_schema({k: v for k, v in schema.items() if k != "$ref"}, document, (*refs, ref))}
    resolved = {k: resolve_schema(v, document, refs) for k, v in schema.items() if k != "nullable"}
    if schema.get("nullable"):
        resolved = {"anyOf": [resolved, {"type": "null"}], **({"default": resolved["default"]} if "default" in resolved else {})}
    return resolved


def apply_defaults(value, schema):
    """Keep string scalars intact and apply only schema-declared defaults."""
    if not isinstance(schema, dict):
        return value
    for branch in schema.get("allOf", []):
        value = apply_defaults(value, branch)
    for keyword in ("oneOf", "anyOf"):
        for branch in schema.get(keyword, []):
            if Draft202012Validator(branch).is_valid(value):
                value = apply_defaults(value, branch)
                break
    if isinstance(value, dict):
        for key, child in schema.get("properties", {}).items():
            if key not in value and "default" in child:
                value[key] = deepcopy(child["default"])
            if key in value:
                value[key] = apply_defaults(value[key], child)
    elif isinstance(value, list) and isinstance(schema.get("items"), dict):
        value = [apply_defaults(item, schema["items"]) for item in value]
    return value


@dataclass
class Operation:
    name: str
    title: str
    description: str
    method: str
    path: str
    schema: dict
    validator: Draft202012Validator = field(repr=False)
    transport: str = "json"
    responses: dict = field(default_factory=dict)

    def validate(self, arguments):
        error = next(self.validator.iter_errors(arguments), None)
        if error:
            location = ".".join(str(p) for p in error.absolute_path) or "请求"
            return failure("VALIDATION_ERROR", f"参数 {location} 不符合 {error.validator} 约束，请按工具参数定义修正")
        if len(json.dumps(arguments).encode()) > 8 * 1024 * 1024:
            return failure("INPUT_TOO_LARGE", "插件参数超过 8 MiB 上限")
        if any(p in (".", "..") for value in arguments.get("path", {}).values() for p in unquote(str(value)).split("/")):
            return failure("VALIDATION_ERROR", "路径参数包含不支持的路径片段")
        return None

    def metadata(self):
        return {"name": self.name, "title": self.title, "method": self.method, "path": self.path}


@dataclass
class Catalog:
    operations: list[Operation] = field(default_factory=list)
    unsupported: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    version: str = ""
    digest: str = ""
    guidance: str = ""

    def metadata(self):
        return {"provider": "Superbox", "version": self.version, "digest": self.digest,
            "available": [op.metadata() for op in self.operations], "unsupported": self.unsupported,
            "warnings": self.warnings}


class Superbox:
    def __init__(self, base_url):
        url = urlsplit(base_url.rstrip("/"))
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise Unsupported("Superbox 必须配置不含凭证的 HTTPS 服务地址")
        self.base_url = base_url.rstrip("/")
        self.prefix = url.path.rstrip("/")
        self.writable = set()
        self.readonly = {}

    def relative(self, path):
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path or "\\" in path:
            raise Unsupported("无效的操作路径")
        if path.startswith(self.prefix + "/"):
            path = path[len(self.prefix):]
        if any(p in (".", "..") for p in unquote(path).split("/")):
            raise Unsupported("无效的操作路径")
        return path

    def request(self, method, path, timeout, max_bytes=2 * 1024 * 1024, check=lambda: None, **kwargs):
        # No redirects, cookies from other requests, user JWT, or inherited auth.
        async def fetch():
            # An absolute timeout also bounds redirects/streaming/slow trickles,
            # rather than only limiting each individual socket read.
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                    async with client.stream(method, self.base_url + self.relative(path), **kwargs) as response:
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            check()
                            data.extend(chunk)
                            limit = max_bytes if 200 <= response.status_code < 300 else 2 * 1024 * 1024
                            if len(data) > limit:
                                raise ResponseTooLarge("Superbox 响应超过大小上限")
                        return response.status_code, response.headers.get("content-type", ""), bytes(data)
        return asyncio.run(fetch())

    def discover(self, timeout, check):
        catalog, documents = Catalog(), {}
        for path in ("/skill", "/skill.json", "/openapi.json"):
            check()
            try:
                status, kind, raw = self.request("GET", path, timeout(), check=check)
                if status != 200:
                    raise Unsupported("功能文档请求失败")
                documents[path] = raw.decode("utf-8") if path == "/skill" else json.loads(raw)
            except (httpx.HTTPError, ValueError, UnicodeError, TimeoutError):
                if path == "/skill":
                    catalog.warnings.append("Skill Markdown 获取失败，使用功能清单中的说明")
                else:
                    catalog.warnings.append("Superbox 功能清单或 OpenAPI 获取失败，插件暂不可用")
                    return catalog
        manifest, spec = documents["/skill.json"], documents["/openapi.json"]
        if not isinstance(manifest, dict) or not isinstance(spec, dict) or not isinstance(manifest.get("endpoints"), list) or not isinstance(spec.get("paths"), dict):
            catalog.warnings.append("Superbox 功能文档结构无效，插件暂不可用")
            return catalog
        catalog.version = str(spec.get("info", {}).get("version", manifest.get("version", "")))[:100]
        catalog.digest = hashlib.sha256(json.dumps(documents, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        instructions = documents.get("/skill") or json.dumps({"conventions": manifest.get("conventions", []), "guidance": manifest.get("guidance", [])}, ensure_ascii=False)
        # Operational guidance also lives on each tool, so later tools are never
        # silently removed by truncating a monolithic Skill document.
        catalog.guidance = preview({"conventions": manifest.get("conventions", []), "guidance": manifest.get("guidance", [])}, 12000)[0]
        sections = re.split(r"(?m)^#{3,4}\s+", instructions)
        seen = set()
        for endpoint in manifest["endpoints"]:
            if not isinstance(endpoint, dict):
                continue
            title = str(endpoint.get("name", "未命名功能"))[:150]
            try:
                method, path = str(endpoint.get("method", "")).upper(), self.relative(endpoint.get("path"))
                if path in MANAGEMENT or (method, path) in seen:
                    continue
                seen.add((method, path))
                if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                    raise Unsupported("暂不支持此 HTTP 方法")
                full_path = self.prefix + path
                path_item = spec["paths"].get(full_path, spec["paths"].get(path, {}))
                operation = path_item.get(method.lower())
                if not isinstance(operation, dict):
                    raise Unsupported("清单与 OpenAPI 操作不匹配")
                properties, required = {}, []
                params = resolve_schema(path_item.get("parameters", []) + operation.get("parameters", []), spec)
                for location in ("query", "path"):
                    items = [p for p in params if p.get("in") == location]
                    if items:
                        section = {"type": "object", "properties": {p["name"]: p["schema"] for p in items}, "additionalProperties": False}
                        section["required"] = [p["name"] for p in items if p.get("required") or location == "path"]
                        properties[location] = section
                        if section["required"]:
                            required.append(location)
                if any(p.get("in") not in ("query", "path") for p in params):
                    raise Unsupported("暂不支持请求头或 Cookie 参数")
                transport = "json"
                body = resolve_schema(operation.get("requestBody", {}), spec)
                if body:
                    content = body.get("content", {})
                    if method == "POST" and path in EXIF_PATHS and set(content) == {"multipart/form-data"}:
                        fields = content["multipart/form-data"]["schema"].get("properties", {})
                        if "image" not in fields or "image_url" not in fields or (path == "/exif/edit" and "changes" not in fields):
                            raise Unsupported("EXIF 接口参数不兼容")
                        transport = "exif"
                        properties["body"] = exif_schema(path == "/exif/edit")
                        required.append("body")
                    elif method == "POST" and path == "/documents/convert" and "multipart/form-data" in content:
                        fields = content["multipart/form-data"]["schema"].get("properties", {})
                        if not {"file", "file_url", "format"} <= fields.keys():
                            raise Unsupported("文档接口参数不兼容")
                        transport = "document"
                        properties["body"] = {"type": "object", "properties": {"file_url": {"type": "string", "minLength": 1, "maxLength": 2048}, "format": fields["format"]}, "required": ["file_url"], "additionalProperties": False}
                        required.append("body")
                    elif "application/json" not in content or any(t != "application/json" for t in content):
                        raise Unsupported("暂不支持文件上传或非 JSON 请求")
                    else:
                        properties["body"] = content["application/json"]["schema"]
                        if body.get("required"):
                            required.append("body")
                responses = resolve_schema(operation.get("responses", {}), spec)
                for code, response in responses.items():
                    if str(code).startswith("2"):
                        types = resolve_schema(response, spec).get("content", {})
                        allowed = {"application/json", "image/jpeg", "image/png", "image/webp"} if transport == "exif" and path == "/exif/edit" else {"application/json"}
                        if types and any(t not in allowed for t in types):
                            raise Unsupported("暂不支持二进制或非 JSON 结果")
                placeholders = re.findall(r"\{([^{}]+)\}", path)
                if any(p not in properties.get("path", {}).get("properties", {}) for p in placeholders):
                    raise Unsupported("路径参数定义不完整")
                schema = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
                Draft202012Validator.check_schema(schema)
                signature = f"{method} {path}"
                label = re.sub(r"[^a-zA-Z0-9_]", "_", str(operation.get("operationId", "tool")))[:36]
                name = f"superbox_{label}_{hashlib.sha256(signature.encode()).hexdigest()[:10]}"
                description = str(endpoint.get("summary", ""))[:1000] + "\n请求规则：" + str(endpoint.get("request", ""))[:4000]
                matching = [section for section in sections if path in section or full_path in section]
                if matching:
                    description += "\n" + preview(matching[0], 7000)[0]
                if transport == "exif":
                    description += " 仅处理当前会话 COS 原始图片（JPEG/PNG/WebP，20 MiB）。编辑前先调用读取或可写标签查询确认 key；changes 是结构化数组。编辑成功返回 COS 图片 URL，最终回复须提供预览和下载链接。"
                if transport == "document":
                    description += " 使用当前分支 COS 文档或已转存文件的 file_url；PDF/DOCX/XLSX 最大 5 MiB，不支持 OCR、加密和宏。返回全文、统计、警告和可下载文件；预览截断不代表完整文档已被阅读。"
                catalog.operations.append(Operation(name, title, description, method, path, schema, Draft202012Validator(schema), transport, responses))
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                reason = str(exc) if isinstance(exc, Unsupported) else "无法解析参数 schema"
                catalog.unsupported.append({"title": title, "reason": reason})
            except Exception:
                catalog.unsupported.append({"title": title, "reason": "无法解析参数 schema"})
        return catalog

    def validate(self, operation, arguments):
        invalid = operation.validate(arguments)
        if invalid:
            return invalid
        if operation.transport == "exif" and operation.path == "/exif/edit":
            body = arguments["body"]
            for change in body["changes"]:
                key = change["key"]
                if key in self.readonly.get(body["image_url"], set()):
                    return failure("VALIDATION_ERROR", f"标签 {key} 为只读，当前做不到该修改")
                if key not in self.writable:
                    return failure("VALIDATION_ERROR", f"请先调用 EXIF 读取或可写标签查询确认 {key} 可以编辑")
        return None

    def call(self, operation, arguments, timeout, attachments=None):
        arguments = apply_defaults(deepcopy(arguments), operation.schema)
        invalid = self.validate(operation, arguments)
        if invalid:
            return invalid
        path = operation.path
        for name, value in arguments.get("path", {}).items():
            path = path.replace("{" + name + "}", quote(str(value), safe=""))
        try:
            kwargs = {"params": {k: v for k, v in arguments.get("query", {}).items() if v is not None}, "max_bytes": 8 * 1024 * 1024, "check": attachments.check if attachments else lambda: None}
            if operation.transport == "exif":
                if attachments is None:
                    return failure("ATTACHMENT_UNAVAILABLE", "当前做不到附件处理：附件上下文不可用")
                body = arguments["body"]
                try:
                    image = attachments.download(body["image_url"], EXIF_INPUT_LIMIT)
                    filename, mime = image_file_metadata(image)
                except (ValueError, TimeoutError) as exc:
                    return failure("ATTACHMENT_UNSUPPORTED", f"当前做不到该 EXIF 处理：{exc}")
                except Exception:
                    attachments.check()
                    return failure("ATTACHMENT_UNAVAILABLE", "当前做不到该 EXIF 处理：无法读取 COS 原始图片")
                kwargs["files"] = {"image": (filename, image, mime)}
                if operation.path == "/exif/edit":
                    kwargs["data"] = {"changes": json.dumps(body["changes"], ensure_ascii=False)}
                    kwargs["max_bytes"] = EXIF_OUTPUT_LIMIT
                timeout = min(timeout, attachments.timeout())
            elif operation.transport == "document":
                if attachments is None:
                    return failure("ATTACHMENT_UNAVAILABLE", "附件上下文不可用")
                body = arguments["body"]
                url = body["file_url"]
                if url not in attachments.items:
                    return failure("ATTACHMENT_UNAVAILABLE", "请先转存文件；只能转换当前分支附件和本次转存结果")
                info = attachments.cos().metadata(url)
                if info["size"] > MAX_DOCUMENT_BYTES:
                    return failure("FILE_TOO_LARGE", "Superbox 文档转换限制为 5 MiB")
                # Field-only multipart, not application/x-www-form-urlencoded.
                kwargs["files"] = {"file_url": (None, url), "format": (None, body.get("format", "markdown"))}
            elif "body" in arguments:
                kwargs["json"] = arguments["body"]
            status, kind, raw = self.request(operation.method, path, timeout, **kwargs)
            mime = kind.split(";")[0].strip().lower()
            if operation.transport == "exif" and operation.path == "/exif/edit" and 200 <= status < 300 and mime.startswith("image/"):
                filename, mime = image_file_metadata(raw)
                if kind.split(";")[0].lower() != mime or len(raw) > EXIF_OUTPUT_LIMIT:
                    return failure("UNSUPPORTED_RESPONSE", "当前做不到结果交付：EXIF 返回的图片格式或大小无效")
                try:
                    item = attachments.save(raw, filename, mime)
                except Exception:
                    attachments.check()
                    return failure("COS_UPLOAD_FAILED", "当前做不到结果交付：修改后的图片上传 COS 失败，未交付结果文件")
                return {"result": item, "attachments": [item], "truncated": False}
            if mime != "application/json":
                if not 200 <= status < 300:
                    code = {413: "FILE_TOO_LARGE", 415: "UNSUPPORTED_FORMAT", 429: "TOOL_BUSY", 503: "SERVICE_UNAVAILABLE", 504: "PROVIDER_TIMEOUT"}.get(status, "HTTP_ERROR")
                    return failure(code, "Superbox 返回非 JSON 错误响应", http_status=status)
                return failure("UNSUPPORTED_RESPONSE", "Superbox 响应类型不符合接口规范", http_status=status)
            payload = json.loads(raw)
            if not 200 <= status < 300:
                code = str(payload.get("code", "HTTP_ERROR")) if isinstance(payload, dict) else "HTTP_ERROR"
                code = code if re.fullmatch(r"[A-Z0-9_]{1,64}", code) else "HTTP_ERROR"
                message = str(payload.get("message", "插件请求失败"))[:1000] if isinstance(payload, dict) else "插件请求失败"
                return failure(code, message, details=safe_value(payload.get("details")) if isinstance(payload, dict) else None, http_status=status)
            response_schema = operation.responses.get(str(status), operation.responses.get("2XX", {})).get("content", {}).get("application/json", {}).get("schema", {})
            if next(Draft202012Validator(response_schema).iter_errors(payload), None):
                return failure("INVALID_RESPONSE", "Superbox 成功响应不符合 OpenAPI schema", http_status=status)
            if operation.path == "/exif/edit":
                return failure("UNSUPPORTED_RESPONSE", "EXIF 编辑未返回结果图片，无法交付")
            if path in ("/exif/inspect", "/exif/tags") and isinstance(payload, dict):
                tags = payload.get("tags", [])
                self.writable.update(t["key"] for t in tags if isinstance(t, dict) and t.get("writable") is True and isinstance(t.get("key"), str))
                if path == "/exif/inspect":
                    self.readonly[arguments["body"]["image_url"]] = {t["key"] for t in tags if isinstance(t, dict) and t.get("writable") is False and isinstance(t.get("key"), str)}
            text, truncated = preview(payload, 32768)
            files = []
            if operation.transport == "document" or truncated:
                if attachments is None:
                    return failure("COS_UPLOAD_FAILED", "完整结果无法保存：附件上下文不可用")
                if operation.transport == "document":
                    filename, content = payload["filename"], payload["result"]
                    output_mime = "text/markdown" if payload["format"] == "markdown" else "text/plain"
                    filename = re.sub(r"\.[^.]+$", "", filename) + (".md" if payload["format"] == "markdown" else ".txt")
                elif isinstance(payload, dict) and isinstance(payload.get("result"), str) and set(payload) == {"result"}:
                    filename, content, output_mime = "superbox-result.txt", payload["result"], "text/plain"
                else:
                    filename = "superbox-result.json"
                    content = json.dumps(payload, ensure_ascii=False, indent=2)
                    output_mime = "application/json"
                try:
                    files.append(attachments.save(content.encode("utf-8"), filename, output_mime))
                except Exception:
                    attachments.check()
                    return failure("COS_UPLOAD_FAILED", "完整结果上传 COS 失败，未交付结果文件")
            return {"result": safe_value(payload) if not truncated else text, "attachments": files, "truncated": truncated,
                    **({"stats": payload.get("stats", {}), "warnings": payload.get("warnings", []), "format": payload["format"], "filename": payload["filename"], "source_type": payload["source_type"]} if operation.transport == "document" else {})}
        except (httpx.TimeoutException, TimeoutError):
            return failure("PROVIDER_TIMEOUT", "Superbox 请求超时")
        except ResponseTooLarge:
            return failure("RESPONSE_TOO_LARGE", "Superbox 响应超过传输大小上限")
        except httpx.HTTPError:
            return failure("SERVICE_UNAVAILABLE", "Superbox 服务暂不可用")
        except ValueError:
            return failure("INVALID_RESPONSE", "Superbox 响应无效，可调整参数或使用其他功能")
