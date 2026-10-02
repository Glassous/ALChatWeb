from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch
from langchain_tavily._utilities import TavilySearchAPIWrapper
from openai import OpenAI
from pydantic import Field, SecretStr

from .config import Settings
from .core import count_tokens, validate_public_url
from .media import COS, MAX_IMAGE_BYTES, MEDIA_TAG, attachment_type, attachment_text, image_file_metadata


def _wire_messages(messages: list[BaseMessage]) -> list[dict]:
    roles = {HumanMessage: "user", SystemMessage: "system", AIMessage: "assistant"}
    return [{"role": next((v for k, v in roles.items() if isinstance(m, k)), "user"), "content": m.content} for m in messages]


def _extra(value: Any) -> dict:
    return value.model_dump(exclude_none=True) if hasattr(value, "model_dump") else dict(value)


def _reasoning_content(payload: dict, final: bool) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    node = choices[0].get("message" if final else "delta") or {}
    return node.get("reasoning_content") or ""


class ReasoningChatOpenAI(ChatOpenAI):
    """ChatOpenAI that keeps provider-specific thinking/reasoning_content fields.

    LangChain's generic conversion drops unknown delta keys, while the legacy
    service streamed `reasoning_content` for project models. Only that extra
    provider field is preserved; requests still use the standard ChatOpenAI API.
    """

    def _convert_chunk_to_generation_chunk(self, chunk, default_chunk_class, base_generation_info):
        generation = super()._convert_chunk_to_generation_chunk(chunk, default_chunk_class, base_generation_info)
        if generation is not None and (reasoning := _reasoning_content(chunk, final=False)):
            generation.message.additional_kwargs["reasoning_content"] = reasoning
        return generation

    def _create_chat_result(self, response, generation_info=None):
        result = super()._create_chat_result(response, generation_info)
        payload = response if isinstance(response, dict) else response.model_dump()
        if (reasoning := _reasoning_content(payload, final=True)) and result.generations:
            result.generations[0].message.additional_kwargs["reasoning_content"] = reasoning
        return result


class CompatibleChatModel(BaseChatModel):
    """LangChain model for provider-specific thinking and reasoning_content."""

    model: str
    base_url: str
    api_key: str = Field(repr=False)
    thinking: bool = False
    safe_url: bool = False
    timeout: float = 240

    @property
    def _llm_type(self) -> str:
        return "alchat-compatible-chat"

    def _client(self) -> OpenAI:
        if self.safe_url:
            validate_public_url(self.base_url)
        return OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout, max_retries=0)

    def _kwargs(self, messages: list[BaseMessage]) -> dict:
        kwargs = {"model": self.model, "messages": _wire_messages(messages)}
        if not self.thinking:
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        return kwargs

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> ChatResult:
        response = self._client().chat.completions.create(**self._kwargs(messages), stream=False)
        if not response.choices:
            raise ValueError("AI API returned no choices")
        message = response.choices[0].message
        reasoning = (message.model_extra or {}).get("reasoning_content", "")
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=message.content or "", additional_kwargs={"reasoning_content": reasoning}))])

    def _stream(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> Iterator[ChatGenerationChunk]:
        stream = self._client().chat.completions.create(**self._kwargs(messages), stream=True)
        for piece in stream:
            if not piece.choices:
                continue
            delta = piece.choices[0].delta
            reasoning = (delta.model_extra or {}).get("reasoning_content", "")
            content = delta.content or ""
            if content or reasoning:
                chunk = AIMessageChunk(content=content, additional_kwargs={"reasoning_content": reasoning})
                if run_manager:
                    run_manager.on_llm_new_token(content)
                yield ChatGenerationChunk(message=chunk)


class HermesResponsesModel(BaseChatModel):
    model: str
    base_url: str
    api_key: str = Field(repr=False)
    previous_response_id: str = ""

    @property
    def _llm_type(self) -> str:
        return "alchat-hermes-responses"

    def _client(self) -> OpenAI:
        url = validate_public_url(self.base_url)
        if url.endswith("/responses"):
            url = url.removesuffix("/responses")
        elif not url.endswith("/v1"):
            url += "/v1"
        return OpenAI(api_key=self.api_key, base_url=url, timeout=600, max_retries=0)

    def _stream(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> Iterator[ChatGenerationChunk]:
        args = {"model": self.model, "input": _wire_messages(messages), "stream": True, "store": True}
        if self.previous_response_id:
            args["previous_response_id"] = self.previous_response_id
        completed = False
        for event in self._client().responses.create(**args):
            raw = _extra(event)
            typ = raw.get("type", "")
            if typ == "response.completed":
                completed = True
            if typ in ("response.failed", "error"):
                raise RuntimeError("Hermes response failed")
            text = raw.get("delta", "") if typ == "response.output_text.delta" else ""
            yield ChatGenerationChunk(message=AIMessageChunk(content=text, additional_kwargs={"hermes_event": raw}))
        if not completed:
            raise RuntimeError("Hermes stream ended before response.completed")

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> ChatResult:
        chunks = list(self._stream(messages))
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="".join(str(c.message.content) for c in chunks)))])


