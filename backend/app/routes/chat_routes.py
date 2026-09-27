from __future__ import annotations

import json
import re
import threading
import httpx
from datetime import datetime
from urllib.parse import urlparse

from bson import ObjectId
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import StreamingResponse

from ..ai import HermesResponsesModel, Runtime
from ..conversations import is_temp
from ..core import auth, count_tokens, decrypt, deduct, fail, now, rate_limit, reset_credits
from ..media import COS
from ..storage import CustomModelConfig, HermesConfig, User

router = APIRouter()


def st():
    from ..main import current
    return current()


def uid(request: Request) -> str:
    return auth(request, st().db)["user_id"]


def _custom(user_id: str, mode: str, multimodal: bool) -> Runtime | None:
    if multimodal:
        return None
    with st().db.session() as s:
        cfg = s.get(CustomModelConfig, user_id)
        if not cfg or not cfg.enabled or not cfg.response_mode:
            return None
        enabled = {"daily": cfg.daily_enabled, "expert": cfg.expert_enabled}.get(mode, cfg.search_enabled if mode.startswith("search") else False)
        if not enabled or not cfg.base_url or not cfg.model or not cfg.api_key_ciphertext:
            return None
        return Runtime(decrypt(st().cfg, cfg.api_key_ciphertext), cfg.base_url, cfg.model, cfg.response_mode)


def _hermes(user_id: str):
    with st().db.session() as s:
        cfg = s.get(HermesConfig, user_id)
        if not cfg or not cfg.tested or not cfg.base_url or not cfg.model or not cfg.api_key_ciphertext:
            return None
        return (Runtime(decrypt(st().cfg, cfg.api_key_ciphertext), cfg.base_url, cfg.model), cfg.context_version or 1)


def _cleanup_history(messages: list[dict]) -> list[dict]:
    output = [m.copy() for m in messages]
    for m in output:
        if m["role"] == "assistant":
            text = re.sub(r"\n?<(search|weather)>.*?</\1>\n?", "", m.get("content", ""), flags=re.S)
            text = re.sub(r'<image src="([^"]+)">', r"![image](\1)", text, flags=re.I)
            m["content"] = text.strip() or "[已为您完成]"
    return output


def _system_prompt(user: User, location: str) -> str:
    sections = [user.system_prompt] if user.system_prompt else []
    if user.include_date_time:
        sections.append("当前时间: " + now().strftime("%Y-%m-%d %H:%M:%S"))
    if user.include_location and location:
        match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*", location)
        if match:
            try:
                lat, lng = map(float, match.groups())
                address = httpx.get("https://nominatim.openstreetmap.org/reverse", params={"lat": lat, "lon": lng, "format": "json", "accept-language": "zh", "zoom": 18, "addressdetails": 1}, headers={"User-Agent": "ALChat/1.0 (https://alchat.fiacloud.top)"}, timeout=5).json().get("address", {})
                location = ", ".join(x for x in (address.get("state"), address.get("city") or address.get("town") or address.get("village"), address.get("suburb") or address.get("district"), address.get("neighbourhood"), address.get("road")) if x) or location
            except Exception:
                pass
        sections.append("当前位置: " + location)
    return "\n\n".join(sections)


CLASSIFY_PROMPT = (
    "你是一个极其克制的搜索引擎使用与源选择判断助手。请根据提供的用户对话历史，判断当前用户的问题是否必须通过联网搜索来获取最新实时信息或事实知识。\n"
    "【判断与选择原则】\n"
    "1. 尽可能不要搜索！对于常识性问题、技术概念解释、日常闲聊、创意写作、代码编写、翻译、逻辑推理，以及不需要实时新鲜资讯的问题，一律不需要搜索，直接回答。\n"
    "2. 只有在用户明确查询今天/最近发生的最新实时事件、近期新闻动态、实时天气、极其精确的时效性计算或当前确切系统时间等，且模型已有知识库确实无法覆盖的领域时，才允许搜索。\n"
    "3. 在必须搜索时，根据语言和内容特征选择搜索源：\n"
    "   - 如果问题是关于中国国内资讯、中文本土事件或日常中文问答，选择使用 Bocha。输出：'SEARCH_BOCHA'。\n"
    "   - 如果问题是关于国际新闻、英文资讯、前沿英文技术文档、学术论文或代码相关的全球最新动态，选择使用 Tavily。输出：'SEARCH_TAVILY'。\n"
    "4. 如果不需要搜索（可以直接回答），输出：'DIRECT'。\n"
    "请只输出 'SEARCH_BOCHA'、'SEARCH_TAVILY' 或 'DIRECT'，绝对不要包含任何其他字样、标点或 Markdown 格式。"
)


