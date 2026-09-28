"""OpenAI Images protocol and COS reference handling without external services."""
from __future__ import annotations

import base64
import io
from types import SimpleNamespace

import pytest
import httpx
from openai import OpenAI as SDKOpenAI

import app.ai as ai
import app.media as media
from app.config import Settings


PNG = b"\x89PNG\r\n\x1a\nimage"
JPEG = b"\xff\xd8\xffimage"
WEBP = b"RIFF\x0c\x00\x00\x00WEBPimage"


def image_response(content: bytes | None = PNG, url: str | None = None):
    data = [] if content is None and url is None else [SimpleNamespace(b64_json=base64.b64encode(content).decode() if content is not None else None, url=url)]
    return SimpleNamespace(data=data)


def image_settings() -> Settings:
    return Settings(
        _env_file=None,
        OPENAI_IMAGES_API_KEY="images-key",
        OPENAI_IMAGES_BASE_URL="https://images.example.com/v1",
        OPENAI_IMAGES_MODEL="image-model",
        COS_SECRET_ID="id",
        COS_SECRET_KEY="secret",
        COS_BUCKET="bucket",
        COS_REGION="ap-beijing",
        COS_CUSTOM_DOMAIN="cdn.example.com",
    )


def openrouter_settings() -> Settings:
    return image_settings().model_copy(update={
        "OPENAI_IMAGES_PROTOCOL": "openrouter",
        "OPENAI_IMAGES_BASE_URL": "https://gateway.example.com/custom/v1/",
        "OPENAI_IMAGES_API_KEY": "gateway-key",
        "OPENAI_IMAGES_MODEL": "gateway-image-model",
    })


def test_protocol_can_be_selected_from_environment_with_custom_gateway(monkeypatch):
    monkeypatch.setenv("OPENAI_IMAGES_PROTOCOL", "openrouter")
    monkeypatch.setenv("OPENAI_IMAGES_BASE_URL", "https://gateway.example.com/custom/v1")
    monkeypatch.setenv("OPENAI_IMAGES_API_KEY", "gateway-key")
    monkeypatch.setenv("OPENAI_IMAGES_MODEL", "gateway-image-model")
    cfg = Settings(_env_file=None)
    assert cfg.OPENAI_IMAGES_PROTOCOL == "openrouter"
    assert cfg.OPENAI_IMAGES_BASE_URL == "https://gateway.example.com/custom/v1"
    assert cfg.OPENAI_IMAGES_API_KEY == "gateway-key"
    assert cfg.OPENAI_IMAGES_MODEL == "gateway-image-model"


def test_openrouter_generation_uses_dedicated_images_api(monkeypatch):
    requests = []

    def post(url, **kwargs):
        requests.append((url, kwargs))
        return httpx.Response(200, request=httpx.Request("POST", url), json={"data": [{"b64_json": base64.b64encode(PNG).decode(), "media_type": "image/png"}]})

    monkeypatch.setattr(ai.httpx, "post", post)
    assert ai.OpenAIImagesTool(openrouter_settings()).generate("画一只猫", "2560x1440") == PNG
    assert requests == [("https://gateway.example.com/custom/v1/images", {
        "headers": {"Authorization": "Bearer gateway-key"},
        "json": {"model": "gateway-image-model", "prompt": "画一只猫", "size": "2560x1440"},
        "timeout": 300,
    })]


def test_openrouter_reference_uses_cos_image_as_data_url(monkeypatch):
    payloads = []

    def post(url, **kwargs):
        payloads.append(kwargs["json"])
        return httpx.Response(200, request=httpx.Request("POST", url), json={"data": [{"b64_json": base64.b64encode(JPEG).decode()}]})

    monkeypatch.setattr(ai.httpx, "post", post)
    monkeypatch.setattr(ai, "COS", lambda cfg: SimpleNamespace(download_image=lambda url: WEBP))
    result = ai.OpenAIImagesTool(openrouter_settings()).generate("换成蓝色", "2048x2048", "https://cdn.example.com/reference_files/a.webp")
    assert result == JPEG
    assert payloads == [{
        "model": "gateway-image-model",
        "prompt": "换成蓝色",
        "size": "2048x2048",
        "input_references": [{"type": "image_url", "image_url": {"url": f"data:image/webp;base64,{base64.b64encode(WEBP).decode()}"}}],
    }]


@pytest.mark.parametrize("body", [{"data": []}, {"data": [{"media_type": "image/png"}]}, {"unexpected": 1}])
def test_openrouter_empty_image_response_fails(monkeypatch, body):
    def post(url, **kwargs):
        return httpx.Response(200, request=httpx.Request("POST", url), json=body)

    monkeypatch.setattr(ai.httpx, "post", post)
    with pytest.raises(RuntimeError, match="image|invalid response"):
        ai.OpenAIImagesTool(openrouter_settings()).generate("画一只猫")


def test_openrouter_provider_failure_fails(monkeypatch):
    def post(url, **kwargs):
        return httpx.Response(400, request=httpx.Request("POST", url), json={"error": {"message": "Unsupported size"}})

    monkeypatch.setattr(ai.httpx, "post", post)
    with pytest.raises(RuntimeError, match="OpenRouter Images API error \\(400\\): Unsupported size"):
        ai.OpenAIImagesTool(openrouter_settings()).generate("画一只猫", "2048x2048")


