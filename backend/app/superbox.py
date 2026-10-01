"""Per-run Superbox discovery and validated, server-only HTTP tool transport."""
from __future__ import annotations

import hashlib
import asyncio
import json
import re
from dataclasses import dataclass, field
from urllib.parse import quote, unquote, urlsplit

import httpx
from jsonschema import Draft202012Validator

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
    return {"error": message, "code": code, **extra}


class Unsupported(ValueError):
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
    return {k: resolve_schema(v, document, refs) for k, v in schema.items()}


@dataclass
class Operation:
    name: str
    title: str
    description: str
    method: str
    path: str
    schema: dict
    validator: Draft202012Validator = field(repr=False)

    def validate(self, arguments):
        error = next(self.validator.iter_errors(arguments), None)
        if error:
            location = ".".join(str(p) for p in error.absolute_path) or "请求"
            return failure("VALIDATION_ERROR", f"参数 {location} 不符合 {error.validator} 约束，请按工具参数定义修正")
        if len(json.dumps(arguments).encode()) > 1024 * 1024:
            return failure("INPUT_TOO_LARGE", "插件参数超过 1 MiB 上限")
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

    def relative(self, path):
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path or "\\" in path:
            raise Unsupported("无效的操作路径")
        if path.startswith(self.prefix + "/"):
            path = path[len(self.prefix):]
        if any(p in (".", "..") for p in unquote(path).split("/")):
            raise Unsupported("无效的操作路径")
        return path

    def request(self, method, path, timeout, **kwargs):
        # No redirects, cookies from other requests, user JWT, or inherited auth.
        async def fetch():
            # An absolute timeout also bounds redirects/streaming/slow trickles,
            # rather than only limiting each individual socket read.
            async with asyncio.timeout(timeout):
                async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                    async with client.stream(method, self.base_url + self.relative(path), **kwargs) as response:
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            data.extend(chunk)
                            if len(data) > 2 * 1024 * 1024:
                                raise Unsupported("Superbox 响应超过 2 MiB 上限")
                        return response.status_code, response.headers.get("content-type", ""), bytes(data)
        return asyncio.run(fetch())

    def discover(self, timeout, check):
        catalog, documents = Catalog(), {}
        for path in ("/skill", "/skill.json", "/openapi.json"):
            check()
            try:
                status, kind, raw = self.request("GET", path, timeout())
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
        catalog.version = str(manifest.get("version", ""))[:100]
        catalog.digest = hashlib.sha256(json.dumps(documents, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        instructions = documents.get("/skill") or json.dumps({"conventions": manifest.get("conventions", []), "guidance": manifest.get("guidance", [])}, ensure_ascii=False)
        catalog.guidance = preview(instructions, 12000)[0]
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
                body = resolve_schema(operation.get("requestBody", {}), spec)
                if body:
                    content = body.get("content", {})
                    if "application/json" not in content or any(t != "application/json" for t in content):
                        raise Unsupported("暂不支持文件上传或非 JSON 请求")
                    properties["body"] = content["application/json"]["schema"]
                    if body.get("required"):
                        required.append("body")
                responses = operation.get("responses", {})
                for code, response in responses.items():
                    if str(code).startswith("2"):
                        types = resolve_schema(response, spec).get("content", {})
                        if types and any(t != "application/json" for t in types):
                            raise Unsupported("暂不支持二进制或非 JSON 结果")
                placeholders = re.findall(r"\{([^{}]+)\}", path)
                if any(p not in properties.get("path", {}).get("properties", {}) for p in placeholders):
                    raise Unsupported("路径参数定义不完整")
                schema = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
                Draft202012Validator.check_schema(schema)
                signature = f"{method} {path}"
                label = re.sub(r"[^a-zA-Z0-9_]", "_", str(operation.get("operationId", "tool")))[:36]
                name = f"superbox_{label}_{hashlib.sha256(signature.encode()).hexdigest()[:10]}"
                catalog.operations.append(Operation(name, title, str(endpoint.get("summary", ""))[:1000], method, path, schema, Draft202012Validator(schema)))
            except (ValueError, KeyError, TypeError, AttributeError) as exc:
                reason = str(exc) if isinstance(exc, Unsupported) else "无法解析参数 schema"
                catalog.unsupported.append({"title": title, "reason": reason})
            except Exception:
                catalog.unsupported.append({"title": title, "reason": "无法解析参数 schema"})
        return catalog

    def call(self, operation, arguments, timeout):
        invalid = operation.validate(arguments)
        if invalid:
            return invalid
        path = operation.path
        for name, value in arguments.get("path", {}).items():
            path = path.replace("{" + name + "}", quote(str(value), safe=""))
        try:
            kwargs = {"params": arguments.get("query", {})}
            if "body" in arguments:
                if len(json.dumps(arguments["body"]).encode()) > 1024 * 1024:
                    return failure("INPUT_TOO_LARGE", "插件请求体超过 1 MiB 上限")
                kwargs["json"] = arguments["body"]
            status, kind, raw = self.request(operation.method, path, timeout, **kwargs)
            if "application/json" not in kind.lower():
                return failure("UNSUPPORTED_RESPONSE", "Superbox 返回非 JSON 结果，首版暂不支持", http_status=status)
            payload = safe_value(json.loads(raw))
            if not 200 <= status < 300:
                code = str(payload.get("code", "HTTP_ERROR")) if isinstance(payload, dict) else "HTTP_ERROR"
                code = code if re.fullmatch(r"[A-Z0-9_]{1,64}", code) else "HTTP_ERROR"
                message = str(payload.get("message", "插件请求失败"))[:1000] if isinstance(payload, dict) else "插件请求失败"
                return failure(code, message, http_status=status)
            text, truncated = preview(payload, 32768)
            return {"result": payload if not truncated else text, "truncated": truncated}
        except (httpx.HTTPError, ValueError, TimeoutError):
            return failure("PROVIDER_ERROR", "Superbox 请求失败或响应无效，可调整参数或使用其他功能")