def _search_needed(history: list[dict]) -> str:
    try:
        answer = st().ai.complete([{"role": "system", "content": CLASSIFY_PROMPT}, {"role": "user", "content": history[-1]["content"]}], "daily").upper()
        return "tavily" if "SEARCH_TAVILY" in answer else "bocha" if "SEARCH" in answer else ""
    except Exception:
        return ""


def _emit_model(conv_id: str, history: list[dict], mode: str, prompt: str, runtime: Runtime | None, content: list[str], reasoning: list[str], search_enabled: bool = True) -> dict | None:
    search_data = None
    leading: tuple[str, ...] = ()
    if search_enabled and mode.startswith("search"):
        from ..ai import NO_SEARCH_RESULTS, SEARCH_GUIDANCE

        source = "tavily" if mode.endswith("tavily") else "bocha"
        query = st().ai.keywords(history, runtime)
        st().streams.publish(conv_id, "search", data={"query": query, "status": "searching", "source": source})
        try:
            results = st().ai.search(query, source)
        except Exception:
            results = []
        search_data = {"query": query, "status": "completed", "source": source}
        if results:
            search_data["results"] = results
        st().streams.publish(conv_id, "search", data=search_data)
        tag = "\n<search>\n" + json.dumps({"query": query, "results": results, "source": source}, ensure_ascii=False) + "\n</search>\n"
        content.append(tag)
        st().streams.publish(conv_id, "token", tag)
        context = ["以下是联网搜索到的相关信息：\n"]
        if results:
            context.extend(f"[{i}] 标题: {r['title']}\n    链接: {r['url']}\n    内容: {r['snippet']}\n\n" for i, r in enumerate(results, 1))
        else:
            context.append(NO_SEARCH_RESULTS)
        leading = (SEARCH_GUIDANCE, "".join(context))

    def emit(text: str, thought: str):
        if thought:
            reasoning.append(thought)
            st().streams.publish(conv_id, "reasoning", thought)
        if text:
            content.append(text)
            st().streams.publish(conv_id, "token", text)

    if runtime and runtime.response_mode == "non_stream":
        text, thought = st().ai.non_stream(history, mode, prompt, runtime, leading)
        emit(text, thought)
    else:
        st().ai.stream(history, mode, prompt, runtime, emit, leading)
    return search_data


def _process_chat(user_id: str, body: dict, user_message: dict, assistant: dict, temporary: bool):
    cid, mode = body["conversation_id"], body["mode"]
    stream = st().streams
    try:
        history = st().temp.branch(cid, user_message["id"]) if temporary else st().conversations.branch(cid, user_message["id"])
        if mode == "hermes":
            _process_hermes(user_id, body, user_message, assistant, history)
            return
        if mode == "daily":
            history = _cleanup_history(history)
        multimodal = any("<file" in m.get("content", "") or "<image" in m.get("content", "") for m in history)
        effective = mode
        if mode == "daily" and not multimodal:
            source = _search_needed(history)
            if source:
                effective = "search_" + source
        with st().db.session() as s:
            user = s.get(User, user_id)
            prompt = _system_prompt(user, body.get("location", ""))
            credits = float(user.credits)
        runtime = _custom(user_id, effective, multimodal)
        if not runtime and credits <= 0:
            stream.publish(cid, "error", "Insufficient credits")
            return
        stream.publish(cid, "generation_mode", runtime.response_mode if runtime else "stream")
        search_enabled = not (multimodal and st().ai.runtime("multimodal").api_key)
        content: list[str] = []
        reasoning: list[str] = []
        try:
            search = _emit_model(cid, history, effective, prompt, runtime, content, reasoning, search_enabled)
            used_custom = runtime is not None
        except Exception as exc:
            if runtime and not reasoning and not any("<search>" not in c for c in content):
                content.clear()
                with st().db.session() as s:
                    latest = s.get(User, user_id)
                    can_fallback = latest and latest.credits > 0
                if can_fallback:
                    stream.publish(cid, "fallback", "自定义模型不可用，已回退到项目模型并将正常扣费")
                    stream.publish(cid, "generation_mode", "stream")
                    search = _emit_model(cid, history, effective, prompt, None, content, reasoning, search_enabled)
                    used_custom = False
                else:
                    raise RuntimeError(f"自定义模型调用失败且项目额度不足: {exc}") from exc
            else:
                raise
        assistant.update({"content": "".join(content), "reasoning": "".join(reasoning), "search": search})
        if temporary:
            st().temp.update(assistant)
        else:
            st().conversations.update_message(assistant)
        if not used_custom:
            credits = deduct(st().db, user_id, count_tokens(user_message["content"]), count_tokens(assistant["content"]))
        if not temporary:
            try:
                title = st().conversations.auto_title(user_id, cid)
                if title:
                    stream.publish(cid, "title", title)
            except Exception:
                pass
        stream.publish(cid, "done", data={"user_message_id": user_message["id"], "assistant_message_id": assistant["id"], "credits": credits})
    except Exception as exc:
        stream.publish(cid, "error", str(exc))
    finally:
        stream.close(cid)


