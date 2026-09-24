"""Tool Protocol v1 emission helpers (from templates/python-tool).

stdout carries NDJSON ToolEvent lines and nothing else. Nothing in lib/ may
print(); progress goes through log(), which callers pass down as a callback.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

TOOL_ID = "logi-options"  # must match manifest.id


def emit(event_type: str, payload: dict) -> None:
    event = {"type": event_type, "ts": datetime.now(timezone.utc).isoformat(), "toolId": TOOL_ID, "payload": payload}
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def started(meta: dict | None = None) -> None:
    emit("started", {"meta": meta or {}})


def log(level: str, message: str, data=None) -> None:
    payload = {"level": level, "message": message}
    if data is not None:
        payload["data"] = data
    emit("log", payload)


def result(payload) -> None:
    emit("result", payload)


def error(message: str, code: str, recoverable: bool = True) -> None:
    emit("error", {"message": message, "code": code, "recoverable": recoverable})


def read_request() -> dict:
    raw = sys.stdin.read()  # read to EOF before doing any work
    if not raw.strip():
        raise ValueError("Empty stdin - expected a JSON ToolRequest.")
    return json.loads(raw)


def parse_bool(value, name: str, default: bool = False) -> bool:
    """ToolInput values arrive as STRINGS; "false" must not be truthy. An
    uninterpretable value is an error, never a guess - these flags decide
    whether the live configuration is written."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    v = str(value).strip().lower()
    if v == "":
        return default
    if v in ("true", "1", "yes", "on"):
        return True
    if v in ("false", "0", "no", "off"):
        return False
    raise ValueError(f"Cannot interpret {name}={value!r} as a boolean. Use {name}=true or {name}=false.")
