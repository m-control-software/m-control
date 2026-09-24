"""One function per mode. Each returns the `result` payload; failures raise LogiError."""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import backup
import catalog as cat
import model
import packs
import protocol as pr
import store as st
import transaction
from errors import LogiError, SpecError

DEFAULT_DEVICE = "mx-master-4"


def cfg(config: dict, name: str, default=None):
    """RunContext.config is flat, keyed by the manifest's required/optional config entries."""
    for k in (f"logi-options.{name}", name):
        v = config.get(k)
        if v not in (None, "", []):
            return v
    return default


def _as_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        return [p for p in v.split(";") if p.strip()]
    return [str(p) for p in v]


def _log(level: str, message: str) -> None:
    pr.log(level, message)


class Ctx:
    def __init__(self, tool_input: dict, context: dict, tool_dir: Path, deadline: transaction.Deadline):
        config = context.get("config") or {}
        self.input = tool_input
        self.tool_dir = tool_dir
        self.deadline = deadline
        self.workspace = Path(context.get("workspaceRoot") or os.getcwd())
        self.pack_dirs = _as_list(cfg(config, "packDirs"))
        self.store = st.Store(Path(os.path.expandvars(cfg(config, "dataDir", str(st.LIVE_DATA_DIR)))))
        self.backups_dir = Path(os.path.expandvars(cfg(config, "backupDir", str(backup.DEFAULT_DIR))))
        self.device = str(tool_input.get("device") or DEFAULT_DEVICE)

    def need(self, key: str, example: str) -> str:
        v = self.input.get(key)
        if not v:
            raise SpecError(f"mode={self.input.get('mode')} needs {key}=..., e.g. {example}")
        return str(v)


def run(mode: str, tool_input: dict, context: dict, tool_dir: Path, deadline: transaction.Deadline) -> dict:
    ctx = Ctx(tool_input, context, tool_dir, deadline)
    handler = globals()[f"mode_{mode}"]
    out = handler(ctx)
    out.setdefault("mode", mode)
    return out


# ------------------------------------------------------------------ specs -> store

def _jobs(ctx: Ctx):
    files = packs.find_spec_files(ctx.pack_dirs, tool_dir=ctx.tool_dir)
    if not files:
        searched = [str(ctx.tool_dir / "specs")] + ctx.pack_dirs
        raise LogiError("No *.logi.json specs found. Searched: " + ", ".join(searched) +
                        ". Put your pack in a directory listed in tools.logi-options.packDirs "
                        "(~/.m-control/config.json); see the tool README.")
    _log("info", f"found {len(files)} spec file(s)")
    merged = packs.merge(files)
    doc = ctx.store.read().doc
    jobs, seen = [], {}
    for mp in merged:
        r = model.resolve_application(mp.application, doc)
        if r.profile_key in seen:
            raise SpecError(f"{mp.files[0]} and {seen[r.profile_key]} describe the same Options+ profile ({r.label}) "
                            "under different application identities; merge them.")
        seen[r.profile_key] = mp.files[0]
        for n in r.notes:
            _log("info", f"{r.label}: {n}")
        jobs.append((mp, r))
    return files, jobs


def _composed(ctx: Ctx, jobs):
    mutators = [model.build_mutator(mp.device, mp.buttons, r, ctx.store.data_dir) for mp, r in jobs]

    def mutate(doc: dict) -> dict:
        for m in mutators:
            doc = m(doc)
        return doc

    def verify(doc: dict) -> list[str]:
        return [p for mp, r in jobs for p in model.verify(mp.device, mp.buttons, r, doc, ctx.store.data_dir)]

    return mutate, verify


def _profile_summary(mp, r) -> dict:
    return {"profile": r.label, "profileKey": r.profile_key, "files": mp.files, "buttons": sorted(mp.buttons)}


def mode_check(ctx: Ctx) -> dict:
    files, jobs = _jobs(ctx)
    doc = ctx.store.read().doc
    profiles = []
    for mp, r in jobs:
        drift = (["profile does not exist yet"] if r.new_entry or r.profile_key not in doc
                 else model.verify(mp.device, mp.buttons, r, doc, ctx.store.data_dir))
        profiles.append({**_profile_summary(mp, r), "inSync": not drift, "drift": drift})
    mutate, verify = _composed(ctx, jobs)
    plan = transaction.apply_change(ctx.store, mutate, verify, ctx.backups_dir, "check", _log, ctx.deadline, dry_run=True)
    in_sync = all(p["inSync"] for p in profiles)
    _log("info" if in_sync else "warn", "in sync" if in_sync else "live configuration differs from the specs")
    return {"inSync": in_sync, "specs": [str(f) for f in files], "profiles": profiles,
            "planned": plan["planned"], "written": False}


def mode_apply(ctx: Ctx) -> dict:
    files, jobs = _jobs(ctx)
    mutate, verify = _composed(ctx, jobs)
    label = "apply-" + "-".join(sorted({Path(f).name.split(".")[0] for f in files}))[:40]
    res = transaction.apply_change(ctx.store, mutate, verify, ctx.backups_dir, label, _log, ctx.deadline)
    if not res["changed"]:
        _log("info", "already in sync; nothing written, agent not restarted")
    return {**res, "specs": [str(f) for f in files], "profiles": [_profile_summary(mp, r) for mp, r in jobs],
            "elapsedS": round(ctx.deadline.elapsed(), 1)}


# ------------------------------------------------------------------ store -> specs

