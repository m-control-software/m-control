"""Portable profile <-> Logitech representation (compiler + decompiler).

A portable profile (docs/spec-format.md is the reference) names buttons and
actions only - never slot ids, card bodies or UUIDs:

    {"application": {"executable": "rider64.exe", "name": "Rider"},
     "buttons": {"back": {"shortcut": "ALT+LEFT"},
                 "thumb": {"gestures": {"left": {"shortcut": "CTRL+SHIFT+TAB"}}}}}

The decompiler is also the verifier: two assignments are "the same" when they
decompile to the same portable action. That ignores UI metadata (tags, icons,
taskId) which differs between Options+ versions and is not behaviour.
"""
from __future__ import annotations

import copy
import os
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import catalog as cat
import store as st
from errors import SpecError

ACTION_KEYS = ("shortcut", "preset", "card", "nothing", "raw", "gestures")
APPLICATION_KINDS = ("global", "builtin", "executable")
COSMETIC = {"tags", "icons", "name", "taskId", "readOnly", "category", "applicationId", "actionName"}
# Deterministic custom-application ids: UUIDv5 of the lower-cased executable file
# name. Same id on every machine and on every re-import. Changing this namespace
# orphans every profile created with the old one - don't. The URL is only a
# namespace label (it names the proof of concept this came from), not a location.
APP_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://github.com/m-control/logi-options-poc/custom-application")


# ------------------------------------------------------------------ cards

def assignment(slot_id: str, card: dict) -> dict:
    return {"card": card, "cardId": card["id"], "slotId": slot_id, "tags": list(cat.ASSIGNMENT_TAGS)}


def catalog_card(card_id: str, app_id: str | None) -> dict:
    c = cat.app_card(app_id, card_id)
    if c is None:
        raise SpecError(f"Card '{card_id}' is not in this Options+ catalog (build {cat.build_dir().name}).")
    return cat.normalize(c)


def shortcut_card(text: str) -> dict:
    card = catalog_card(cat.KEYBOARD_SHORTCUT_CARD, None)
    card["macro"]["keystroke"] = cat.normalize(cat.parse_shortcut(text))
    return card


def _special_keys(dev: str) -> dict:
    for c in cat.device_package(dev, "default_configurations.json")["defaultConfigurations"]:
        if c.get("header", {}).get("type", "").startswith("SPECIAL_KEYS"):
            return c["settings"]["control_id_mappings"]
    raise SpecError(f"No SPECIAL_KEYS defaults in the {dev} device package; see docs/maintenance.md.")


def default_gesture_card(dev: str) -> dict:
    for card in _special_keys(dev).values():
        if card.get("id") == cat.GESTURE_CARD:
            return cat.normalize(card)
    return catalog_card(cat.GESTURE_CARD, None)


def _check_action(action, where: str, allow_gestures: bool) -> None:
    if not isinstance(action, dict):
        raise SpecError(f"{where}: expected an action object like {{\"shortcut\": \"CTRL+C\"}}, got {action!r}.")
    keys = [k for k in action if k in ACTION_KEYS]
    unknown = [k for k in action if k not in ACTION_KEYS]
    if unknown:
        raise SpecError(f"{where}: unknown field(s) {unknown}. An action is exactly one of: {', '.join(ACTION_KEYS)}.")
    if len(keys) != 1:
        raise SpecError(f"{where}: an action needs exactly one of {', '.join(ACTION_KEYS)}; got {keys or 'none'}. "
                        "(A button cannot be a shortcut and a gesture button at the same time.)")
    if keys[0] == "gestures" and not allow_gestures:
        raise SpecError(f"{where}: gestures are only possible on the thumb button, not here.")


def action_card(action: dict, app_id: str | None, where: str) -> dict:
    """Compile one non-gesture action to a Logitech card."""
    _check_action(action, where, allow_gestures=False)
    (kind, value), = action.items()
    if kind == "shortcut":
        return shortcut_card(str(value))
    if kind == "preset":
        cid = cat.preset_aliases().get(str(value))
        if not cid:
            raise SpecError(f"{where}: unknown preset '{value}'. List them: mctl run logi-options mode=presets")
        return catalog_card(cid, app_id)
    if kind == "card":
        return catalog_card(str(value), app_id)
    if kind == "nothing":
        return catalog_card(cat.DO_NOTHING_CARD, None)
    if not isinstance(value, dict) or "id" not in value:  # raw
        raise SpecError(f"{where}: a raw card must be an object with an 'id'.")
    return cat.normalize(value)


