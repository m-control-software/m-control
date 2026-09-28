"""Developer script (run directly, NOT via mctl): proof of concept that an Actions Ring
slot can be written from a spec. Experiment R5 in docs/actions-ring.md.

    python research/ring_poc.py [--slot 5] [--app @_defaultwin] [--shortcut CTRL+SHIFT+ESC]
                                [--form full|short|nolayout] [--dry-run]
    python research/ring_poc.py --rollback <backup dir>

Puts a keyboard-shortcut item into one slot of a Ring profile owned by LogiPluginService.exe
(experiments R5 and K2 in docs/actions-ring.md):

    Applications\\Loupedeck72\\<app>\\Profiles\\<defaultProfileName>\\ProfileInfo.json

Same guards as the tool (docs/maintenance.md, "refuse, not corrupt"):
- refuses unless the file re-serializes byte for byte and has the observed layout
  (one mode, one workspace, one press page, controls 0..7);
- a second run that would change nothing touches no process and writes nothing;
- backs up the profile directory to ~/.m-control/research/logi-options/ring-poc/
  before stopping anything;
- never writes while LogiPluginService or the agent runs (the agent is force-stopped
  with its process tree, which includes the plugin service), re-reads and compares
  the hash before writing, and restarts the agent in `finally`;
- afterwards watches the file for the owner's own re-save and checks that the item
  survived it.
"""
from __future__ import annotations

import argparse
import ctypes
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import store as st  # noqa: E402

LPS_DATA = Path(os.environ.get("LOCALAPPDATA", "")) / "Logi" / "LogiPluginService"
RING_DEVICE = "Loupedeck72"  # the Actions Ring's device type inside LogiPluginService
LPS_PROCESSES = {"logipluginservice.exe", "logipluginserviceext.exe"}
BACKUP_ROOT = Path.home() / ".m-control" / "research" / "logi-options" / "ring-poc"
# Deterministic action ids, like model.APP_NAMESPACE for custom apps. Chosen once.
RING_NAMESPACE = uuid.UUID("5b0f3c1e-7a42-4d7e-9c35-2f6a8e1d4b90")
SEP = "#¤%&+?"  # field separator inside the platform part of keyboardKey (observed)

# keyboardKey grammar (docs/actions-ring.md, K1), as the UI writes it ("full" form):
#   <logical>___<hkl>___<display>___win-<VK>#¤%&+?<flags>#¤%&+?<hkl>#¤%&+?<scan code>
# <hkl> is the keyboard layout (HKL, decimal) and <scan code> depends on it, so both are
# read from this machine. Modifiers in UI order: (spec name, logical, display, flag bit).
MODIFIERS = [("CTRL", "ControlOrCommand", "Ctrl", 128), ("ALT", "AltOrOption", "Alt", 2),
             ("WIN", "Windows", "Win", 8), ("SHIFT", "Shift", "Shift", 4)]  # Alt vs Win order: guessed
KEYS = {"ESC": ("Escape", "Escape", 0x1B)}
KEYS.update({chr(c): (f"Key{chr(c)}", chr(c), c) for c in range(ord("A"), ord("Z") + 1)})
KEYS.update({f"F{n}": (f"F{n}", f"F{n}", 0x6F + n) for n in range(1, 25)})
FORMS = {
    "full": "as the UI writes it",
    "short": "logical keys and display only: no layout, no platform part",
    "nolayout": "platform part kept (VK, flags, scan) but both layout fields empty",
}


def encode(shortcut: str, form: str = "full") -> tuple[str, str]:
    """'CTRL+SHIFT+Y' -> (keyboardKey, display text). Raises ValueError on anything unobserved."""
    *mods, key = [p.strip().upper() for p in shortcut.split("+")]
    if key not in KEYS or any(m not in {n for n, *_ in MODIFIERS} for m in mods) or len(set(mods)) != len(mods):
        raise ValueError(f"{shortcut}: only CTRL/ALT/WIN/SHIFT with A-Z, F1-F24 or ESC were observed")
    used = [m for m in MODIFIERS if m[0] in mods]
    logical_key, display_key, vk = KEYS[key]
    logical = "+".join([m[1] for m in used] + [logical_key])
    display = "+".join([m[2] for m in used] + [display_key])
    flags = sum(m[3] for m in used)
    hkl = ctypes.windll.user32.GetKeyboardLayout(0) & 0xFFFFFFFF
    scan = ctypes.windll.user32.MapVirtualKeyExW(vk, 0, ctypes.c_void_p(hkl))  # MAPVK_VK_TO_VSC
    if form == "short":
        return f"{logical}______{display}___", display
    layout = "" if form == "nolayout" else str(hkl)
    return f"{logical}___{layout}___{display}___win-{vk}{SEP}{flags}{SEP}{layout}{SEP}{scan}", display


