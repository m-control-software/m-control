"""Backups of the settings store (default: ~/.m-control/backups/logi-options/).

A backup directory holds a consistent standalone settings.db (SQLite backup
API, WAL folded in) plus manifest.json with checksums. Restore puts that file
back with the agent stopped and moves the live WAL/SHM aside: pairing a
restored DB with a newer WAL would make SQLite replay the newer frames on top.

An apply that changed the Actions Ring also leaves ring/ in its backup
(lib/ring.py backup(): the touched Ring profiles as they were, and which apps it
created); restore puts those back in the same agent stop.
"""
from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path

import ring
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
        raise StoreError(f"{p} is not a logi-options backup (no manifest.json). "
                         "List them: mctl run logi-options mode=backups")
    return p


def restore(store: st.Store, backups_dir: Path, src: Path, log, deadline: transaction.Deadline,
            ring_store: ring.RingStore | None = None) -> dict:
    """Restore settings.db and, when the backup holds one (src/ring/), the Actions Ring
    profiles an apply touched; both inside one agent stop."""
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    if st.sha256_file(src / "settings.db") != manifest["settingsDbSha256"]:
        raise StoreError(f"{src / 'settings.db'} does not match its manifest checksum; refusing to restore it.")
    st.read_db(src / "settings.db")  # validates layout + round trip before anything is touched
    with_ring = ring.has_backup(src)
    if with_ring:
        if ring_store is None or not ring_store.available:
            raise StoreError(f"{src} also holds Actions Ring profiles, but no Ring store is configured. Set "
                             "logi-options.ringDataDir (or use the live stores) and run the restore again.")
        if ring_store.live and not store.live:
            raise StoreError("The Ring store is the live one but logi-options.dataDir is a copy; refusing to restore.")
        ring.check_backup(src)
    (src / "settings.db-wal").unlink(missing_ok=True)
    (src / "settings.db-shm").unlink(missing_ok=True)
    safety = create(store, backups_dir, "pre-restore")
    log("info", f"current state saved to {safety}")
    ring_restored: list[str] = []

    def swap() -> None:
        if with_ring and ring_store.live:
            ring.wait_owner_stopped(st.list_processes, transaction.RING_OWNER_STOP_S)
        for suffix in ("-wal", "-shm"):
            live = store.data_dir / f"settings.db{suffix}"
            if live.exists():
                live.replace(safety / f"live-at-restore{suffix}")
        shutil.copyfile(src / "settings.db", store.settings_db)
        if with_ring:
            ring_restored.extend(ring.restore(src, ring_store, safety))

    transaction.with_agent_stopped(store, swap, log, deadline)
    restored = store.read()
    if restored.sha256 != manifest["blobSha256"]:
        raise StoreError(f"Restored document hash mismatch. The pre-restore state is in {safety}.")
    if with_ring:
        ring.verify_restore(src, ring_store)
    out = {"restored": str(src), "blobSha256": restored.sha256, "safetyBackup": str(safety)}
    if with_ring:
        out["ring"] = ring_restored
    return out