def gesture_card(dev: str, gestures, app_id: str | None, base: dict | None, where: str) -> dict:
    card = copy.deepcopy(base) if base and base.get("id") == cat.GESTURE_CARD else default_gesture_card(dev)
    nested = card.get("nestedCards", {})
    if isinstance(gestures, str):
        name = gestures.replace("-", "_")
        if name not in nested or name == cat.CUSTOM_GESTURE:
            choices = ", ".join(k.replace("_", "-") for k in card.get("nestedCardsOrder", nested)
                                if k != cat.CUSTOM_GESTURE)
            raise SpecError(f"{where}: unknown gesture preset '{gestures}'. Presets: {choices}; "
                            "or give up/down/left/right/click actions for custom gestures.")
        card["selectedNestedCard"] = name
        return card
    if not isinstance(gestures, dict) or not gestures:
        raise SpecError(f"{where}: gestures must be a preset name or a map of {', '.join(cat.GESTURE_DIRECTIONS)}.")
    bad = set(gestures) - set(cat.GESTURE_DIRECTIONS)
    if bad:
        raise SpecError(f"{where}: unknown gesture direction(s) {sorted(bad)}; "
                        f"use {', '.join(cat.GESTURE_DIRECTIONS)}.")
    default_custom = default_gesture_card(dev)["nestedCards"][cat.CUSTOM_GESTURE]
    custom = nested.setdefault(cat.CUSTOM_GESTURE, copy.deepcopy(default_custom))
    inner = custom.setdefault("nestedCards", {})
    for d in cat.GESTURE_DIRECTIONS:
        # Declarative: a direction the spec does not mention goes back to "do nothing".
        inner[d] = action_card(gestures[d], app_id, f"{where}.{d}") if d in gestures \
            else copy.deepcopy(default_custom["nestedCards"][d])
    card["selectedNestedCard"] = cat.CUSTOM_GESTURE
    return card


def compile_button(dev: str, button: str, action, app_id: str | None, existing: dict | None) -> dict:
    slot = cat.button_slot(dev, button)
    where = f"buttons.{button}"
    if isinstance(action, dict) and "gestures" in action:
        if cat.BUTTON_ALIASES.get(button, button) != "thumb":
            raise SpecError(f"{where}: gestures are only possible on the thumb (gesture) button.")
        _check_action(action, where, allow_gestures=True)
        previous = existing["card"] if existing else None
        return assignment(slot, gesture_card(dev, action["gestures"], app_id, previous, where))
    return assignment(slot, action_card(action, app_id, where))


# ------------------------------------------------------------------ decompile

def _behaviour(v):
    if isinstance(v, dict):
        return {k: _behaviour(x) for k, x in v.items() if k not in COSMETIC}
    if isinstance(v, list):
        return [_behaviour(x) for x in v]
    return v


def card_action(card: dict, app_id: str | None) -> dict:
    """Most portable action form for a stored card: shortcut > preset > card > raw."""
    cid = card.get("id")
    macro = card.get("macro") or {}
    if cid == cat.GESTURE_CARD:
        sel = card.get("selectedNestedCard", "")
        if sel != cat.CUSTOM_GESTURE:
            return {"gestures": sel.replace("_", "-")}
        inner = card.get("nestedCards", {}).get(cat.CUSTOM_GESTURE, {}).get("nestedCards", {})
        dirs = {d: card_action(inner[d], app_id) for d in cat.GESTURE_DIRECTIONS if d in inner}
        dirs = {d: a for d, a in dirs.items() if a != {"nothing": True}}
        return {"gestures": dirs or {"click": {"nothing": True}}}
    if macro.get("type") == "DO_NOTHING":
        return {"nothing": True}
    if cid == cat.KEYBOARD_SHORTCUT_CARD:
        s = cat.format_shortcut(macro.get("keystroke", {}))
        return {"shortcut": s} if s else {"raw": card}
    ref = cat.app_card(app_id, cid) if cid else None
    if ref is not None and _behaviour(cat.normalize(ref)) == _behaviour(cat.normalize(card)):
        alias = cat.alias_for(cid)
        return {"preset": alias} if alias else {"card": cid}
    if macro.get("type") == "KEYSTROKE":
        s = cat.format_shortcut(macro.get("keystroke", {}))
        if s:
            return {"shortcut": s}
    return {"raw": card}


def canonical(action, dev: str, button: str, app_id: str | None) -> dict:
    """What a spec entry means (aliases resolved, shortcut spelling normalised)."""
    return card_action(compile_button(dev, button, action, app_id, None)["card"], app_id)


