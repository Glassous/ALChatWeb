"""Conversation-scoped COS references, shared by Agent media and EXIF tools."""
from __future__ import annotations

import re

from .media import COS, MEDIA_TAG, attachment_type, attachment_text


class Attachments:
    def __init__(self, cfg, history, timeout, check):
        self.cfg, self.timeout, self.check = cfg, timeout, check
        self.items = {}
        for message in history:
            content = message.get("content", "")
            for match in MEDIA_TAG.finditer(content):
                self.add(match.group(2), match.group(1))
            # Chat cleanup converts historical assistant images to Markdown.
            for url in re.findall(r'!\[[^\]]*\]\((https://[^\s)]+)\)', content):
                self.add(url, "image")

    def cos(self):
        self.check()
        return COS(self.cfg, timeout=self.timeout())

    def add(self, url, tag="image", mime=""):
        self.items.setdefault(url, {"url": url, "type": attachment_type(url, tag, mime), "mime_type": mime})

    def resolve(self):
        for item in self.items.values():
            self.check()
            try:
                info = self.cos().metadata(item["url"])
                item.update(info)
                item["type"] = attachment_type(item["url"], item["type"], info["mime_type"])
            except Exception:
                # A missing object/configuration must not hide the user's URL.
                self.check()

    def history(self, history):
        return [{**m, "content": MEDIA_TAG.sub(lambda match: attachment_text(match.group(2), self.items[match.group(2)]["type"]), m.get("content", ""))}
                for m in history]

    def download(self, url, limit):
        if url not in self.items:
            raise ValueError("只能处理当前会话分支中的附件及本次生成结果")
        if self.items[url]["type"] != "image":
            raise ValueError("当前做不到视频或未知类型附件的图片处理")
        content = self.cos().download_reference(url, limit)
        self.check()
        return content