class BochaSearchTool(BaseTool):
    name: str = "bocha_search"
    description: str = "Search Chinese web pages"
    api_key: str = Field(repr=False)
    timeout: float = 30

    def _run(self, query: str, count: int = 10) -> list[dict]:
        response = httpx.post("https://api.bochaai.com/v1/web-search", headers={"Authorization": f"Bearer {self.api_key}"}, json={"query": query, "count": count}, timeout=self.timeout)
        response.raise_for_status()
        return [{"title": v.get("name", ""), "url": v.get("url", ""), "snippet": v.get("snippet", ""), "site_name": v.get("siteName", ""), "site_icon": v.get("siteIcon", ""), "date_published": v.get("datePublished", "")} for v in response.json().get("data", {}).get("webPages", {}).get("value", [])]


class OpenAIImagesTool:
    def __init__(self, cfg: Settings):
        self.cfg = cfg

    def generate(self, prompt: str, size: str = "", reference: str = "") -> bytes:
        if not self.cfg.OPENAI_IMAGES_API_KEY or not self.cfg.OPENAI_IMAGES_MODEL:
            raise RuntimeError("OpenAI Images API key and model must be configured")
        if self.cfg.OPENAI_IMAGES_PROTOCOL == "openrouter":
            data = self._generate_openrouter(prompt, size, reference)
        else:
            client = OpenAI(
                api_key=self.cfg.OPENAI_IMAGES_API_KEY,
                base_url=self.cfg.OPENAI_IMAGES_BASE_URL,
                timeout=300,
                max_retries=0,
            )
            args = {"model": self.cfg.OPENAI_IMAGES_MODEL, "prompt": prompt, "extra_body": {"watermark": False}}
            if size:
                args["size"] = size
            if reference:
                image = COS(self.cfg).download_image(reference)
                filename, mime = image_file_metadata(image)
                response = client.images.edit(image=(filename, image, mime), **args)
            else:
                response = client.images.generate(**args)
            data = response.data
        if not data:
            raise RuntimeError("No image returned from Images API")
        first = data[0]
        b64_json = first.get("b64_json") if isinstance(first, dict) else first.b64_json
        url = first.get("url") if isinstance(first, dict) else first.url
        if b64_json:
            try:
                content = base64.b64decode(b64_json, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise RuntimeError("Images API returned invalid base64 image data") from exc
        elif url:
            content = self._download_result(url)
        else:
            raise RuntimeError("Images API returned neither image data nor a URL")
        image_file_metadata(content)
        return content

    def _generate_openrouter(self, prompt: str, size: str, reference: str) -> list[dict]:
        payload: dict[str, Any] = {"model": self.cfg.OPENAI_IMAGES_MODEL, "prompt": prompt}
        if size:
            payload["size"] = size
        if reference:
            image = COS(self.cfg).download_image(reference)
            _, mime = image_file_metadata(image)
            encoded = base64.b64encode(image).decode("ascii")
            payload["input_references"] = [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}]
        response = httpx.post(
            f"{self.cfg.OPENAI_IMAGES_BASE_URL.rstrip('/')}/images",
            headers={"Authorization": f"Bearer {self.cfg.OPENAI_IMAGES_API_KEY}"},
            json=payload,
            timeout=300,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            try:
                error = response.json().get("error", {})
                detail = error.get("message", "") if isinstance(error, dict) else ""
            except (ValueError, AttributeError):
                detail = ""
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"OpenRouter Images API error ({response.status_code}){suffix}") from exc
        result = response.json()
        if not isinstance(result, dict) or not isinstance(result.get("data"), list):
            raise RuntimeError("OpenRouter Images API returned an invalid response")
        return result["data"]

    @staticmethod
    def _download_result(url: str) -> bytes:
        validate_public_url(url)
        with httpx.stream("GET", url, follow_redirects=False, timeout=60) as response:
            response.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > MAX_IMAGE_BYTES:
                    raise ValueError("Images API image exceeds the 50MB limit")
                chunks.append(chunk)
        return b"".join(chunks)


SEARCH_GUIDANCE = (
    "你是一个具备联网搜索能力的助手。请根据提供的搜索结果回答用户的问题。\n\n"
    "**引用要求**：\n"
    "1. 当你引用搜索结果中的信息时，必须在对应的语句末尾使用 `ref(n)` 格式进行标注，其中 n 是搜索结果的序号（从 1 开始）。\n"
    "2. 例如：根据某项研究表明，地球是圆的 ref(1)。\n"
    "3. 如果一条语句引用了多个来源，请使用多个标注，如：ref(1) ref(2)。\n"
    "4. 如果搜索结果不相关，请根据你的知识储备回答，并告知用户搜索结果可能不完全匹配。"
)
NO_SEARCH_RESULTS = "未找到相关搜索结果。\n"