# ------------------------------------------------------------------ defaults for new profiles

def default_assignments(dev: str, app_id: str) -> list[dict]:
    """What Options+ puts in a newly created app profile: device control defaults,
    overlaid with the Global then the app's entries in defaults_slot.json.
    Verified against a profile the UI created (test_model.py)."""
    prefix = cat.device(dev)["slotPrefix"]
    button_slots = {cat.button_slot(dev, b) for b in cat.device(dev)["buttons"]}
    by_slot = {f"{prefix}_c{cid}": card for cid, card in _special_keys(dev).items()
               if f"{prefix}_c{cid}" in button_slots}
    defaults = cat.device_package(dev, "defaults_slot.json")["defaults"]
    for scope in (st.GLOBAL_PROFILE_ID, app_id):
        for d in defaults.get(scope, {}).get("defaultAssignment", []):
            c = cat.app_card(app_id, d["cardInfo"])
            if d["id"] in button_slots and c is not None:
                by_slot[d["id"]] = c
    return [assignment(slot, cat.normalize(by_slot[slot])) for slot in sorted(by_slot)]


# ------------------------------------------------------------------ applications

@dataclass
class ResolvedApp:
    app_id: str
    profile_key: str
    label: str
    new_entry: dict | None = None
    notes: list[str] = field(default_factory=list)


def application_key(spec_app: dict) -> str:
    """Identity used to merge profiles across packs."""
    validate_application(spec_app, "application")
    if "global" in spec_app:
        return "global"
    if "builtin" in spec_app:
        return "builtin:" + cat.builtin_app_id(str(spec_app["builtin"]))
    return "executable:" + str(spec_app["executable"]).lower()


def validate_application(spec_app, where: str) -> None:
    if not isinstance(spec_app, dict):
        raise SpecError(f"{where}: expected {{\"global\": true}} | {{\"builtin\": name}} | "
                        f"{{\"executable\": \"file.exe\"}}.")
    kinds = [k for k in APPLICATION_KINDS if k in spec_app]
    extra = set(spec_app) - set(APPLICATION_KINDS) - {"name", "searchPaths"}
    if len(kinds) != 1 or extra:
        raise SpecError(f"{where}: need exactly one of global/builtin/executable (got {kinds or 'none'}); "
                        f"unknown fields: {sorted(extra) or 'none'}.")
    if kinds[0] == "global" and spec_app["global"] is not True:
        raise SpecError(f"{where}.global must be true.")
    if kinds[0] == "builtin":
        cat.builtin_app_id(str(spec_app["builtin"]))  # raises with the list of built-ins
    if kinds[0] == "executable":
        exe = str(spec_app["executable"])
        if "\\" in exe or "/" in exe or not exe.lower().endswith(".exe"):
            raise SpecError(f"{where}.executable must be a file name like rider64.exe, not '{exe}'. "
                            "Put directories in searchPaths.")
    if "searchPaths" in spec_app and not isinstance(spec_app["searchPaths"], list):
        raise SpecError(f"{where}.searchPaths must be a list of directories.")


def _find_executable(exe: str, hints: list[str]) -> str | None:
    for h in hints:
        p = Path(os.path.expandvars(h)) / exe
        if p.is_file():
            return str(p)
    w = shutil.which(exe)
    if w:
        return w
    roots = [os.environ.get("LOCALAPPDATA", "") + r"\Programs", os.environ.get("ProgramFiles", ""),
             os.environ.get("ProgramFiles(x86)", ""), os.environ.get("LOCALAPPDATA", "") + r"\JetBrains\Toolbox\apps"]
    for root in filter(None, roots):
        base_depth = root.rstrip("\\").count("\\")
        for dirpath, dirnames, filenames in os.walk(root):
            if dirpath.count("\\") - base_depth >= 4:
                dirnames[:] = []
            dirnames[:] = [d for d in dirnames if d.lower() not in {"windowsapps", "windows defender", "common files"}]
            for f in filenames:
                if f.lower() == exe.lower():
                    return str(Path(dirpath) / f)
    return None


def generalize_dir(path: str) -> str:
    """c:\\users\\me\\appdata\\local\\programs\\rider\\bin\\x.exe -> %LOCALAPPDATA%\\Programs\\Rider\\bin"""
    real = str(Path(path).parent)
    try:
        real = str(Path(real).resolve())
    except OSError:
        pass
    for var in ("LOCALAPPDATA", "APPDATA", "ProgramFiles(x86)", "ProgramFiles", "USERPROFILE"):
        v = os.environ.get(var)
        if v and real.lower().startswith(v.lower() + "\\"):
            return f"%{var}%" + real[len(v):]
    return real


