"""Storage adapter for the Logi Options+ settings document (Windows).

Verified facts this module relies on (docs/internals.md):

- The store is <data dir>\\settings.db, SQLite in WAL mode. Table `data` holds
  ONE row (_id=1) whose `file` column is a UTF-8 JSON document.
- The agent rewrites the whole document on every save; `_date_created` is the
  time of the last save.
- json.dumps(indent=2, ensure_ascii=False, sort_keys=True) reproduces the blob
  byte-for-byte. read() refuses to continue if that ever stops being true,
  because patches are only provably minimal while it holds.
- logioptionsplus_agent.exe is the sole writer. It holds the document in memory
  and would overwrite any write made while it runs, so writes require it stopped.

The agent is only ever touched when the store is the LIVE one. A Store aimed
at any other directory (tests, dry runs on a copy) never stops or starts it.
"""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import sqlite3
import subprocess
import time
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable

from errors import StoreError

LIVE_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "LogiOptionsPlus"
PROGRAM_DATA = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "LogiOptionsPlus"
AGENT_EXE = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "LogiOptionsPlus" / "logioptionsplus_agent.exe"
AGENT_PROCESS = "logioptionsplus_agent.exe"
GLOBAL_PROFILE_ID = "420fd454-0c36-499d-bde4-146823b16147"  # constant shipped in device packages

# Roles as observed (docs/internals.md "Process model").
PROCESS_ROLES = {
    "logioptionsplus_agent.exe": "backend: sole writer of settings.db, diverts device controls, executes actions",
    "logioptionsplus.exe": "Electron UI; client of the agent, never touches settings.db",
    "logioptionsplus_appbroker.exe": "spawned by the agent; foreground-app detection",
    "logioptionsplus_updater.exe": "service OptionsPlusUpdaterService (SYSTEM); installs updates, launches the agent",
    "logipluginservice.exe": "plugin host (Actions Ring, marketplace plugins); child of the agent",
    "logipluginserviceext.exe": "child of LogiPluginService",
}

Log = Callable[[str, str], None]  # (level, message)


def _noop(level: str, message: str) -> None:
    pass


# ---------------------------------------------------------------- processes

class _PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


def list_processes() -> list[tuple[str, int]]:
    """(image name, pid). Toolhelp snapshot: ~30 ms; `tasklist` took ~3 s on the reference machine."""
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if snap in (None, wintypes.HANDLE(-1).value):
        raise StoreError("CreateToolhelp32Snapshot failed; cannot tell whether the Options+ agent is running.")
    entry = _PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(entry)
    procs = []
    try:
        ok = k32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            procs.append((entry.szExeFile, entry.th32ProcessID))
            ok = k32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        k32.CloseHandle(snap)
    return procs


def logi_processes() -> list[dict]:
    return [{"name": n, "pid": p, "role": PROCESS_ROLES[n.lower()]}
            for n, p in list_processes() if n.lower() in PROCESS_ROLES]


def agent_pids() -> list[int]:
    return [p for n, p in list_processes() if n.lower() == AGENT_PROCESS]


# ---------------------------------------------------------------- document

def serialize(doc: dict) -> bytes:
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class Snapshot:
    doc: dict
    blob: bytes
    date_created: str
    sha256: str


def _open_ro(db: Path) -> sqlite3.Connection:
    if not db.is_file():
        raise StoreError(f"{db} not found. Is Logi Options+ installed for this user? "
                         "(Or point tools.logi-options.dataDir at a copy of the store.)")
    # mode=ro never writes the DB and never checkpoints the WAL; it only takes the
    # normal WAL read lock any concurrent reader takes.
    return sqlite3.connect("file:" + db.as_posix() + "?mode=ro", uri=True)


def read_db(db: Path) -> Snapshot:
    """Transactionally consistent read (SQLite backup API); safe while the agent runs."""
    src = _open_ro(db)
    mem = sqlite3.connect(":memory:")
    try:
        src.backup(mem)
    finally:
        src.close()
    try:
        count = mem.execute("select count(*) from data").fetchone()[0]
        row = mem.execute("select _date_created, file from data where _id = 1").fetchone()
    except sqlite3.DatabaseError as e:
        raise StoreError(f"{db} is not the expected Options+ store ({e}). Options+ changed its storage; "
                         "see docs/maintenance.md before using this tool.") from e
    finally:
        mem.close()
    if row is None or count != 1:
        raise StoreError(f"Expected exactly 1 row in settings.db `data`, found {count}. Options+ changed its "
                         "storage layout; see docs/maintenance.md before using this tool.")
    blob = bytes(row[1])
    doc = json.loads(blob.decode("utf-8"))
    if serialize(doc) != blob:
        raise StoreError("The settings document no longer round-trips byte-identically. Options+ changed its "
                         "JSON writer; writing is unsafe until docs/maintenance.md is followed.")
    return Snapshot(doc, blob, row[0], sha256(blob))


