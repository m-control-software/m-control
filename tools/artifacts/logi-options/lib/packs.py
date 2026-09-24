"""Spec discovery and merge.

A pack is a directory holding one or more *.logi.json files. Packs live
wherever their owner keeps them (a personal root, a client's repo) and are
registered through tools.logi-options.packDirs, so nothing personal or
client-owned has to enter this repository. Mirrors stream-deck's packs.

Discovery:
    the tool's own directory:  specs/*.logi.json only (never examples/ or test/)
    every packDir:             <dir>/*.logi.json, <dir>/specs/*.logi.json,
                               <dir>/<sub>/*.logi.json, <dir>/<sub>/specs/*.logi.json
so a packDir may be one pack or a root holding several (e.g. m-control-personal).

Merge rules:
  - profiles are keyed by (device, application); several packs may contribute
    buttons to the same profile
  - the same button on the same profile from two places is a hard error,
    never a silent overwrite
  - a pack that is absent contributes nothing
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import catalog as cat
import model
from errors import SpecError

SUFFIX = ".logi.json"
SPEC_VERSION = 1


@dataclass
class MergedProfile:
    device: str
    application: dict
    buttons: dict = field(default_factory=dict)          # button -> action
    sources: dict = field(default_factory=dict)          # button -> "file#profiles[i]"
    files: list = field(default_factory=list)


def find_spec_files(search_dirs: list[str], tool_dir: Path | None = None) -> list[Path]:
    found: set[Path] = set()
    if tool_dir is not None and (tool_dir / "specs").is_dir():
        found.update(p.resolve() for p in (tool_dir / "specs").glob("*" + SUFFIX) if p.is_file())
    for raw in search_dirs:
        if not raw or not str(raw).strip():
            continue
        d = Path(os.path.expandvars(str(raw).strip()))
        if not d.is_dir():
            continue  # the "pack absent" case, not an error
        candidates = [d, d / "specs"]
        for sub in d.iterdir():
            if sub.is_dir() and not sub.name.startswith("."):
                candidates += [sub, sub / "specs"]
        for c in candidates:
            if c.is_dir():
                found.update(p.resolve() for p in c.glob("*" + SUFFIX) if p.is_file())
    return sorted(found, key=lambda p: str(p).lower())


def load_pack(path: Path) -> dict:
    try:
        spec = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as e:
        raise SpecError(f"{path}: invalid JSON ({e}).") from e
    if not isinstance(spec, dict):
        raise SpecError(f"{path}: expected a JSON object.")
    extra = set(spec) - {"specVersion", "pack", "device", "description", "profiles"}
    if extra:
        raise SpecError(f"{path}: unknown top-level field(s) {sorted(extra)}.")
    if spec.get("specVersion") != SPEC_VERSION:
        raise SpecError(f"{path}: specVersion must be {SPEC_VERSION}, got {spec.get('specVersion')!r}.")
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", str(spec.get("pack", ""))):
        raise SpecError(f"{path}: pack must be a kebab-case id, got {spec.get('pack')!r}.")
    cat.device(str(spec.get("device", "")))
    profiles = spec.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise SpecError(f"{path}: profiles must be a non-empty list.")
    for i, p in enumerate(profiles):
        model.validate_profile(spec["device"], p, f"{path.name}#profiles[{i}]")
    return spec


def merge(files: list[Path]) -> list[MergedProfile]:
    merged: dict[tuple[str, str], MergedProfile] = {}
    for path in files:
        spec = load_pack(path)
        dev = spec["device"]
        for i, p in enumerate(spec["profiles"]):
            where = f"{path}#profiles[{i}]"
            key = (dev, model.application_key(p["application"]))
            mp = merged.get(key)
            if mp is None:
                mp = merged[key] = MergedProfile(dev, dict(p["application"]))
            else:
                _merge_application(mp, p["application"], where)
            if str(path) not in mp.files:
                mp.files.append(str(path))
            for button, action in p["buttons"].items():
                canonical_button = cat.BUTTON_ALIASES.get(button, button)
                if canonical_button in mp.buttons:
                    raise SpecError(f"Button '{canonical_button}' of {key[1]} is set twice: in "
                                    f"{mp.sources[canonical_button]} and in {where}. Remove one of them.")
                mp.buttons[canonical_button] = action
                mp.sources[canonical_button] = where
    return list(merged.values())


def _merge_application(mp: MergedProfile, app: dict, where: str) -> None:
    if app.get("name") and mp.application.get("name") and app["name"] != mp.application["name"]:
        raise SpecError(f"{where}: application name '{app['name']}' conflicts with "
                        f"'{mp.application['name']}' from {mp.files[0]}.")
    if app.get("name"):
        mp.application["name"] = app["name"]
    paths = list(mp.application.get("searchPaths", []))
    paths += [s for s in app.get("searchPaths", []) if s not in paths]
    if paths:
        mp.application["searchPaths"] = paths


def pack_document(pack: str, device: str, profiles: list[dict], description: str | None = None) -> dict:
    doc = {"specVersion": SPEC_VERSION, "pack": pack, "device": device}
    if description:
        doc["description"] = description
    doc["profiles"] = profiles
    return doc
