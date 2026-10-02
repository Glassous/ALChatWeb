"""Media runs use the real Agent graph with isolated models, COS and storage."""
from types import SimpleNamespace
import json

import pytest
from sqlalchemy import select

from app.ai import AIService
from app.attachments import Attachments
from app.storage import AgentUsage
from app.media import attachment_type
from tests.test_agent_runs import agent, answer, start, wait, ScriptModel
from .test_superbox_exif import provider
from tests.conftest import auth, sse_events
from app.superbox import Catalog

URL = "https://cdn.example.com/reference_files/photo.png"
PNG = b"\x89PNG\r\n\x1a\noriginal"


@pytest.fixture()
def media_cos(monkeypatch):
    objects = {URL: (PNG, "image/png"), "https://cdn.example.com/reference_files/movie.bin": (b"video", "video/mp4")}
    class MemoryCOS:
        def __init__(self, cfg, timeout=10):
            pass
        def metadata(self, url):
            data, mime = objects[url]
            return {"mime_type": mime, "size": len(data)}
        def download_reference(self, url, limit):
            data = objects[url][0]
            if len(data) > limit:
                raise ValueError("file exceeds limit")
            return data
        def upload(self, data, filename, folder):
            url = f"https://cdn.example.com/{folder}/edited.png"
            objects[url] = (data, "image/png")
            return url
    monkeypatch.setattr("app.attachments.COS", MemoryCOS)
    return objects


def image_call(url=URL, id="image-1"):
    return {"name": "analyze_image", "id": id, "args": {"image_url": url, "question": "描述图片"}, "type": "tool_call"}


def test_image_graph_preserves_url_and_bills_both_models(client, agent, media_cos, monkeypatch):
    state, daily, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={"MULTIMODAL_API_KEY": "configured"})
    vision = ScriptModel(script=[answer("图片中有一只猫")])
    daily.script = [answer("", [image_call()]), answer("<final_answer>图片中有一只猫。</final_answer>")]
    monkeypatch.setattr(state.ai, "model_for", lambda mode, runtime=None, timeout=240: vision if mode == "multimodal" else daily)
    run, body = start(client, agent, message=f'<file src="{URL}">描述图片')
    done = wait(state, run["id"])
    assert done["status"] == "completed" and "猫" in done["content"]
    assert done["budget"]["model_used"] == 3
    with state.db.session() as session:
        usage = session.scalars(select(AgentUsage).where(AgentUsage.run_id == run["id"])).all()
        assert len(usage) == 3 and len({row.id for row in usage}) == 3
    assert done["credits"] == pytest.approx(999.73)
    assert any(URL in str(m.content) for m in daily.inputs[0])
    assert vision.inputs[0][-1].content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    step = next(step for step in done["steps"] if step["type"] == "media")
    assert URL in step["input_preview"] and "猫" in step["output_preview"]
    assert "base64," not in json.dumps(done, ensure_ascii=False)
    stored = state.conversations.get(user["id"], conv["id"])["messages"]
    assert next(m for m in stored if m["id"] == run["user_message_id"])["content"] == body["message"]


@pytest.mark.parametrize("limit", [1, 2])
def test_media_reserves_final_model_call(client, agent, media_cos, limit):
    state, daily, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={"MULTIMODAL_API_KEY": "configured", "AGENT_MAX_MODEL_CALLS": limit})
    daily.script = [answer("", [image_call()]), answer("<final_answer>当前做不到图片分析：预算不足。</final_answer>")] if limit == 2 else [answer("<final_answer>当前做不到图片分析：预算不足。</final_answer>")]
    run, _ = start(client, agent, message=f'<image src="{URL}">描述图片')
    done = wait(state, run["id"])
    assert done["status"] == "completed" and "当前做不到" in done["content"]
    assert done["budget"]["model_used"] <= limit
    assert all(mode == "daily" for mode, *_ in chosen)


def test_missing_multimodal_is_in_formal_reply_even_if_model_omits_error(client, agent, media_cos):
    state, daily, chosen, user, jwt, conv = agent
    state.ai.multimodal_api_key = ""
    daily.script = [answer("", [image_call()]), answer("<final_answer>已收到附件。</final_answer>")]
    run, _ = start(client, agent, message=f'<file src="{URL}">描述图片')
    done = wait(state, run["id"])
    assert "当前做不到" in done["content"] and "未配置多模态模型" in done["content"]
    assert next(s for s in done["steps"] if s["type"] == "media")["error_code"] == "MULTIMODAL_UNAVAILABLE"


def test_video_only_uses_cos_mime_and_never_sends_video_to_model(client, agent, media_cos):
    state, daily, chosen, user, jwt, conv = agent
    url = "https://cdn.example.com/reference_files/movie.bin"
    run, _ = start(client, agent, message=f'<file src="{url}">')
    done = wait(state, run["id"])
    assert done["status"] == "completed" and "当前做不到视频内容分析" in done["content"] and url in done["content"]
    assert not daily.inputs and done["credits"] == 1000


def test_attachment_only_images_and_history_keep_tool_available(client, agent, media_cos):
    state, daily, chosen, user, jwt, conv = agent
    historical = state.conversations.save(user["id"], conv["id"], "user", f'<image src="{URL}">')
    run, _ = start(client, agent, message="这张图还能处理什么？", parent_message_id=historical["id"])
    done = wait(state, run["id"])
    assert done["status"] == "completed" and "analyze_image" in daily.bound_names
    assert URL in str(daily.inputs[0])