@pytest.mark.parametrize("size", ["2048x2048", "2304x1728", "1728x2304", "2560x1440", "1440x2560"])
def test_text_generation_uses_images_generations(monkeypatch, size):
    calls = []
    images = SimpleNamespace(
        generate=lambda **kwargs: calls.append(("generate", kwargs)) or image_response(),
        edit=lambda **kwargs: pytest.fail("edit should not be called"),
    )
    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SimpleNamespace(images=images))

    assert ai.OpenAIImagesTool(image_settings()).generate("画一只猫", size) == PNG
    assert calls == [("generate", {"model": "image-model", "prompt": "画一只猫", "size": size, "extra_body": {"watermark": False}})]


def test_reference_generation_uses_images_edits(monkeypatch):
    calls = []
    images = SimpleNamespace(
        generate=lambda **kwargs: pytest.fail("generate should not be called"),
        edit=lambda **kwargs: calls.append(kwargs) or image_response(JPEG),
    )
    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SimpleNamespace(images=images))
    monkeypatch.setattr(ai, "COS", lambda cfg: SimpleNamespace(download_image=lambda url: WEBP))

    result = ai.OpenAIImagesTool(image_settings()).generate("换成蓝色", "2048x2048", "https://cdn.example.com/reference_files/a.webp")
    assert result == JPEG
    assert calls == [{"image": ("image.webp", WEBP, "image/webp"), "model": "image-model", "prompt": "换成蓝色", "size": "2048x2048", "extra_body": {"watermark": False}}]


def test_openai_sdk_serializes_generation_and_edit_requests(monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"created": 1, "data": [{"b64_json": base64.b64encode(PNG).decode()}]})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SDKOpenAI(**kwargs, http_client=httpx.Client(transport=transport)))
    monkeypatch.setattr(ai, "COS", lambda cfg: SimpleNamespace(download_image=lambda url: PNG))
    tool = ai.OpenAIImagesTool(image_settings())

    assert tool.generate("画一只猫", "2048x2048") == PNG
    assert tool.generate("改成蓝色", "2048x2048", "https://cdn.example.com/reference_files/a.png") == PNG
    assert [request.url.path for request in requests] == ["/v1/images/generations", "/v1/images/edits"]
    assert [request.url.host for request in requests] == ["images.example.com", "images.example.com"]
    assert all(request.headers["Authorization"] == "Bearer images-key" for request in requests)
    assert b'"size":"2048x2048"' in requests[0].content
    assert b'"watermark":false' in requests[0].content
    assert b'name="image"' in requests[1].content
    assert b'name="watermark"' in requests[1].content
    assert b"false" in requests[1].content
    assert b"image.png" in requests[1].content
    assert PNG in requests[1].content


def test_url_response_is_downloaded_and_format_is_detected(monkeypatch):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def raise_for_status(self):
            return None

        def iter_bytes(self):
            yield WEBP

    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SimpleNamespace(images=SimpleNamespace(generate=lambda **args: image_response(None, "https://images.example.com/result"))))
    monkeypatch.setattr(ai, "validate_public_url", lambda url: url)
    monkeypatch.setattr(ai.httpx, "stream", lambda method, url, **kwargs: Response())

    assert ai.OpenAIImagesTool(image_settings()).generate("画一只猫") == WEBP
    assert media.image_file_metadata(WEBP) == ("image.webp", "image/webp")


@pytest.mark.parametrize("response", [image_response(None), SimpleNamespace(data=[SimpleNamespace(b64_json=None, url=None)])])
def test_empty_image_response_fails(monkeypatch, response):
    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SimpleNamespace(images=SimpleNamespace(generate=lambda **args: response)))
    with pytest.raises(RuntimeError, match="image"):
        ai.OpenAIImagesTool(image_settings()).generate("画一只猫")


def test_provider_failure_and_missing_config(monkeypatch):
    def fail(**kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(ai, "OpenAI", lambda **kwargs: SimpleNamespace(images=SimpleNamespace(generate=fail)))
    with pytest.raises(RuntimeError, match="provider unavailable"):
        ai.OpenAIImagesTool(image_settings()).generate("画一只猫")
    with pytest.raises(RuntimeError, match="must be configured"):
        ai.OpenAIImagesTool(Settings(_env_file=None)).generate("画一只猫")


def test_cos_reference_is_read_from_own_bucket():
    calls = []
    bucket = media.COS.__new__(media.COS)
    bucket.cfg = image_settings()
    bucket.client = SimpleNamespace(get_object=lambda **kwargs: calls.append(kwargs) or {"Body": SimpleNamespace(get_raw_stream=lambda: io.BytesIO(PNG))})

    assert bucket.download_image("https://cdn.example.com/reference_files/a.png") == PNG
    assert bucket.download_image("https://bucket.cos.ap-beijing.myqcloud.com/images/b.png") == PNG
    assert calls == [{"Bucket": "bucket", "Key": "reference_files/a.png"}, {"Bucket": "bucket", "Key": "images/b.png"}]
    with pytest.raises(ValueError, match="COS bucket"):
        bucket.download_image("https://other.example.com/reference_files/a.png")
    assert len(calls) == 2


def test_cos_upload_sets_image_content_type():
    calls = []
    bucket = media.COS.__new__(media.COS)
    bucket.cfg = image_settings()
    bucket.client = SimpleNamespace(put_object=lambda **kwargs: calls.append(kwargs))

    url = bucket.upload(JPEG, "image.jpg", "images")
    assert url.startswith("https://cdn.example.com/images/") and url.endswith(".jpg")
    assert calls[0]["ContentType"] == "image/jpeg"
    assert calls[0]["Body"].read() == JPEG
