"""Backups of the settings store (default: ~/.m-control/backups/logi-options/).

A backup directory holds a consistent standalone settings.db (SQLite backup
API, WAL folded in) plus manifest.json with checksums. Restore puts that file
back with the agent stopped and moves the live WAL/SHM aside: pairing a
restored DB with a newer WAL would make SQLite replay the newer frames on top.
"""
from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path

import store as st
import transaction
from errors import StoreError

DEFAULT_DIR = Path.home() / ".m-control" / "backups" / "logi-options"


def create(store: st.Store, backups_dir: Path, label: str) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%dT%H%M%S")
    dest = backups_dir / f"{stamp}-{label}"
    n = 1
    while dest.exists():  # two backups in the same second must not collide
        n += 1
        dest = backups_dir / f"{stamp}-{label}-{n}"
    dest.mkdir(parents=True)
    store.backup_to(dest / "settings.db")
    snap = st.read_db(dest / "settings.db")
    manifest = {"created": dt.datetime.now().isoformat(timespec="seconds"), "label": label,
                "source": str(store.settings_db), "blobSha256": snap.sha256,
                "settingsDbSha256": st.sha256_file(dest / "settings.db")}
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # read_db() opened the copy; drop the empty -wal/-shm it may have left behind
    for suffix in ("-wal", "-shm"):
        (dest / f"settings.db{suffix}").unlink(missing_ok=True)
    return dest


def list_backups(backups_dir: Path) -> list[dict]:
    out = []
    for m in sorted(backups_dir.glob("*/manifest.json")):
        info = json.loads(m.read_text(encoding="utf-8"))
        out.append({"dir": str(m.parent), "name": m.parent.name, "created": info.get("created"),
                    "blobSha256": info.get("blobSha256")})
    return out


def resolve(backups_dir: Path, name: str) -> Path:
    if name == "latest":
        items = list_backups(backups_dir)
        if not items:
            raise StoreError(f"No backups in {backups_dir}.")
        return Path(items[-1]["dir"])
    p = Path(name)
    if not p.is_absolute():
        p = backups_dir / name
    if not (p / "manifest.json").is_file():
        raise StoreError(f"{p} is not a logi-options backup (no manifest.json). List them: mctl run logi-options mode=backups")
    return p


def restore(store: st.Store, backups_dir: Path, src: Path, log, deadline: transaction.Deadline) -> dict:
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    if st.sha256_file(src / "settings.db") != manifest["settingsDbSha256"]:
        raise StoreError(f"{src / 'settings.db'} does not match its manifest checksum; refusing to restore it.")
    st.read_db(src / "settings.db")  # validates layout + round trip before anything is touched
    (src / "settings.db-wal").unlink(missing_ok=True)
    (src / "settings.db-shm").unlink(missing_ok=True)
    safety = create(store, backups_dir, "pre-restore")
    log("info", f"current state saved to {safety}")

    def swap() -> None:
        for suffix in ("-wal", "-shm"):
            live = store.data_dir / f"settings.db{suffix}"
            if live.exists():
                live.replace(safety / f"live-at-restore{suffix}")
        shutil.copyfile(src / "settings.db", store.settings_db)

    transaction.with_agent_stopped(store, swap, log, deadline)
    restored = store.read()
    if restored.sha256 != manifest["blobSha256"]:
        raise StoreError(f"Restored document hash mismatch. The pre-restore state is in {safety}.")
    return {"restored": str(src), "blobSha256": restored.sha256, "safetyBackup": str(safety)}