HERMES_DETAIL_LIMIT = 32768
_REDACTED_KEYS = ("authorization", "api_key", "apikey")


def _clip(value: str) -> str:
    return value[:HERMES_DETAIL_LIMIT] + "\n…[truncated]" if len(value) > HERMES_DETAIL_LIMIT else value


def _scrub(value):
    if isinstance(value, dict):
        for key in list(value):
            lowered = key.lower()
            if any(marker in lowered for marker in _REDACTED_KEYS) or lowered == "key":
                value[key] = "[REDACTED]"
            else:
                value[key] = _scrub(value[key])
        return value
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _hermes_step(raw: dict, seq: int) -> dict:
    typ = str(raw.get("type", ""))
    status = "completed" if typ.endswith(".done") or typ == "response.completed" else "running"
    if "failed" in typ or "error" in typ:
        status = "failed"
    title = typ
    item = raw.get("item") if isinstance(raw.get("item"), dict) else {}
    if item.get("type"):
        title = str(item["type"])
    if item.get("name"):
        title = str(item["name"])
    summary = ""
    for key in ("name", "text", "delta", "message"):
        value = raw.get(key)
        if isinstance(value, str) and value:
            summary = _clip(value)
            break
    scoped = _scrub(dict(raw))
    ident = next((raw[key] for key in ("item_id", "id", "call_id") if isinstance(raw.get(key), str) and raw[key]), f"{typ}-{seq}")
    return {"id": ident, "type": typ, "title": title, "status": status, "started_at": now(), "summary": summary, "details": _clip(json.dumps(scoped, ensure_ascii=False, default=str)), "raw": scoped}


def _hermes_failure(exc: Exception, previous: str) -> tuple[str, bool]:
    status = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    body = (getattr(response, "text", "") or "").strip() if response is not None else ""
    if status:
        lowered = body.lower()
        invalid = bool(previous) and status in (400, 404) and any(marker in lowered for marker in ("previous_response", "not found", "expired"))
        return f"Hermes HTTP {status}: {body}", invalid
    return str(exc), False