def resolve_application(spec_app: dict, doc: dict) -> ResolvedApp:
    validate_application(spec_app, "application")
    if "global" in spec_app:
        return ResolvedApp(st.GLOBAL_PROFILE_ID, f"profile-{st.GLOBAL_PROFILE_ID}", "Global (all applications)")
    if "builtin" in spec_app:
        app_id = cat.builtin_app_id(str(spec_app["builtin"]))
        r = ResolvedApp(app_id, f"profile-{app_id}", cat.builtin_apps()[app_id].get("name", app_id))
        if app_id not in st.app_by_id(doc):
            r.notes.append(f"{r.label} is not detected on this machine yet; the profile is stored but only applies "
                           "once Options+ detects the application (unverified behaviour).")
        return r
    exe = str(spec_app["executable"])
    for a in st.applications(doc):
        paths = a.get("applicationPathsList", [a.get("applicationPath", "")])
        if any(Path(p).name.lower() == exe.lower() for p in paths):
            r = ResolvedApp(a["applicationId"], f"profile-{a['applicationId']}", a.get("name", exe))
            r.notes.append(f"reusing application entry {a['applicationId']} ({a.get('applicationPath')})")
            return r
    path = _find_executable(exe, list(spec_app.get("searchPaths", [])))
    if not path:
        raise SpecError(f"Could not find {exe} on this machine (searched searchPaths, PATH, Program Files, "
                        "%LOCALAPPDATA%\\Programs, JetBrains Toolbox). Install it, or add its folder to searchPaths.")
    app_id = str(uuid.uuid5(APP_NAMESPACE, exe.lower()))
    p = path.lower()  # the agent stores lower-cased paths
    entry = {"applicationId": app_id, "applicationPath": p, "applicationPathsList": [p], "isCustom": True,
             "name": str(spec_app.get("name") or Path(exe).stem)}
    r = ResolvedApp(app_id, f"profile-{app_id}", entry["name"], new_entry=entry)
    r.notes.append(f"new custom application {app_id} -> {path}")
    return r


def icon_fields(doc: dict, entry: dict, data_dir: Path) -> dict:
    """posterPath/posterUrl as the UI writes them when an app is added by hand.
    The profile tab icon reads these and the agent never back-fills them. The
    agent's icon cache is <data dir>\\icon_cache\\sha256(lower-cased path).png,
    extracted for every executable it has seen. Machine-specific by
    construction, so derived at import time and never exported."""
    path = entry.get("applicationPath", "")
    cached = doc.get("iconsLocalPathCache", {}).get(path) or \
        str(data_dir / "icon_cache" / (st.sha256(path.encode("utf-8")) + ".png"))
    if not path or not Path(cached).is_file():
        return {}
    return {"posterPath": cached, "posterUrl": "poster://" + cached.replace("\\", "/")}


# ------------------------------------------------------------------ validation

def validate_profile(dev: str, profile, where: str) -> None:
    if not isinstance(profile, dict):
        raise SpecError(f"{where}: a profile must be an object with application and buttons.")
    extra = set(profile) - {"application", "buttons", "description"}
    if extra:
        raise SpecError(f"{where}: unknown field(s) {sorted(extra)}.")
    validate_application(profile.get("application"), f"{where}.application")
    buttons = profile.get("buttons")
    if not isinstance(buttons, dict) or not buttons:
        raise SpecError(f"{where}.buttons: expected a non-empty object of button -> action.")
    seen: dict[str, str] = {}
    for b, action in buttons.items():
        slot = cat.button_slot(dev, b)
        if slot in seen:
            raise SpecError(f"{where}: buttons.{b} and buttons.{seen[slot]} are the same physical button.")
        seen[slot] = b
        compile_button(dev, b, action, None, None)  # full compile = full validation


# ------------------------------------------------------------------ profile handles

def profile_label(doc: dict, key: str) -> tuple[str, str]:
    """(handle, display name). Handle = global | built-in alias | executable file name."""
    app_id = doc[key].get("applicationId", "")
    if app_id == st.GLOBAL_PROFILE_ID:
        return "global", "Global (all applications)"
    if app_id in cat.builtin_apps():
        return cat.builtin_alias(app_id), cat.builtin_apps()[app_id].get("name", app_id)
    entry = st.app_by_id(doc).get(app_id, {})
    exe = Path(entry.get("applicationPath", "")).name or app_id
    return exe, entry.get("name", exe)