def test_download_failure_is_formal_and_does_not_charge_vision(client, agent, media_cos):
    state, daily, chosen, user, jwt, conv = agent
    state.cfg = state.cfg.model_copy(update={"MULTIMODAL_API_KEY": "configured"})
    del media_cos[URL]
    daily.script = [answer("", [image_call()]), answer("<final_answer>已收到附件。</final_answer>")]
    run, _ = start(client, agent, message=f'<image src="{URL}">读取图片')
    done = wait(state, run["id"])
    assert "无法读取 COS" in done["content"] and "当前做不到" in done["content"]
    assert done["budget"]["model_used"] == 2


def test_ordinary_ai_video_is_text_and_original_image_url_survives_conversion(monkeypatch):
    from tests.conftest import CFG
    cfg = CFG.model_copy(update={"COS_CUSTOM_DOMAIN": "cdn.example.com", "COS_BUCKET": "bucket", "COS_REGION": "ap-beijing"})
    ai = AIService(cfg)
    blocks = ai._blocks(f'<file src="https://cdn.example.com/reference_files/movie.mp4"><image src="{URL}">')
    assert len([b for b in blocks if b["type"] == "image_url"]) == 1
    assert "视频" in blocks[0]["text"] and "做不到" in blocks[0]["text"]
    assert URL in blocks[1]["text"]
    assert "bucket.cos.ap-beijing.myqcloud.com" in blocks[2]["image_url"]["url"]
    assert attachment_type(URL, "file", "video/mp4") == "video"


def test_tools_cannot_download_unreferenced_branch_images(media_cos):
    context = Attachments(SimpleNamespace(), [{"content": f'<image src="{URL}">'}], lambda: 10, lambda: None)
    with pytest.raises(ValueError, match="当前会话分支"):
        context.download("https://cdn.example.com/reference_files/other.png", 100)


@pytest.mark.parametrize("final_failure", [False, True], ids=["completed", "final-model-failed"])
def test_exif_graph_delivers_files_persists_and_reconnects(client, agent, media_cos, provider, monkeypatch, final_failure):
    state, daily, chosen, user, jwt, conv = agent
    box, operations, calls = provider
    state.cfg = state.cfg.model_copy(update={"SUPERBOX_ENABLED": True})
    monkeypatch.setattr("app.agents.Superbox", lambda base: box)
    monkeypatch.setattr(box, "discover", lambda timeout, check: Catalog(operations=list(operations.values())))
    def request(method, path, timeout, **kwargs):
        if path == "/exif/tags":
            return 200, "application/json", b'{"tags":[{"key":"IFD0:Artist","writable":true}]}'
        assert kwargs["files"]["image"][1] == PNG
        assert json.loads(kwargs["data"]["changes"])[0]["value"] == "ALChat"
        return 200, "image/png", PNG + b"edited metadata"
    monkeypatch.setattr(box, "request", request)
    def call(path, args, id):
        return {"name": operations[path].name, "args": args, "id": id, "type": "tool_call"}
    daily.script = [
        answer("", [call("/exif/tags", {"query": {"q": "Artist"}}, "tags")]),
        answer("", [call("/exif/edit", {"body": {"image_url": URL, "changes": [{"key": "IFD0:Artist", "action": "set", "value": "ALChat"}]}}, "edit")]),
        RuntimeError("secret model failure") if final_failure else answer("<final_answer>已完成 EXIF 修改。</final_answer>"),
    ]
    run, body = start(client, agent, message=f'<file src="{URL}">修改作者为 ALChat')
    done = wait(state, run["id"])
    edited = "https://cdn.example.com/images/edited.png"
    assert done["status"] == ("failed" if final_failure else "completed")
    assert f'<image src="{edited}">' in done["content"] and f'[下载处理后的图片]({edited})' in done["content"]
    assert media_cos[URL][0] == PNG and edited in media_cos
    assert done["budget"]["plugin_used"] == 2
    before_credits = done["credits"]
    replay = sse_events(client.get(f"/api/agent/runs/{run['id']}/events", headers=auth(jwt)).text)
    assert replay[-1]["type"] == "terminal" and replay[-1]["data"]["content"] == done["content"]
    duplicate = client.post("/api/agent/runs", json=body, headers=auth(jwt))
    assert duplicate.status_code == 200 and duplicate.json()["id"] == run["id"]
    assert duplicate.json()["credits"] == before_credits
    stored = state.conversations.get(user["id"], conv["id"])["messages"][-1]
    assert stored["content"] == done["content"] and stored["agent_trace"] == done["steps"]


def test_multimodal_provider_failure_is_formal_without_unconfirmed_charge(client, agent, media_cos, monkeypatch):
    state, daily, chosen, user, jwt, conv = agent
    vision = ScriptModel(script=[RuntimeError("secret provider body")])
    daily.script = [answer("", [image_call()]), answer("<final_answer>附件已收到。</final_answer>")]
    monkeypatch.setattr(state.ai, "model_for", lambda mode, runtime=None, timeout=240: vision if mode == "multimodal" else daily)
    run, _ = start(client, agent, message=f'<image src="{URL}">描述图片')
    done = wait(state, run["id"])
    assert "当前做不到" in done["content"] and "多模态模型请求失败" in done["content"]
    assert "secret" not in json.dumps(done)
    assert done["budget"]["model_used"] == 3 and done["credits"] == pytest.approx(999.82)