def mode_export(ctx: Ctx) -> dict:
    handle = ctx.need("app", "app=all | app=global | app=rider64.exe")
    doc = ctx.store.read().doc
    keys = list(st.profiles(doc)) if handle == "all" else [model.find_profile(doc, h) for h in handle.split(",")]
    profiles, warnings = [], []
    for k in keys:
        spec, w = model.profile_to_spec(doc, k, ctx.device)
        profiles.append(spec)
        warnings += w
    for w in warnings:
        _log("warn", w)
    pack_id = str(ctx.input.get("pack") or "exported")
    stamp = dt.date.today().isoformat()
    document = packs.pack_document(pack_id, ctx.device, profiles, f"Exported from Logi Options+ on {stamp}.")
    out = ctx.input.get("out")
    if not out:
        return {"pack": document, "warnings": warnings, "written": None}
    path = Path(os.path.expandvars(str(out)))
    if not path.is_absolute():
        path = ctx.workspace / path
    if not path.name.endswith(packs.SUFFIX):
        raise SpecError(f"out must end in {packs.SUFFIX} so the tool can discover it, got '{path.name}'.")
    if path.exists() and not pr.parse_bool(ctx.input.get("force"), "force"):
        raise SpecError(f"{path} exists. Pass force=true to overwrite it.")
    path.parent.mkdir(parents=True, exist_ok=True)
    # LF on every OS: packs are diffed and synced, the bytes must not depend on the platform.
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    _log("info", f"wrote {len(profiles)} profile(s) to {path}")
    return {"written": str(path), "profiles": [p["application"] for p in profiles], "warnings": warnings}


def mode_remove(ctx: Ctx) -> dict:
    handles = ctx.need("app", "app=rider64.exe").split(",")
    doc = ctx.store.read().doc
    keys = [model.find_profile(doc, h) for h in handles]
    if f"profile-{st.GLOBAL_PROFILE_ID}" in keys:
        raise SpecError("The Global profile cannot be removed.")
    app_ids = {doc[k]["applicationId"] for k in keys}

    def mutate(d: dict) -> dict:
        for k in keys:
            d.pop(k, None)
            if k in d["profile_keys"]:
                d["profile_keys"].remove(k)
        referenced = {d[k].get("applicationId") for k in d["profile_keys"] if k in d}
        # Custom app entries go with their last profile; built-in entries belong to the agent.
        d["applications"]["applications"] = [
            a for a in st.applications(d)
            if not (a["applicationId"] in app_ids and a.get("isCustom") and a["applicationId"] not in referenced)]
        return d

    def verify(d: dict) -> list[str]:
        return [f"{k} still present" for k in keys if k in d or k in d.get("profile_keys", [])]

    res = transaction.apply_change(ctx.store, mutate, verify, ctx.backups_dir, "remove", _log, ctx.deadline)
    return {**res, "removed": keys}


# ------------------------------------------------------------------ backups

def mode_backup(ctx: Ctx) -> dict:
    return {"backup": str(backup.create(ctx.store, ctx.backups_dir, "manual"))}


def mode_backups(ctx: Ctx) -> dict:
    return {"backupDir": str(ctx.backups_dir), "backups": backup.list_backups(ctx.backups_dir)}


def mode_restore(ctx: Ctx) -> dict:
    src = backup.resolve(ctx.backups_dir, ctx.need("backup", "backup=latest"))
    return backup.restore(ctx.store, ctx.backups_dir, src, _log, ctx.deadline)


# ------------------------------------------------------------------ information

def mode_list(ctx: Ctx) -> dict:
    doc = ctx.store.read().doc
    defined: dict[str, list[str]] = {}
    specs = []
    try:
        files, jobs = _jobs(ctx)
        specs = [str(f) for f in files]
        defined = {r.profile_key: mp.files for mp, r in jobs}
    except LogiError as e:
        _log("warn", f"specs not loaded: {e}")
    live = []
    for k in st.profiles(doc):
        handle, name = model.profile_label(doc, k)
        live.append({"handle": handle, "name": name, "profileKey": k, "definedIn": defined.get(k)})
    return {"profiles": live, "specs": specs}


def mode_presets(ctx: Ctx) -> dict:
    gesture = model.default_gesture_card(ctx.device)
    return {
        "device": ctx.device,
        "buttons": list(cat.device(ctx.device)["buttons"]),
        "buttonAliases": cat.BUTTON_ALIASES,
        "actionForms": list(model.ACTION_KEYS),
        "gesturePresets": [k.replace("_", "-") for k in gesture.get("nestedCardsOrder", []) if k != cat.CUSTOM_GESTURE],
        "gestureDirections": list(cat.GESTURE_DIRECTIONS),
        "modifiers": list(cat.MODIFIERS),
        "keys": sorted(cat.KEYS),
        "builtinApps": sorted(cat.builtin_alias(a) for a in cat.builtin_apps()),
        "presets": dict(sorted(cat.preset_aliases().items())),
    }


def mode_inspect(ctx: Ctx) -> dict:
    snap = ctx.store.read()
    doc = snap.doc
    files = []
    for p in sorted(ctx.store.data_dir.glob("*")):
        if p.is_file():
            files.append({"path": str(p), "size": p.stat().st_size,
                          "modified": dt.datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds")})
    profiles = []
    for k in st.profiles(doc):
        spec, warnings = model.profile_to_spec(doc, k, ctx.device)
        profiles.append({"profileKey": k, **spec, "warnings": warnings})
    return {
        "store": {"path": str(ctx.store.settings_db), "live": ctx.store.live, "schemaVersion": doc.get("schema_version"),
                  "blobBytes": len(snap.blob), "blobSha256": snap.sha256, "lastSavedUtc": snap.date_created},
        "catalogBuild": cat.build_dir().name,
        "agentRunning": ctx.store.agent_running(),
        "processes": st.logi_processes(),
        "devicesEverConnected": sorted({d.get("slotPrefix", "?") for d in doc.get("ever_connected_devices", {}).get("devices", [])}),
        "files": files,
        "profiles": profiles,
    }