def find_profile(doc: dict, handle: str) -> str:
    for key in st.profiles(doc):
        h, _ = profile_label(doc, key)
        if handle.lower() in (h.lower(), doc[key].get("applicationId", "").lower(), key.lower()):
            return key
    known = ", ".join(profile_label(doc, k)[0] for k in st.profiles(doc))
    raise SpecError(f"No profile for '{handle}'. Profiles on this machine: {known}.")


# ------------------------------------------------------------------ export / apply / verify

def profile_to_spec(doc: dict, profile_key: str, dev: str) -> tuple[dict, list[str]]:
    prof = doc[profile_key]
    app_id = prof.get("applicationId")
    warnings = []
    if app_id == st.GLOBAL_PROFILE_ID:
        app = {"global": True}
    elif app_id in cat.builtin_apps():
        app = {"builtin": cat.builtin_alias(app_id)}
    else:
        entry = st.app_by_id(doc).get(app_id)
        if not entry or not entry.get("applicationPath"):
            raise SpecError(f"{profile_key} points at application {app_id}, which has no executable path.")
        app = {"executable": Path(entry["applicationPath"]).name, "name": entry.get("name"),
               "searchPaths": [generalize_dir(entry["applicationPath"])]}
    buttons = {}
    by_slot = {a["slotId"]: a for a in prof["assignments"]}
    for b in cat.device(dev)["buttons"]:
        a = by_slot.get(cat.button_slot(dev, b))
        if a:
            buttons[b] = card_action(a["card"], app_id)
            if "'raw'" in repr(buttons[b]):
                warnings.append(f"{profile_key} buttons.{b}: exported as a raw Logitech card (no portable form); "
                                "it may not survive Options+ updates.")
    return {"application": app, "buttons": buttons}, warnings


def build_mutator(dev: str, buttons: dict, r: ResolvedApp, data_dir: Path):
    def mutate(doc: dict) -> dict:
        if r.new_entry and r.app_id not in st.app_by_id(doc):
            doc["applications"]["applications"].append(copy.deepcopy(r.new_entry))
        entry = st.app_by_id(doc).get(r.app_id)
        if entry is not None and entry.get("isCustom") and "posterPath" not in entry:
            entry.update(icon_fields(doc, entry, data_dir))
        if r.profile_key not in doc:
            doc[r.profile_key] = {"applicationId": r.app_id, "assignments": default_assignments(dev, r.app_id),
                                  "baseProfileId": st.GLOBAL_PROFILE_ID, "id": r.app_id}
        if r.profile_key not in doc["profile_keys"]:
            doc["profile_keys"].append(r.profile_key)
            doc["profile_keys"].sort()  # the agent keeps this list sorted
        assignments = doc[r.profile_key]["assignments"]
        for button, action in buttons.items():
            slot = cat.button_slot(dev, button)
            idx = next((i for i, a in enumerate(assignments) if a["slotId"] == slot), None)
            existing = assignments[idx] if idx is not None else None
            desired = compile_button(dev, button, action, r.app_id, existing)
            if existing and card_action(existing["card"], r.app_id) == card_action(desired["card"], r.app_id):
                continue  # already means the same thing: keep the agent's bytes (minimal + idempotent)
            if idx is None:
                assignments.append(desired)
            else:
                assignments[idx] = desired
        return doc

    return mutate


def verify(dev: str, buttons: dict, r: ResolvedApp, doc: dict, data_dir: Path) -> list[str]:
    if r.profile_key not in doc or r.profile_key not in doc.get("profile_keys", []):
        return [f"{r.label}: profile {r.profile_key} missing (or not in profile_keys)"]
    problems = []
    entry = st.app_by_id(doc).get(r.app_id)
    if r.new_entry and entry is None:
        problems.append(f"{r.label}: application entry {r.app_id} is missing")
    if entry and entry.get("isCustom") and "posterPath" not in entry and icon_fields(doc, entry, data_dir):
        problems.append(f"{r.label}: application entry {r.app_id} has no icon fields")
    by_slot = {a["slotId"]: a for a in doc[r.profile_key]["assignments"]}
    for button, action in buttons.items():
        want = canonical(action, dev, button, r.app_id)
        a = by_slot.get(cat.button_slot(dev, button))
        got = card_action(a["card"], r.app_id) if a else None
        if got != want:
            problems.append(f"{r.label}: buttons.{button} should be {want}, is {got}")
    return problems
