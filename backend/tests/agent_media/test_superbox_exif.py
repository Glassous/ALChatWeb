"""EXIF discovery, multipart adaptation, binary delivery and bounded transport."""
import json
from types import SimpleNamespace

import httpx
import pytest

from app.superbox import Superbox, EXIF_INPUT_LIMIT, EXIF_OUTPUT_LIMIT, Unsupported

URL = "https://cdn.example.com/reference_files/photo.png"
IMAGES = [(b"\x89PNG\r\n\x1a\nimage", "image/png"), (b"\xff\xd8\xffimage", "image/jpeg"), (b"RIFF1234WEBPimage", "image/webp")]


@pytest.fixture()
def provider(monkeypatch):
    superbox = Superbox("https://superbox.example/api/v1")
    endpoints = [{"method": "POST", "path": path, "name": path} for path in ("/exif/inspect", "/exif/edit")]
    endpoints.append({"method": "GET", "path": "/exif/tags", "name": "tags"})
    paths = {}
    for endpoint in endpoints:
        path, method = endpoint["path"], endpoint["method"].lower()
        operation = {"operationId": path.replace("/", "_"), "responses": {"200": {"content": {"application/json": {"schema": {}}}}}}
        if method == "post":
            fields = {"image": {"type": "string"}, "image_url": {"type": "string"}}
            if path.endswith("edit"):
                fields["changes"] = {"type": "string"}
                operation["responses"]["200"]["content"].update({mime: {} for _, mime in IMAGES})
            operation["requestBody"] = {"content": {"multipart/form-data": {"schema": {"type": "object", "properties": fields}}}}
        else:
            operation["parameters"] = [{"name": "q", "in": "query", "schema": {"type": "string"}}]
        paths["/api/v1" + path] = {method: operation}
    documents = {"/skill": "EXIF", "/skill.json": {"endpoints": endpoints}, "/openapi.json": {"paths": paths}}
    calls = []
    def request(method, path, timeout, **kwargs):
        calls.append((method, path, kwargs))
        data = documents[path]
        return 200, "application/json", (data if isinstance(data, str) else json.dumps(data)).encode()
    monkeypatch.setattr(superbox, "request", request)
    catalog = superbox.discover(lambda: 10, lambda: None)
    assert not catalog.unsupported
    return superbox, {op.path: op for op in catalog.operations}, calls


def context(image, upload_error=False):
    uploads = []
    def upload(raw, filename, folder):
        if upload_error:
            raise RuntimeError("secret COS response")
        uploads.append((raw, filename, folder))
        return "https://cdn.example.com/images/edited.png"
    def download(url, limit):
        assert url == URL and limit == EXIF_INPUT_LIMIT
        if len(image) > limit:
            raise ValueError("file exceeds 20MB limit")
        return image
    references = []
    return SimpleNamespace(download=download, timeout=lambda: 10, cos=lambda: SimpleNamespace(upload=upload),
        add=lambda url, **kwargs: references.append(url), check=lambda: None), uploads, references


@pytest.mark.parametrize("image,mime", IMAGES)
def test_all_formats_inspect_set_delete_and_cos_delivery(provider, monkeypatch, image, mime):
    box, operations, calls = provider
    ctx, uploads, references = context(image)
    arguments = {"body": {"image_url": URL}}
    def request(method, path, timeout, **kwargs):
        calls.append((method, path, kwargs))
        assert kwargs["files"]["image"][1] == image
        assert kwargs["files"]["image"][2] == mime
        if path == "/exif/inspect":
            return 200, "application/json", json.dumps({"tags": [{"key": "IFD0:Artist", "writable": True}, {"key": "IFD0:Offset", "writable": False}]}).encode()
        assert kwargs["max_bytes"] == EXIF_OUTPUT_LIMIT
        assert json.loads(kwargs["data"]["changes"])[0]["action"] in ("set", "delete")
        return 200, mime, image
    monkeypatch.setattr(box, "request", request)
    assert "error" not in box.call(operations["/exif/inspect"], arguments, 10, ctx)
    for change in ({"key": "IFD0:Artist", "action": "set", "value": "ALChat"}, {"key": "IFD0:Artist", "action": "delete"}):
        output = box.call(operations["/exif/edit"], {"body": {"image_url": URL, "changes": [change]}}, 10, ctx)
        assert output["result"] == {"url": references[-1], "mime_type": mime, "size": len(image)}
    assert len(uploads) == 2 and all(upload[2] == "images" for upload in uploads)


