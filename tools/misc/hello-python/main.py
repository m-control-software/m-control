#!/usr/bin/env python3
"""hello-python — Tool Protocol v1 reference implementation for the python runtime.

stdin  <- JSON ToolRequest
stdout -> NDJSON ToolEvent stream
stderr -> raw diagnostic logs (if any)
exit      0 = success

Standard library only — tools should stay standalone.
"""

import json
import platform
import sys
from datetime import datetime, timezone

TOOL_ID = "hello-python"


def emit(event_type: str, payload: dict) -> None:
    event = {
        "type": event_type,
        "ts": datetime.now(timezone.utc).isoformat(),
        "toolId": TOOL_ID,
        "payload": payload,
    }
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def main() -> int:
    emit("started", {"meta": {"python": platform.python_version()}})

    try:
        request = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError) as err:
        emit(
            "error",
            {
                "message": f"Failed to parse ToolRequest from stdin: {err}",
                "code": "INVALID_REQUEST",
                "recoverable": False,
            },
        )
        return 1

    context = request.get("context", {})
    tool_input = request.get("input", {})

    name = str(tool_input.get("name", "World"))

    emit(
        "log",
        {
            "level": "info",
            "message": f"Hello from Python {platform.python_version()}, {name}!",
        },
    )
    emit(
        "log",
        {
            "level": "debug",
            "message": "Tool context received",
            "data": {
                "toolId": context.get("toolId"),
                "configKeys": sorted((context.get("config") or {}).keys()),
            },
        },
    )

    emit("result", {"message": f"Hello, {name}!", "toolId": context.get("toolId")})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # noqa: BLE001 — last-resort crash reporting
        emit(
            "error",
            {
                "message": f"Unhandled error: {err}",
                "code": "UNHANDLED_ERROR",
                "recoverable": False,
            },
        )
        sys.exit(2)