def _process_hermes(user_id: str, body: dict, user_message: dict, assistant: dict, history: list[dict]):
    cid = body["conversation_id"]
    stream = st().streams
    configured = _hermes(user_id)
    if not configured:
        stream.publish(cid, "error", "Hermes 配置不可用")
        return
    rt, version = configured
    previous = next((m.get("hermes_response_id", "") for m in reversed(history) if m.get("role") == "assistant" and m.get("mode") == "hermes" and m.get("hermes_response_completed") and m.get("hermes_response_id") and m.get("hermes_context_version") == version), "")
    full_history = history
    if previous:
        history = [{"role": "user", "content": body["message"]}]
    stream.publish(cid, "hermes_context", "continued" if previous else "new")
    content: list[str] = []
    trace: list[dict] = []
    state = {"response_id": "", "completed": False, "received": False, "seq": 0}

    def on_context(value: str):
        assistant["hermes_response_id"] = value
        assistant["hermes_context_version"] = version
        assistant["hermes_response_completed"] = False
        st().conversations.update_message(assistant)

    def on_step(step: dict):
        for index, existing in enumerate(trace):
            if existing["id"] == step["id"]:
                if step["type"].endswith(".delta"):
                    step["summary"] = existing.get("summary", "") + step["summary"]
                trace[index] = step
                break
        else:
            trace.append(step)
        assistant["hermes_trace"] = list(trace)
        assistant["mode"] = "hermes"
        st().conversations.update_message(assistant)
        stream.publish(cid, "hermes_event", data=step)

    def run(messages: list[dict], previous_id: str):
        model = HermesResponsesModel(model=rt.model, base_url=rt.base_url, api_key=rt.api_key, previous_response_id=previous_id)
        for chunk in model.stream(st().ai.messages(messages)):
            raw = chunk.additional_kwargs.get("hermes_event", {})
            typ = str(raw.get("type", ""))
            state["received"] = True
            old_id = state["response_id"]
            response = raw.get("response") if isinstance(raw.get("response"), dict) else {}
            if response.get("id"):
                state["response_id"] = str(response["id"])
            if raw.get("response_id"):
                state["response_id"] = str(raw["response_id"])
            if state["response_id"] and state["response_id"] != old_id:
                on_context(state["response_id"])
            state["seq"] += 1
            if typ == "response.output_text.delta":
                text = chunk.content if isinstance(chunk.content, str) else ""
                content.append(text)
                stream.publish(cid, "token", text)
            else:
                on_step(_hermes_step(raw, state["seq"]))
            if typ == "response.completed":
                state["completed"] = True

    error = ""
    try:
        run(history, previous)
    except Exception as exc:
        error, invalid = _hermes_failure(exc, previous)
        if invalid and not state["received"]:
            stream.publish(cid, "hermes_context", "rebuilt")
            try:
                run(full_history, "")
                error = ""
            except Exception as second:
                error, _ = _hermes_failure(second, "")
    assistant.update({
        "content": "".join(content),
        "hermes_trace": list(trace),
        "mode": "hermes",
        "hermes_context_version": version,
        "hermes_response_id": state["response_id"],
        "hermes_response_completed": state["completed"] and not error,
    })
    try:
        st().conversations.update_message(assistant)
    except Exception:
        stream.publish(cid, "error", "Failed to persist Hermes response")
        return
    if error:
        stream.publish(cid, "error", error)
        return
    conversation = st().conversations.get(user_id, cid)
    if conversation and not conversation["title"].strip():
        title = re.sub(r"\s+", " ", body["message"]).strip()
        if len(title) > 32:
            title = title[:32] + "…"
        if title:
            st().conversations.title(user_id, cid, title)
            stream.publish(cid, "title", title)
    with st().db.session() as s:
        credits = float(s.get(User, user_id).credits)
    stream.publish(cid, "done", data={"user_message_id": user_message["id"], "assistant_message_id": assistant["id"], "credits": credits, "hermes_response_id": state["response_id"], "hermes_context_version": version, "hermes_response_completed": assistant["hermes_response_completed"]})


@router.post("/api/chat")
def chat(body: dict, request: Request):
    user_id = uid(request)
    stt = st()
    rate_limit(request, stt.db, 10, "/api/chat", user_id)
    cid, message, mode = body.get("conversation_id", ""), body.get("message", ""), body.get("mode", "")
    if not cid or not message:
        fail(400, "conversation_id and message are required")
    if mode not in ("daily", "expert", "search", "hermes"):
        fail(400, "unsupported chat mode")
    temporary = is_temp(cid)
    with stt.db.session() as s:
        user = s.get(User, user_id)
        if not user:
            fail(500, "Failed to fetch user")
        if mode == "hermes":
            if temporary:
                fail(400, "Hermes 模式不支持临时会话")
            if any(tag in message for tag in ("<file", "<image", "<video")):
                fail(400, "Hermes 模式仅支持文本输入")
            if not _hermes(user_id):
                fail(400, "请先在设置中配置并测试 Hermes")
        else:
            reset_credits(stt.db, user)
        if mode != "hermes" and not _custom(user_id, mode, "<image" in message or "<file" in message) and user.credits <= 0:
            fail(403, "Insufficient credits", credits=float(user.credits))
    try:
        if temporary:
            if not stt.temp.get(cid):
                stt.temp.create(cid)
            user_message = stt.temp.save(cid, "user", message, body.get("parent_message_id") or "")
            assistant = stt.temp.save(cid, "assistant", "", user_message["id"])
        else:
            user_message = stt.conversations.save(user_id, cid, "user", message, body.get("parent_message_id") or "")
            assistant = stt.conversations.save(user_id, cid, "assistant", "", user_message["id"])
            user_message["mode"] = assistant["mode"] = mode
            stt.conversations.update_message(user_message)
            stt.conversations.update_message(assistant)
    except Exception:
        fail(500, "Failed to save temporary user message" if temporary else "Failed to save user message")
    stt.streams.start(cid)
    threading.Thread(target=_process_chat, args=(user_id, body, user_message, assistant, temporary), daemon=True).start()
    return {"user_message_id": user_message["id"], "assistant_message_id": assistant["id"]}