# ---------------------------------------------------------------- store

@dataclass
class Store:
    data_dir: Path

    @property
    def settings_db(self) -> Path:
        return self.data_dir / "settings.db"

    @property
    def live(self) -> bool:
        """True only for the real per-user store; the agent is never touched otherwise."""
        try:
            return self.data_dir.resolve() == LIVE_DATA_DIR.resolve()
        except OSError:
            return False

    def read(self) -> Snapshot:
        return read_db(self.settings_db)

    def agent_running(self) -> bool:
        return self.live and bool(agent_pids())

    def backup_to(self, dest: Path) -> None:
        """Standalone consistent copy (WAL folded in)."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        src = _open_ro(self.settings_db)
        out = sqlite3.connect(dest)
        try:
            src.backup(out)
        finally:
            src.close()
            out.close()

    def write(self, doc: dict, expected_sha: str) -> str:
        """Replace the document. Refuses while the agent runs and if the stored
        blob changed since it was read. Returns the new sha256."""
        if self.agent_running():
            raise StoreError("logioptionsplus_agent.exe is running and would overwrite this write. "
                             "Writes go through transaction.apply_change, which stops it first.")
        blob = serialize(doc)
        con = sqlite3.connect(self.settings_db, isolation_level=None)
        try:
            con.execute("begin immediate")
            current = bytes(con.execute("select file from data where _id = 1").fetchone()[0])
            if sha256(current) != expected_sha:
                con.execute("rollback")
                raise StoreError("settings.db changed since it was read. Nothing was written; run the command again.")
            con.execute("update data set file = ?, _date_created = current_timestamp where _id = 1", (blob,))
            con.execute("commit")
            check = bytes(con.execute("select file from data where _id = 1").fetchone()[0])
        finally:
            con.close()
        if check != blob:
            raise StoreError("Read-back after write does not match. Restore the backup named in the log.")
        return sha256(blob)

    # ------------------------------------------------------------ agent lifecycle

    def stop_agent(self, log: Log = _noop, timeout_s: float = 10.0) -> bool:
        """Force-stop the agent (and its children). Returns True if it was running.

        No polite attempt: the agent acknowledges `taskkill` without /F and keeps
        running (measured). A forced stop cannot corrupt the store - SQLite
        commits are durable - and every call site has just taken a backup."""
        if not self.live:
            return False
        pids = agent_pids()
        if not pids:
            return False
        t0 = time.monotonic()
        for pid in pids:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True, timeout=15)
        while agent_pids() and time.monotonic() - t0 < timeout_s:
            time.sleep(0.1)
        if agent_pids():
            raise StoreError("Could not stop logioptionsplus_agent.exe. Quit Logi Options+ from the tray and retry.")
        log("debug", f"agent stopped in {time.monotonic() - t0:.1f}s")
        return True

    def start_agent(self, log: Log = _noop, wait_s: float = 10.0) -> int | None:
        """Start the agent as the current user unless something already did."""
        if not self.live:
            return None
        running = agent_pids()
        if running:
            return running[0]
        if not AGENT_EXE.is_file():
            raise StoreError(f"{AGENT_EXE} not found. Start Logi Options+ manually (or reinstall it).")
        t0 = time.monotonic()
        subprocess.Popen([str(AGENT_EXE)], cwd=str(AGENT_EXE.parent), close_fds=True,
                         creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP)
        while time.monotonic() - t0 < wait_s:
            running = agent_pids()
            if running:
                log("debug", f"agent started in {time.monotonic() - t0:.1f}s (pid {running[0]})")
                return running[0]
            time.sleep(0.1)
        raise StoreError(f"Started {AGENT_EXE} but it is not running after {wait_s:.0f}s. "
                         "Start Logi Options+ manually.")


# ---------------------------------------------------------------- model helpers

def profiles(doc: dict) -> dict[str, dict]:
    return {k: doc[k] for k in doc.get("profile_keys", []) if k in doc}


def applications(doc: dict) -> list[dict]:
    return doc.get("applications", {}).get("applications", [])


def app_by_id(doc: dict) -> dict[str, dict]:
    return {a["applicationId"]: a for a in applications(doc)}
