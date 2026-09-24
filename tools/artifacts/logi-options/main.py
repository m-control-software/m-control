#!/usr/bin/env python3
"""logi-options - Logi Options+ mouse profiles from declarative *.logi.json packs.

Tool Protocol v1: stdin <- one JSON ToolRequest (read to EOF first);
stdout -> NDJSON ToolEvent lines only; exit 0 ok, 1 expected failure, 2 crash.

    mctl run logi-options                       apply every discovered spec (one agent restart; no-op if in sync)
    mctl run logi-options check=true            validate + drift report + planned change; writes nothing
    mctl run logi-options mode=export app=all out=C:/path/personal.logi.json [pack=personal] [force=true]
    mctl run logi-options mode=list | presets | inspect | backups | backup
    mctl run logi-options mode=remove app=rider64.exe
    mctl run logi-options mode=restore backup=latest

Flags are ToolInput key=value pairs: mctl drops arguments that start with '--'.
Unknown keys are rejected, so a typo like `chek=true` cannot fall through to a
real apply.
"""
from __future__ import annotations

import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR / "lib"))

import protocol as pr  # noqa: E402

MODES = ("apply", "check", "export", "list", "presets", "inspect", "remove", "restore", "backup", "backups")
INPUT_KEYS = {"mode", "check", "app", "out", "pack", "force", "backup", "device"}


def main() -> int:
    if sys.platform != "win32":
        pr.started()
        pr.error("logi-options supports Windows only (v1). Options+ also ships macOS catalogs; see "
                 "docs/internals.md for what a macOS port would need.", "UNSUPPORTED_PLATFORM", True)
        return 1

    import transaction  # noqa: E402  (after the platform check: lib uses ctypes.windll)
    from errors import LogiError  # noqa: E402

    deadline = transaction.Deadline()
    try:
        request = pr.read_request()
    except (ValueError, OSError) as err:
        pr.started()
        pr.error(f"Failed to parse ToolRequest from stdin: {err}", "INVALID_REQUEST", False)
        return 1

    tool_input = request.get("input") or {}
    context = request.get("context") or {}
    try:
        unknown = sorted(set(tool_input) - INPUT_KEYS)
        if unknown:
            raise ValueError(f"Unknown input {unknown}. Valid keys: {', '.join(sorted(INPUT_KEYS))}.")
        check = pr.parse_bool(tool_input.get("check"), "check")
        mode = str(tool_input.get("mode") or ("check" if check else "apply")).lower()
        if mode not in MODES:
            raise ValueError(f"Unknown mode '{mode}'. Modes: {', '.join(MODES)}.")
        if check and mode != "check":
            raise ValueError(f"check=true conflicts with mode={mode}.")
    except ValueError as err:
        pr.started()
        pr.error(str(err), "INVALID_INPUT", True)
        return 1

    pr.started({"mode": mode})
    try:
        import modes  # noqa: E402
        pr.result(modes.run(mode, tool_input, context, TOOL_DIR, deadline))
        return 0
    except (LogiError, ValueError) as err:
        code = getattr(err, "code", "INVALID_INPUT")
        pr.error(str(err), code, True)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        pr.error("Interrupted. If an apply was running, the agent was restarted in a finally block; "
                 "confirm with: mctl run logi-options check=true", "INTERRUPTED", True)
        sys.exit(1)
    except Exception as err:  # noqa: BLE001 - last-resort crash reporting
        pr.error(f"Unhandled error: {type(err).__name__}: {err}", "UNHANDLED_ERROR", False)
        sys.exit(2)
