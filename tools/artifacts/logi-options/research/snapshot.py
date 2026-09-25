"""Developer script (run directly, NOT via mctl): labeled read-only snapshot of
everything Options+ might persist state in. Step 1 and 3 of the controlled-
change method in docs/maintenance.md.

    python research/snapshot.py <label> [--out DIR]

Default output: ~/.m-control/research/logi-options/snapshots/<label>. Never
inside the repo - a snapshot holds the whole settings document (host name,
device serials, app paths and command lines). Records SHA-256/size/mtime of
candidate files, fingerprints (never values) of the Options+ registry keys,
running Logitech processes and a consistent dump of settings.db.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import winreg
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import store as st  # noqa: E402

DEFAULT_OUT = Path.home() / ".m-control" / "research" / "logi-options" / "snapshots"
LOCAL, ROAMING = Path(os.environ["LOCALAPPDATA"]), Path(os.environ["APPDATA"])
WATCH = [  # (root, recursive, excluded top-level subdirectories)
    (st.LIVE_DATA_DIR, True, set()),
    (ROAMING / "logioptionsplus", True, {"Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache",
                                         "Shared Dictionary", "Crashpad", "blob_storage"}),
    (st.PROGRAM_DATA, False, set()),  # catalogs at top level only; depots/ is the install payload
    (LOCAL / "Logi" / "LogiPluginService", True, {"PluginHosts", "Media", "Temp"}),
]
REG_KEYS = [r"Software\Logitech\LogiOptionsPlus", r"Software\Logitech\SharedSettings"]


def file_records() -> list[dict]:
    recs = []
    for root, recursive, excluded in WATCH:
        if not root.exists():
            continue
        for p in (root.rglob("*") if recursive else root.glob("*")):
            if not p.is_file() or p.relative_to(root).parts[0] in excluded:
                continue
            s = p.stat()
            mtime = dt.datetime.fromtimestamp(s.st_mtime).isoformat(timespec="seconds")
            rec = {"path": str(p), "size": s.st_size, "mtime": mtime}
            try:
                rec["sha256"] = st.sha256_file(p)
            except OSError as e:  # exclusively locked (Electron lockfile)
                rec["error"] = str(e)
            recs.append(rec)
    return sorted(recs, key=lambda r: r["path"].lower())


def registry_fingerprints() -> dict:
    out = {}

    def walk(path: str):
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, path)
        except OSError:
            return
        with key:
            i = 0
            while True:
                try:
                    name, value, kind = winreg.EnumValue(key, i)
                except OSError:
                    break
                raw = value if isinstance(value, bytes) else str(value).encode("utf-8")
                out[f"HKCU\\{path}\\{name}"] = {"type": kind, "len": len(raw), "sha256": st.sha256(raw)[:16]}
                i += 1
            j = 0
            while True:
                try:
                    walk(path + "\\" + winreg.EnumKey(key, j))
                except OSError:
                    break
                j += 1

    for k in REG_KEYS:
        walk(k)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("label")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    dest = Path(args.out) / args.label
    if dest.exists():
        print(f"error: {dest} exists; pick a new label", file=sys.stderr)
        return 1
    dest.mkdir(parents=True)
    snap = st.read_db(st.LIVE_DATA_DIR / "settings.db")
    (dest / "settings.blob").write_bytes(snap.blob)
    (dest / "meta.json").write_text(json.dumps({
        "label": args.label, "takenAt": dt.datetime.now().isoformat(timespec="seconds"),
        "rowDateCreatedUtc": snap.date_created, "blobSha256": snap.sha256, "blobLen": len(snap.blob),
        "processes": st.logi_processes()}, indent=2), encoding="utf-8")
    (dest / "files.json").write_text(json.dumps(file_records(), indent=1), encoding="utf-8")
    (dest / "registry.json").write_text(json.dumps(registry_fingerprints(), indent=1), encoding="utf-8")
    print(f"snapshot {args.label}: blob {snap.sha256[:16]} ({len(snap.blob)} bytes, "
          f"saved {snap.date_created} UTC) -> {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
