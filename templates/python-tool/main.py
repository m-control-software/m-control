#!/usr/bin/env python3
"""<tool-id> — Tool Protocol v1 (Python template)

stdin  <- JSON ToolRequest (read to EOF before doing any work)
stdout -> NDJSON ToolEvent lines ONLY (never bare print())
stderr -> raw diagnostic output (allowed, not parsed)
exit      0 = success, 1 = expected failure (after error event), >= 2 = crash

Stick to the standard library where possible — tools should stay standalone.
"""

import json
import sys
from datetime import datetime, timezone

TOOL_ID = "tool-id"  # must match manifest.id


# ---------------------------------------------------------------------------
# Protocol helpers
# ---------------------------------------------------------------------------

def emit(event_type: str, payload: dict) -> None:
    event = {
        "type": event_type,
        "ts": datetime.now(timezone.utc).isoformat(),
        "toolId": TOOL_ID,
        "payload": payload,
    }
    sys.stdout.write(json.dumps(event) + "\n")
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
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    started()

    try:
        request = read_request()
    except (json.JSONDecodeError, OSError) as err:
        error(f"Failed to parse ToolRequest from stdin: {err}", "INVALID_REQUEST", False)
        return 1

    context = request.get("context", {})
    tool_input = request.get("input", {})

    # Config values requested via manifest.requiredConfig arrive as a flat map:
    #   context["config"]["my-service.token"]

    log("info", f"Running in workspace: {context.get('workspaceRoot')}")

    # TODO: implement tool logic here. `tool_input` holds key=value args
    # from `mctl run tool-id key=value`.

    result({"message": "TODO: implement me", "input": tool_input})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001 — last-resort crash reporting
        error(f"Unhandled error: {err}", "UNHANDLED_ERROR", False)
        sys.exit(2)
