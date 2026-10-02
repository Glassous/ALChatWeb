"""Conversation-scoped COS references, shared by Agent media and EXIF tools."""
from __future__ import annotations

import re
import http.client
import ipaddress
import mimetypes
import socket
import ssl
import time
import queue
import threading
from email.message import Message
from urllib.parse import urlsplit, urljoin, unquote

from .media import COS, MEDIA_TAG, MAX_TRANSFER_BYTES, attachment_type, attachment_text, clean_filename, image_file_metadata


def fetch_public_file(url, timeout, check):
    """Pin each connection to a validated IP; TLS still verifies the hostname."""
    deadline = time.monotonic() + timeout
    for hop in range(4):
        check()
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            raise ValueError("文件链接必须是公开 HTTP/HTTPS 地址（80/443 端口）")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        resolved = queue.Queue(maxsize=1)
        def resolve(host=parsed.hostname, target_port=port, result=resolved):
            try:
                result.put(socket.getaddrinfo(host, target_port, type=socket.SOCK_STREAM))
            except Exception as exc:
                result.put(exc)
        threading.Thread(target=resolve, daemon=True).start()
        while True:
            check()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("文件地址解析超时")
            try:
                answers = resolved.get(timeout=min(remaining, 0.1))
                break
            except queue.Empty:
                continue
        if isinstance(answers, Exception):
            raise ValueError("无法解析文件地址") from answers
        if not answers or any(not ipaddress.ip_address(a[4][0]).is_global for a in answers):
            raise ValueError("不能下载本机、内网或保留地址")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("文件下载超时")
        sock = socket.create_connection((answers[0][4][0], port), timeout=min(remaining, 5))
        connection = http.client.HTTPConnection(parsed.hostname, port, timeout=remaining)
        try:
            if parsed.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(sock, server_hostname=parsed.hostname)
            check()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("文件下载超时")
            sock.settimeout(min(remaining, 5))
            connection.sock = sock
            connection.request("GET", (parsed.path or "/") + ("?" + parsed.query if parsed.query else ""), headers={"User-Agent": "ALChat/1.0", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                if hop == 3 or not response.getheader("Location"):
                    raise ValueError("文件重定向次数超过限制")
                url = urljoin(url, response.getheader("Location"))
                continue
            if not 200 <= response.status < 300:
                raise ValueError(f"文件下载失败（HTTP {response.status}）")
            if response.getheader("Content-Encoding", "identity") != "identity":
                raise ValueError("文件响应不支持压缩传输")
            if int(response.getheader("Content-Length", "0")) > MAX_TRANSFER_BYTES:
                raise ValueError("转存文件不能超过 10 MiB")
            header = Message()
            header["Content-Disposition"] = response.getheader("Content-Disposition", "")
            filename = clean_filename(header.get_filename() or unquote(parsed.path.split('/')[-1]) or "file")
            mime = response.getheader("Content-Type", "application/octet-stream").split(';')[0].strip().lower()
            data = bytearray()
            while True:
                check()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("文件下载超时")
                sock.settimeout(min(remaining, 5))
                chunk = response.read1(min(65536, MAX_TRANSFER_BYTES + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_TRANSFER_BYTES:
                    raise ValueError("转存文件不能超过 10 MiB")
            if not data:
                raise ValueError("不能转存空文件")
            if '.' not in filename:
                filename += mimetypes.guess_extension(mime) or ""
            return bytes(data), filename, mime
        finally:
            connection.close()
            sock.close()
    raise ValueError("文件重定向失败")


class Attachments:
    def __init__(self, cfg, history, timeout, check):
        self.cfg, self.timeout, self.check = cfg, timeout, check
        self.items = {}
        self.transfers = {}
        self.delivered = []
        for message in history:
            for item in message.get("attachments", []):
                self.items[item["url"]] = dict(item)
            content = message.get("content", "")
            for match in MEDIA_TAG.finditer(content):
                self.add(match.group(2), match.group(1))
            # Chat cleanup converts historical assistant images to Markdown.
            for url in re.findall(r'!\[[^\]]*\]\((https://[^\s)]+)\)', content):
                self.add(url, "image")

    def cos(self):
        self.check()
        return COS(self.cfg, timeout=self.timeout())

    def add(self, url, tag="image", mime="", **info):
        self.items.setdefault(url, {"url": url, "type": attachment_type(url, tag, mime), "mime_type": mime, **info})

    def save(self, content, filename, mime):
        if mime.startswith("image/") and mime != "image/svg+xml":
            try:
                detected_name, detected_mime = image_file_metadata(content)
                mime = detected_mime
                if not (mimetypes.guess_type(filename)[0] or "").startswith("image/"):
                    filename += '.' + detected_name.split('.')[-1]
            except ValueError:
                if content.startswith(b"GIF8"):
                    mime = "image/gif"
                elif not content.startswith(b"BM"):
                    mime = "application/octet-stream"
        url = self.cos().upload(content, filename, "images" if mime.startswith("image/") and mime != "image/svg+xml" else "reference_files", mime)
        self.add(url, "file", mime, filename=clean_filename(filename), size=len(content))
        self.delivered.append(self.items[url])
        self.check()
        return self.items[url]

    def transfer(self, url):
        if url in self.transfers:
            return self.transfers[url]
        try:
            self.cos().reference_key(url)
        except ValueError:
            data, filename, mime = fetch_public_file(url, self.timeout(), self.check)
            item = self.save(data, filename, mime)
        else:
            info = self.cos().metadata(url)
            if info["size"] > MAX_TRANSFER_BYTES:
                raise ValueError("转存文件不能超过 10 MiB")
            self.add(url, "file", info["mime_type"], filename=info.get("filename") or clean_filename(urlsplit(url).path), size=info["size"])
            item = self.items[url]
            if item not in self.delivered:
                self.delivered.append(item)
        self.transfers[url] = item
        return item

    def resolve(self):
        for item in self.items.values():
            self.check()
            try:
                info = self.cos().metadata(item["url"])
                item.update({k: v for k, v in info.items() if v != ""})
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
