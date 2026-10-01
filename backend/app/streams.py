from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Iterator


@dataclass
class StreamState:
    events: list[dict] = field(default_factory=list)
    subscribers: list[queue.Queue] = field(default_factory=list)
    closed: bool = False
    started: bool = False


class StreamManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.states: dict[str, StreamState] = {}

    def start(self, conversation_id: str) -> None:
        with self.lock:
            old = self.states.get(conversation_id)
            if old:
                for subscriber in old.subscribers:
                    subscriber.put(None)
            self.states[conversation_id] = StreamState(started=True)

    def publish(self, conversation_id: str, typ: str, content: str = "", data=None) -> None:
        event = {"type": typ}
        if content:
            event["content"] = content
        if data is not None:
            event["data"] = data
        with self.lock:
            state = self.states.setdefault(conversation_id, StreamState())
            if state.closed:
                return
            state.events.append(event)
            for subscriber in state.subscribers:
                subscriber.put(event)

    def close(self, conversation_id: str) -> None:
        with self.lock:
            state = self.states.get(conversation_id)
            if not state or state.closed:
                return
            state.closed = True
            for subscriber in state.subscribers:
                subscriber.put(None)
            state.subscribers.clear()
        threading.Timer(30, self._expire, args=(conversation_id, state)).start()

    def _expire(self, conversation_id: str, state: StreamState) -> None:
        with self.lock:
            if self.states.get(conversation_id) is state:
                del self.states[conversation_id]

    def subscribe(self, conversation_id: str) -> Iterator[str]:
        channel: queue.Queue = queue.Queue()
        with self.lock:
            state = self.states.setdefault(conversation_id, StreamState())
            for event in state.events:
                channel.put(event)
            if state.closed:
                channel.put(None)
            else:
                state.subscribers.append(channel)
        try:
            while True:
                try:
                    event = channel.get(timeout=30)
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                if event is None:
                    break
                yield "data: " + json.dumps(event, ensure_ascii=False, default=str, separators=(",", ":")) + "\n\n"
        finally:
            with self.lock:
                if channel in state.subscribers:
                    state.subscribers.remove(channel)