@router.get("/api/chat/stream")
def stream(request: Request, conversation_id: str = ""):
    user_id = uid(request)
    rate_limit(request, st().db, 10, "/api/chat/stream", user_id)
    if not conversation_id:
        fail(400, "conversation_id is required")
    return StreamingResponse(st().streams.subscribe(conversation_id), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive"})


@router.post("/api/chat/image")
def generate_image(body: dict, request: Request):
    user_id = uid(request)
    rate_limit(request, st().db, 10, "/api/chat/image", user_id)
    cid, prompt = body.get("conversation_id", ""), body.get("prompt", "")
    if not cid or not prompt:
        fail(400, "Invalid request")
    with st().db.session() as s:
        user = s.get(User, user_id)
        if not user:
            fail(500, "Failed to fetch user")
        reset_credits(st().db, user)
        if user.credits <= 0:
            fail(403, "Insufficient credits", credits=float(user.credits))
    ref = body.get("ref_image_url", "")
    if not ref:
        branch: list[dict] = []
        try:
            if body.get("parent_message_id"):
                branch = st().conversations.branch(cid, body["parent_message_id"])
            else:
                conversation = st().conversations.get(user_id, cid)
                branch = conversation["messages"] if conversation else []
        except Exception:
            branch = []
        if branch and branch[-1]["role"] == "assistant":
            match = re.search(r'<image src="([^"]+)">', branch[-1]["content"])
            if match:
                ref = match.group(1)
    content = f'<image src="{ref}">\n{prompt}' if body.get("ref_image_url") else prompt
    user_message = st().conversations.save(user_id, cid, "user", content, body.get("parent_message_id") or "")
    assistant = st().conversations.save(user_id, cid, "assistant", "", user_message["id"])
    st().streams.start(cid)

    def work():
        try:
            st().streams.publish(cid, "image_gen_start", body.get("resolution") or "2048x2048")
            image = st().ai.image(prompt, body.get("resolution", ""), ref)
            url = COS(st().cfg).upload(image, "image.png", "images")
            tag = f'<image src="{url}">'
            assistant["content"] = tag
            st().conversations.update_message(assistant)
            st().streams.publish(cid, "token", tag)
            try:
                title = st().conversations.auto_title(user_id, cid)
                if title:
                    st().streams.publish(cid, "title", title)
            except Exception:
                pass
            credits = deduct(st().db, user_id, flat=50)
            st().streams.publish(cid, "done", data={"user_message_id": user_message["id"], "assistant_message_id": assistant["id"], "credits": credits})
        except Exception as exc:
            st().streams.publish(cid, "error", str(exc))
        finally:
            st().streams.close(cid)

    threading.Thread(target=work, daemon=True).start()
    return {"user_message_id": user_message["id"], "assistant_message_id": assistant["id"]}


@router.post("/api/cos/presign")
def cos_presign(body: dict, request: Request):
    uid(request)
    if not all(body.get(k) for k in ("filename", "folder", "mime_type")):
        fail(400, "Invalid request")
    if body["folder"] not in ("avatars", "reference_files", "images"):
        fail(400, "Invalid folder name")
    signed, final = COS(st().cfg).presign(body["folder"], body["filename"], body["mime_type"])
    return {"upload_url": signed, "url": final}


@router.delete("/api/chat/reference-image")
def delete_reference(body: dict, request: Request):
    uid(request)
    match = re.match(r"https?://[^/]+/(.+)", body.get("url", ""))
    if not match:
        fail(400, "Invalid image URL")
    COS(st().cfg).delete(match.group(1))
    return {"message": "Image deleted successfully"}


@router.post("/api/chat/upload-reference")
async def upload_reference(request: Request):
    uid(request)
    form = await request.form()
    files = form.getlist("file") or form.getlist("image")
    if not files:
        fail(400, "No file provided")
    if len(files) > 5:
        fail(400, "Too many files. Maximum 5 files allowed")
    upload = files[0]
    data = await upload.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        fail(400, "File size exceeds 15MB limit")
    if not (data.startswith((b"\xff\xd8", b"\x89PNG", b"GIF8", b"RIFF", b"BM", b"\x00\x00\x00"))):
        fail(400, "Invalid file type. Only common image and video formats are allowed")
    return {"url": COS(st().cfg).upload(data, upload.filename or "file", "reference_files")}
