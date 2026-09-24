"""Developer script (run directly, NOT via mctl): list every keystroke
(code -> virtualKeyId / displayCharacter / example action) in the installed
Options+ catalogs. Evidence behind catalog.KEYS; re-run after an update and
compare if shortcuts ever compile to the wrong key.

    python research/probe_keycodes.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import catalog as cat  # noqa: E402


def main() -> int:
    data = cat.build_dir() / "logioptionsplus" / "data"
    files = list(data.rglob("*_win.json")) + [data / "applications.json"]
    seen: dict[int, set] = defaultdict(set)

    def walk(o):
        if isinstance(o, dict):
            ks = o.get("keystroke")
            if isinstance(ks, dict):
                seen[ks.get("code", 0)].add((ks.get("virtualKeyId", ""), ks.get("displayCharacter", ""), o.get("actionName", "")))
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    for f in files:
        try:
            walk(json.loads(f.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
    sys.stdout.reconfigure(encoding="utf-8")
    for code in sorted(seen):
        vks = sorted({v for v, _, _ in seen[code] if v})
        disp = sorted({d for _, d, _ in seen[code] if d})
        ours = cat.CODE_TO_KEY.get(code, "-")
        print(f"{code:>4}  ours={ours:<14} vk={vks}  display={disp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
