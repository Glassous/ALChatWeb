"""Separate Agent progress narration from the user-facing answer."""
from __future__ import annotations

import re

_PROCESS = re.compile(r"<(agent_process|think|analysis)>(.*?)</\1>", re.I | re.S)
_FINAL = re.compile(r"<final_answer>(.*?)(?:</final_answer>|$)", re.I | re.S)
_NARRATION = re.compile(
    r"^(?:I (?:now )?have (?:enough|sufficient) (?:data|information|material|evidence)\b"
    r"|I (?:will|can now|am now ready to) (?:compile|prepare|write|draft) (?:a |the )?(?:research )?(?:report|summary|answer)\b"
    r"|我(?:现在|已经)?(?:收集|获取|掌握)了?(?:足够|充分|充足)的?(?:资料|数据|信息))"
    r"[^.!?。！？\n]*(?:[.!?。！？](?=\s|$)|(?=\n|$))\s*", re.I,
)


def split_agent_reply(text: str) -> tuple[str, str]:
    """Use explicit answer boundaries, with a narrow fallback for older outputs."""
    final = _FINAL.search(text)
    if final:
        answer = final.group(1).strip()
        progress = text[:final.start()] + "\n" + text[final.end():]
        progress = re.sub(r"</?(?:agent_process|think|analysis)>", "", progress, flags=re.I).strip()
    else:
        parts = []

        def remove_process(match):
            parts.append(match.group(2).strip())
            return ""

        answer = _PROCESS.sub(remove_process, text).strip()
        unfinished = re.search(r"<(?:agent_process|think|analysis)>(.*)$", answer, re.I | re.S)
        if unfinished:
            parts.append(unfinished.group(1).strip())
            answer = answer[:unfinished.start()].strip()
        progress = "\n\n".join(part for part in parts if part)
    while match := _NARRATION.match(answer):
        progress = "\n\n".join(part for part in (progress, match.group().strip()) if part)
        answer = answer[match.end():].strip()
    return answer, progress