@pytest.mark.parametrize("changes", [[], [{"key": "IFD0:Artist", "action": "set"}], [{"key": "IFD0:Artist", "action": "set", "value": ""}], [{"key": "IFD0:Artist", "action": "set", "value": "a" * 4097}], [{"key": "IFD0:Artist", "action": "delete"}] * 101])
def test_invalid_changes_never_call_provider(provider, changes):
    box, operations, calls = provider
    before = len(calls)
    result = box.call(operations["/exif/edit"], {"body": {"image_url": URL, "changes": changes}}, 10)
    assert result["code"] == "VALIDATION_ERROR" and len(calls) == before


def test_unverified_and_readonly_keys_rejected(provider):
    box, operations, calls = provider
    arguments = {"body": {"image_url": URL, "changes": [{"key": "IFD0:Artist", "action": "delete"}]}}
    assert box.validate(operations["/exif/edit"], arguments)["code"] == "VALIDATION_ERROR"
    box.writable.add("IFD0:Artist")
    box.readonly[URL] = {"IFD0:Artist"}
    assert "只读" in box.validate(operations["/exif/edit"], arguments)["error"]


@pytest.mark.parametrize("image", [b"GIF89atest", b"x" * (EXIF_INPUT_LIMIT + 1)], ids=["unsupported-gif", "over-20-mib"])
def test_unsupported_and_oversize_images_never_call_exif(provider, image):
    box, operations, calls = provider
    ctx, _, _ = context(image)
    before = len(calls)
    output = box.call(operations["/exif/inspect"], {"body": {"image_url": URL}}, 10, ctx)
    assert output["code"] == "ATTACHMENT_UNSUPPORTED" and len(calls) == before


@pytest.mark.parametrize("status,mime,result,upload_error,code", [
    (503, "application/json", b'{"code":"EXIF_UNAVAILABLE","message":"ExifTool unavailable"}', False, "EXIF_UNAVAILABLE"),
    (200, "image/jpeg", IMAGES[0][0], False, "UNSUPPORTED_RESPONSE"),
    (200, "image/png", IMAGES[0][0], True, "COS_UPLOAD_FAILED"),
    (200, "application/json", b'{"url":"fake"}', False, "PROVIDER_ERROR"),
])
def test_failures_never_report_file_delivery(provider, monkeypatch, status, mime, result, upload_error, code):
    box, operations, calls = provider
    box.writable.add("IFD0:Artist")
    ctx, uploads, references = context(IMAGES[0][0], upload_error)
    monkeypatch.setattr(box, "request", lambda *args, **kwargs: (status, mime, result))
    output = box.call(operations["/exif/edit"], {"body": {"image_url": URL, "changes": [{"key": "IFD0:Artist", "action": "delete"}]}}, 10, ctx)
    assert output["code"] == code and "result" not in output and not references
    assert "secret" not in str(output)


@pytest.mark.parametrize("mime,size,limit,raises", [
    ("application/json", 2 * 1024 * 1024 + 1, EXIF_OUTPUT_LIMIT, True),
    ("image/png", 2 * 1024 * 1024 + 1, EXIF_OUTPUT_LIMIT, False),
    ("image/png", EXIF_OUTPUT_LIMIT + 1, EXIF_OUTPUT_LIMIT, True),
])
def test_binary_response_limit_does_not_relax_json_limit(monkeypatch, mime, size, limit, raises):
    original = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(200, headers={"Content-Type": mime}, content=b"x" * size))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs))
    box = Superbox("https://superbox.example/api/v1")
    if raises:
        with pytest.raises(Unsupported):
            box.request("POST", "/exif/edit", 10, max_bytes=limit)
    else:
        assert len(box.request("POST", "/exif/edit", 10, max_bytes=limit)[2]) == size