@dataclass
class Runtime:
    api_key: str
    base_url: str
    model: str
    response_mode: str = "stream"


class AIService:
    def __init__(self, cfg: Settings):
        self.cfg = cfg
        self.overrides: dict[str, Runtime] = {}

    def configure(self, mode: str, api_key: str, base_url: str, model: str) -> None:
        old = self.runtime(mode)
        self.overrides[mode] = Runtime(api_key or old.api_key, base_url or old.base_url, model or old.model)

    def runtime(self, mode: str) -> Runtime:
        defaults = {
            "daily": (self.cfg.OPENAI_API_KEY, self.cfg.OPENAI_BASE_URL, self.cfg.OPENAI_MODEL),
            "expert": (self.cfg.EXPERT_API_KEY, self.cfg.EXPERT_BASE_URL, self.cfg.EXPERT_MODEL),
            "search": (self.cfg.SEARCH_API_KEY, self.cfg.SEARCH_BASE_URL, self.cfg.SEARCH_MODEL),
            "title": (self.cfg.TITLE_AI_API_KEY, self.cfg.TITLE_AI_BASE_URL, self.cfg.TITLE_AI_MODEL),
            "multimodal": (self.cfg.MULTIMODAL_API_KEY, self.cfg.MULTIMODAL_BASE_URL, self.cfg.MULTIMODAL_MODEL),
            "aling": (self.cfg.ALING_API_KEY, self.cfg.ALING_BASE_URL, self.cfg.ALING_MODEL),
        }
        return self.overrides.get(mode) or Runtime(*defaults[mode])

    def model_for(self, mode: str, runtime: Runtime | None = None, timeout: float = 240):
        rt = runtime or self.runtime(mode)
        if runtime is not None:
            # User supplied endpoints need the request-scoped adapter with SSRF checks.
            return CompatibleChatModel(model=rt.model, base_url=rt.base_url, api_key=rt.api_key, thinking=mode == "expert", safe_url=True, timeout=timeout)
        options: dict[str, Any] = {"model": rt.model, "api_key": rt.api_key or "not-configured", "max_retries": 0, "timeout": timeout}
        if rt.base_url:
            options["base_url"] = rt.base_url
        if mode != "expert":
            # Project providers expect the legacy thinking switch; "expert" enables thinking.
            options["extra_body"] = {"thinking": {"type": "disabled"}}
        return ReasoningChatOpenAI(**options)

    def has_multimodal(self, history: list[dict], system_prompt: str = "") -> bool:
        if system_prompt and ("<file" in system_prompt or "<image" in system_prompt):
            return True
        return any("<file" in m.get("content", "") or "<image" in m.get("content", "") for m in history)

    def _external_url(self, url: str) -> str:
        cfg = self.cfg
        if cfg.COS_CUSTOM_DOMAIN and cfg.COS_BUCKET and cfg.COS_REGION:
            domain = cfg.COS_CUSTOM_DOMAIN.removeprefix("https://").rstrip("/")
            return url.replace(domain, f"{cfg.COS_BUCKET}.cos.{cfg.COS_REGION}.myqcloud.com")
        return url

    def _blocks(self, content: str, multimodal: bool = True) -> list[dict]:
        matches = list(MEDIA_TAG.finditer(content))
        if not matches:
            return [{"type": "text", "text": content}] if content else []
        blocks: list[dict] = []
        last = 0
        for match in matches:
            if match.start() > last:
                blocks.append({"type": "text", "text": content[last:match.start()]})
            url, tag = match.group(2), match.group(1)
            mime = ""
            if all((self.cfg.COS_SECRET_ID, self.cfg.COS_SECRET_KEY, self.cfg.COS_BUCKET, self.cfg.COS_REGION)):
                try:
                    mime = COS(self.cfg).metadata(url)["mime_type"]
                except Exception:
                    pass
            kind = attachment_type(url, tag, mime)
            blocks.append({"type": "text", "text": attachment_text(url, kind)})
            if multimodal and kind == "image":
                blocks.append({"type": "image_url", "image_url": {"url": self._external_url(url)}})
            last = match.end()
        if content[last:]:
            blocks.append({"type": "text", "text": content[last:]})
        return blocks

    def messages(self, history: list[dict], system_prompt: str = "", multimodal: bool = False, leading: tuple[str, ...] = ()) -> list[BaseMessage]:
        output: list[BaseMessage] = [SystemMessage(content=text) for text in leading]
        if system_prompt:
            output.append(SystemMessage(content=system_prompt))
        for m in history:
            content: Any = m.get("content", "")
            if multimodal or MEDIA_TAG.search(content):
                blocks = self._blocks(content, multimodal)
                content = blocks if multimodal else "".join(block["text"] for block in blocks)
            cls = {"system": SystemMessage, "assistant": AIMessage}.get(m.get("role"), HumanMessage)
            output.append(cls(content=content))
        return output

    def stream(self, history: list[dict], mode: str, system_prompt: str, runtime: Runtime | None, emit: Callable[[str, str], None], leading: tuple[str, ...] = ()) -> None:
        multimodal = self.has_multimodal(history, system_prompt)
        use_multimodal = multimodal and bool(self.runtime("multimodal").api_key)
        model = self.model_for("multimodal" if use_multimodal else mode, None if use_multimodal else runtime)
        for chunk in model.stream(self.messages(history, system_prompt, use_multimodal, leading)):
            text = chunk.content if isinstance(chunk.content, str) else ""
            if isinstance(chunk.content, list):
                text = "".join(part.get("text", "") for part in chunk.content if isinstance(part, dict))
            emit(text, chunk.additional_kwargs.get("reasoning_content", ""))

    def non_stream(self, history: list[dict], mode: str, system_prompt: str, runtime: Runtime | None, leading: tuple[str, ...] = (), timeout: float = 240) -> tuple[str, str]:
        result = self.model_for(mode, runtime, timeout).invoke(self.messages(history, system_prompt, False, leading))
        text = result.content if isinstance(result.content, str) else ""
        return text, result.additional_kwargs.get("reasoning_content", "")

    def complete(self, history: list[dict], mode: str) -> str:
        result = self.model_for(mode).invoke(self.messages(history))
        return result.content if isinstance(result.content, str) else ""

    def title(self, history: list[dict], timeout: float = 240) -> str:
        prompt = "Please generate a short, concise title for this conversation based on the above messages. The title should be in the same language as the conversation and should not exceed 10 words. Only output the title itself, no quotes or extra text."
        result = self.model_for("title", timeout=timeout).invoke(self.messages(history + [{"role": "user", "content": prompt}]))
        return (result.content if isinstance(result.content, str) else "").strip()

    def keywords(self, history: list[dict], runtime: Runtime | None = None) -> str:
        prompt = "你是一个搜索专家。根据提供的对话历史，总结出 1-3 个最适合用于联网搜索的联网搜索关键词或短语。要求：1. 关键词应简洁、准确；2. 只输出关键词，用空格分隔；3. 不要包含任何解释或标点符号。"
        model = self.model_for("search", runtime)
        result = model.invoke(self.messages(history[-5:], prompt))
        return (result.content if isinstance(result.content, str) else "").strip() or history[-1]["content"]

    @staticmethod
    def result_view(title: str, url: str, snippet: str, site_name: str = "", site_icon: str = "", date_published: str = "") -> dict:
        # The legacy SearchResult struct omitted empty optional fields.
        item = {"title": title, "url": url, "snippet": snippet}
        for key, value in (("site_name", site_name), ("site_icon", site_icon), ("date_published", date_published)):
            if value:
                item[key] = value
        return item

    def search(self, query: str, source: str, timeout: float | None = None) -> list[dict]:
        if source == "tavily":
            if timeout is not None:
                # The existing Tavily adapter has no HTTP timeout. Agent calls use
                # the same search API with a request-scoped bounded transport.
                response = httpx.post("https://api.tavily.com/search", headers={"Authorization": f"Bearer {self.cfg.TAVILY_API_KEY}"}, json={"query": query, "max_results": 10, "search_depth": "basic", "include_images": False, "include_favicon": True}, timeout=timeout)
                response.raise_for_status()
                result = response.json()
            else:
                result = TavilySearch(max_results=10, search_depth="basic", include_images=False, include_favicon=True, api_wrapper=TavilySearchAPIWrapper(tavily_api_key=SecretStr(self.cfg.TAVILY_API_KEY))).invoke({"query": query})
            return [self.result_view(x.get("title", ""), x.get("url", ""), x.get("content", ""), (urlparse(x.get("url", "")).hostname or "").removeprefix("www."), x.get("favicon", ""), x.get("published_date", "")) for x in result.get("results", [])]
        entries = BochaSearchTool(api_key=self.cfg.BOCHA_API_KEY, timeout=timeout or 30).invoke({"query": query, "count": 10})
        return [self.result_view(v.get("title", ""), v.get("url", ""), v.get("snippet", ""), v.get("site_name", ""), v.get("site_icon", ""), v.get("date_published", "")) for v in entries]

    def image(self, prompt: str, size: str, reference: str) -> bytes:
        return OpenAIImagesTool(self.cfg).generate(prompt, size, reference)
