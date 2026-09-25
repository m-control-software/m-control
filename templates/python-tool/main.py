#!/usr/bin/env python3
"""tool-id — Tool Protocol v1 (Python template)

stdin  <- JSON ToolRequest (read to EOF before doing any work)
stdout -> NDJSON ToolEvent lines ONLY (never bare print())
stderr -> raw diagnostic output (allowed, not parsed)
exit      0 = success, 1 = expected failure (after error event), >= 2 = crash

Standard library only, Python 3.10+ — tools stay standalone.

The tool id and the required config keys come from manifest.json, so the
manifest stays the single source of truth for both.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MANIFEST = json.loads(Path(__file__).with_name("manifest.json").read_text(encoding="utf-8"))
TOOL_ID = MANIFEST["id"]


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


def error(message: str, code: str, recoverable: bool) -> None:
    emit("error", {"message": message, "code": code, "recoverable": recoverable})


class ToolFailure(Exception):
    """An expected failure: reported as an error event, exit 1."""

    def __init__(self, message: str, code: str, recoverable: bool = True) -> None:
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


def read_request() -> dict:
    raw = sys.stdin.read()  # read to EOF before doing any work
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        # mctl always sends valid JSON, so a parse failure is a bug upstream.
        raise ToolFailure(
            f"Failed to parse ToolRequest from stdin: {err}", "INVALID_REQUEST", recoverable=False
        ) from err


def require_config(config: dict) -> None:
    """Fail with a recoverable CONFIG_MISSING error when any key the manifest
    declares in requiredConfig is unset or empty — the same rule `mctl doctor`
    applies. Nothing enforces requiredConfig at run time, so the tool must."""
    missing = [key for key in MANIFEST.get("requiredConfig", []) if config.get(key) in (None, "")]
    if missing:
        keys = ", ".join(f"tools.{key}" for key in missing)
        raise ToolFailure(
            f"Missing required config: {keys}. Set it in ~/.m-control/config.json "
            "(see this tool's README), then run 'mctl doctor'.",
            "CONFIG_MISSING",
        )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    started()

    request = read_request()
    context = request.get("context", {})
    tool_input = request.get("input", {})
    config = context.get("config") or {}
    require_config(config)

    log("info", f"Running in workspace: {context.get('workspaceRoot')}")

    # TODO: implement the tool. `tool_input` holds `mctl run tool-id key=value`
    # pairs, always as strings. `config` holds every key the manifest declares,
    # keyed by dot-path (e.g. config["tool-id.apiKey"]).

    result({"message": "TODO: implement me", "input": tool_input})


if __name__ == "__main__":
    try:
        main()
    except ToolFailure as failure:
        error(str(failure), failure.code, failure.recoverable)
        sys.exit(1)
    except Exception as err:  # noqa: BLE001 — last-resort crash reporting
        error(f"Unhandled error: {err!r}", "UNHANDLED_ERROR", False)
        sys.exit(2)