def canonical(doc: dict) -> bytes:
    """Newtonsoft's indented output: 4 spaces, CRLF, non-ASCII verbatim, declared key order."""
    return json.dumps(doc, indent=4, ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def fail(msg: str) -> int:
    print(f"error: {msg}", file=sys.stderr)
    return 1


def lps_pids() -> list[int]:
    return [p for n, p in st.list_processes() if n.lower() in LPS_PROCESSES]


def profile_path(app: str) -> Path:
    app_dir = LPS_DATA / "Applications" / RING_DEVICE / app
    info = json.loads((app_dir / "ApplicationInfo.json").read_text(encoding="utf-8-sig"))
    name = info.get("defaultProfileName")
    if not name:
        raise ValueError(f"{app} has no defaultProfileName; pick the profile in the Options+ UI once")
    return app_dir / "Profiles" / name / "ProfileInfo.json"


def read_profile(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    doc = json.loads(raw.decode("utf-8"))
    if canonical(doc) != raw:
        raise ValueError(f"{path.name} no longer round-trips byte for byte; LogiPluginService changed its writer")
    modes = doc.get("layout", {}).get("layoutModes") or []
    if doc.get("deviceType") != RING_DEVICE or len(modes) != 1 or len(modes[0].get("workspaces") or []) != 1:
        raise ValueError("unexpected profile layout (device type, modes or workspaces); see docs/actions-ring.md")
    pages = modes[0]["workspaces"][0].get("pressPages") or []
    if len(pages) != 1 or [c.get("controlId") for c in pages[0].get("controls", [])] != list(range(8)):
        raise ValueError("unexpected Ring page: expected one press page with controls 0..7")
    return doc, raw


def controls(doc: dict) -> list[dict]:
    return doc["layout"]["layoutModes"][0]["workspaces"][0]["pressPages"][0]["controls"]


def action_for(key: str, display: str) -> dict:
    """A profile action in the exact key order the UI writes (R1)."""
    name = "$@Generic___@ProfileAction___" + uuid.uuid5(RING_NAMESPACE, "keyboard:" + key).hex.upper()
    return {
        "$type": "Loupedeck.Service.ApplicationProfileCommand, LoupedeckService",
        "isCommand": True,
        "name": name,
        "templateActionName": "$@Generic___@KeyboardKey",
        "actionParameters": {
            "$type": "Loupedeck.ActionEditorActionParameters, PluginApi",
            "parameters": {"$type": "Loupedeck.StringDictionaryNoCase, PluginApi", "keyboardKey": key},
            "count": 1,
        },
        "displayName": display,
        "description": "Activate a keyboard shortcut with a single press or hold down for continuous use "
                       "like a keyboard key",
        "groupName": "",
        "superGroupName": "@macro",
        "isProfileAction": True,
        "isMultiState": False,
        "isResetCommand": False,
        "adjustmentName": None,
        "states": None,
    }


def patch(doc: dict, slot: int, action: dict) -> list[str]:
    """Mutates doc; returns what changed (empty = already in the desired state)."""
    changes = []
    actions = doc.setdefault("profileActions", [])
    existing = next((a for a in actions if a.get("name") == action["name"]), None)
    if existing is None:
        actions.append(action)
        changes.append(f"+ profileActions[{action['name']}]")
    elif existing != action:
        actions[actions.index(existing)] = action
        changes.append(f"~ profileActions[{action['name']}]")
    ctl = controls(doc)[slot - 1]
    if ctl.get("pressAction") != action["name"]:
        changes.append(f"~ slot {slot} (controlId {slot - 1}): {ctl.get('pressAction')} -> {action['name']}")
        ctl["pressAction"] = action["name"]
    return changes


def backup(path: Path, label: str) -> Path:
    dest = BACKUP_ROOT / f"{dt.datetime.now().strftime('%Y%m%dT%H%M%S')}-{label}"
    shutil.copytree(path.parent, dest / "profile")
    manifest = {"source": str(path), "sha256": sha(path.read_bytes()), "created": dt.datetime.now().isoformat()}
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return dest


def with_owner_stopped(fn) -> None:
    """Stop the agent tree (it includes LogiPluginService), run fn, always start it again."""
    store = st.Store(st.LIVE_DATA_DIR)
    try:
        store.stop_agent(log=lambda lvl, msg: print(f"  {msg}"))
        t0 = time.monotonic()
        while lps_pids() and time.monotonic() - t0 < 10:
            time.sleep(0.1)
        if lps_pids() or st.agent_pids():
            raise RuntimeError("LogiPluginService or the agent is still running; nothing was written")
        fn()
    finally:
        store.start_agent(log=lambda lvl, msg: print(f"  {msg}"))


def watch(path: Path, written: bytes, seconds: float) -> bytes:
    """Wait for LogiPluginService to come back, then report every rewrite of the file."""
    t0 = time.monotonic()
    while not lps_pids() and time.monotonic() - t0 < 30:
        time.sleep(0.2)
    print(f"  LogiPluginService {'running' if lps_pids() else 'NOT running'} after {time.monotonic() - t0:.1f}s")
    last = written
    while time.monotonic() - t0 < seconds:
        cur = path.read_bytes()
        if cur != last:
            print(f"  t+{time.monotonic() - t0:.1f}s: file rewritten ({sha(last)[:12]} -> {sha(cur)[:12]})")
            last = cur
        time.sleep(0.5)
    return last


def rollback(src: Path) -> int:
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    target = Path(manifest["source"])
    good = (src / "profile" / target.name).read_bytes()
    if sha(good) != manifest["sha256"]:
        return fail(f"{src} does not match its manifest; refusing to restore it")
    if target.read_bytes() == good:
        print("already identical to the backup; nothing to do")
        return 0
    with_owner_stopped(lambda: target.write_bytes(good))
    print(f"restored {target} from {src}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slot", type=int, default=5, help="Ring slot 1..8 (UI order, clockwise from the top)")
    ap.add_argument("--app", default="@_defaultwin", help="LPS application: @_defaultwin = Global, or e.g. 7zfm")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--watch", type=float, default=45.0, help="seconds to watch for the owner's re-save")
    ap.add_argument("--rollback", metavar="BACKUP_DIR")
    ap.add_argument("--shortcut", default="CTRL+SHIFT+ESC", help="CTRL/ALT/WIN/SHIFT + A-Z, F1-F24 or ESC")
    ap.add_argument("--form", choices=sorted(FORMS), default="full",
                    help="; ".join(f"{k}: {v}" for k, v in FORMS.items()))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if args.rollback:
        return rollback(Path(args.rollback))
    if not 1 <= args.slot <= 8:
        return fail("--slot must be 1..8")
    try:
        path = profile_path(args.app)
        doc, raw = read_profile(path)
        action = action_for(*encode(args.shortcut, args.form))
    except (OSError, ValueError) as e:
        return fail(str(e))

    changes = patch(doc, args.slot, action)
    print(f"profile: {path}\nkeyboardKey: {action['actionParameters']['parameters']['keyboardKey']}")
    if not changes:
        print("already in the desired state; nothing written, no process touched")
        return 0
    print("\n".join("  " + c for c in changes))
    if args.dry_run:
        return 0

    new = canonical(doc)
    dest = backup(path, "pre-ring-poc")
    print(f"backup: {dest}")

    def write() -> None:
        if sha(path.read_bytes()) != sha(raw):
            raise RuntimeError(f"{path.name} changed since it was read; nothing was written")
        tmp = path.with_suffix(".json.ring-poc-tmp")
        tmp.write_bytes(new)
        os.replace(tmp, path)
        if path.read_bytes() != new:
            raise RuntimeError(f"read-back mismatch; roll back with --rollback {dest}")
        print(f"  wrote {len(new)} bytes ({sha(new)[:12]})")

    with_owner_stopped(write)
    final = watch(path, new, args.watch)
    try:
        kept_doc, _ = read_profile(path)
        kept = patch(kept_doc, args.slot, action) == []
    except ValueError as e:
        print(f"the owner's re-save fails the guards: {e}")
        kept = False
    print(f"byte-identical to what was written: {final == new}")
    print(f"item kept (slot {args.slot} -> {action['name']}, action body unchanged): {kept}")
    if not kept:
        print(f"NOT kept. Roll back: python research/ring_poc.py --rollback {dest}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
