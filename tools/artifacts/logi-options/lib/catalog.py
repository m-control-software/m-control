"""Read-only access to the catalogs Options+ ships in %PROGRAMDATA%\\LogiOptionsPlus\\depots.

These are Logitech's own definitions of cards (actions), built-in applications
and per-device defaults. The compiler builds cards from them the same way the
UI does (docs/internals.md "How the UI builds a card"), so generated profiles
track the installed Options+ version instead of a frozen copy. Nothing from
these catalogs is copied into the repository.
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path

from errors import CatalogError, SpecError
from keys import (  # noqa: F401  (re-exported: catalog.KEYS, catalog.parse_shortcut, ...)
    CODE_TO_KEY, KEY_ALIASES, KEYS, MOD_TO_NAME, MODIFIER_ALIASES, MODIFIERS, format_shortcut, parse_shortcut)
from store import PROGRAM_DATA

DEPOTS = PROGRAM_DATA / "depots"

# Device table. slotPrefix/modelId/package verified on this machine
# (ever_connected_devices, depots/<build>/<package>/manifest.json).
DEVICES = {
    "mx-master-4": {
        "modelId": "2b042",
        "slotPrefix": "mx-master-4-2b042",
        "package": "2334eaeb-eeeb-4249-abfd-67002f421230",
        # portable name -> slot suffix (core_metadata.json device_buttons_image)
        "buttons": {
            "middle": "c82",               # SLOT_NAME_MIDDLE_BUTTON / WHEEL_BUTTON
            "top": "c196",                 # SLOT_NAME_MODESHIFT_BUTTON / TOP_BUTTON
            "thumb-wheel": "thumb_wheel_adapter",
            "forward": "c86",
            "back": "c83",
            "thumb": "c195",               # SLOT_NAME_GESTURE_BUTTON / THUMB_BUTTON
            "haptic-panel": "c416",        # haptic sense panel (default: Actions Ring)
        },
    },
}
BUTTON_ALIASES = {"gesture": "thumb", "gesture-button": "thumb", "mode-shift": "top", "mode-shift-button": "top",
                  "wheel": "middle", "middle-button": "middle", "thumbwheel": "thumb-wheel",
                  "sense-panel": "haptic-panel", "actions-ring": "haptic-panel"}
GESTURE_DIRECTIONS = ("up", "down", "left", "right", "click")
KEYBOARD_SHORTCUT_CARD = "card_global_presets_keyboard_shortcut"
DO_NOTHING_CARD = "card_global_presets_do_nothing"
GESTURE_CARD = "card_global_presets_one_of_gesture_button"
CUSTOM_GESTURE = "custom_gesture"
ASSIGNMENT_TAGS = ["UI_PAGE_BUTTONS"]  # every button assignment the UI writes carries this


def available() -> bool:
    """False when Options+ is not installed (tests skip catalog-dependent checks)."""
    try:
        build_dir()
        return True
    except CatalogError:
        return False


@functools.cache
def build_dir() -> Path:
    if not DEPOTS.is_dir():
        raise CatalogError(f"{DEPOTS} not found. Is Logi Options+ installed on this machine?")
    builds = sorted((p for p in DEPOTS.iterdir() if p.is_dir() and p.name.isdigit()), key=lambda p: int(p.name))
    if not builds:
        raise CatalogError(f"No Options+ build under {DEPOTS}. Is Logi Options+ installed?")
    return builds[-1]


def _load(rel: str):
    p = build_dir() / rel
    if not p.exists():
        raise CatalogError(f"{p} missing. Options+ changed its catalog layout; see docs/maintenance.md.")
    return json.loads(p.read_text(encoding="utf-8"))


@functools.cache
def cards() -> dict[str, dict]:
    return {c["id"]: c for c in _load(r"logioptionsplus\data\card_presets\card_presets_win.json")["cards"]}


@functools.cache
def builtin_apps() -> dict[str, dict]:
    apps = _load(r"logioptionsplus\data\applications.json")["applications"]
    return {a["applicationId"]: a for a in apps if "applicationId" in a}


def app_card(application_id: str | None, card_id: str) -> dict | None:
    """Built-in apps ship their own variants of some cards; the UI prefers those."""
    if application_id and application_id in builtin_apps():
        for c in builtin_apps()[application_id].get("cards", []):
            if c.get("id") == card_id:
                return c
    return cards().get(card_id)


def device(name: str) -> dict:
    if name not in DEVICES:
        raise SpecError(f"Unknown device '{name}'. Supported: {', '.join(DEVICES)}")
    return DEVICES[name]


def device_package(name: str, rel: str):
    return _load(f"{device(name)['package']}\\{rel}")


def button_slot(dev: str, button: str) -> str:
    b = BUTTON_ALIASES.get(button, button)
    buttons = device(dev)["buttons"]
    if b not in buttons:
        raise SpecError(f"Unknown button '{button}' for {dev}. Buttons: {', '.join(buttons)} "
                           f"(aliases: {', '.join(BUTTON_ALIASES)})")
    return f"{device(dev)['slotPrefix']}_{buttons[b]}"


def slot_button(dev: str, slot_id: str) -> str | None:
    for b, suffix in device(dev)["buttons"].items():
        if slot_id == f"{device(dev)['slotPrefix']}_{suffix}":
            return b
    return None


# ------------------------------------------------------------ aliases

def _alias(card_id: str) -> str | None:
    m = re.match(r"^card_global_presets_(?:win_)?(.+)$", card_id)
    return m.group(1).replace("_", "-") if m else None


@functools.cache
def preset_aliases() -> dict[str, str]:
    """alias -> card id, for aliases that are unambiguous in this catalog."""
    seen: dict[str, list[str]] = {}
    for cid in cards():
        a = _alias(cid)
        if a:
            seen.setdefault(a, []).append(cid)
    return {a: ids[0] for a, ids in seen.items() if len(ids) == 1}


def alias_for(card_id: str) -> str | None:
    a = _alias(card_id)
    return a if a and preset_aliases().get(a) == card_id else None


def builtin_app_id(alias: str) -> str:
    app_id = alias if alias.startswith("application_id_") else "application_id_" + alias.replace("-", "_")
    if app_id not in builtin_apps():
        known = ", ".join(sorted(a[len("application_id_"):].replace("_", "-") for a in builtin_apps()))
        raise SpecError(f"'{alias}' is not a built-in Options+ application. Built-ins: {known}. "
                           "Use `executable:` for anything else.")
    return app_id


def builtin_alias(app_id: str) -> str:
    return app_id[len("application_id_"):].replace("_", "-")


# ------------------------------------------------------------ normalisation

_MAP_FIELDS = {"nestedCards"}
_DROP_FIELDS = {"category"}  # present in the catalog, never persisted by the agent


def normalize(v):
    """What the agent persists: proto3 JSON — scalar/list defaults omitted, keys
    sorted, empty sub-messages kept (e.g. "macro": {}), empty maps omitted."""
    if isinstance(v, dict):
        out = {}
        for k in sorted(v):
            if k in _DROP_FIELDS:
                continue
            nv = normalize(v[k])
            if not isinstance(nv, dict) and nv in (False, 0, "", []) and nv is not None:
                continue
            if nv == {} and k in _MAP_FIELDS:
                continue
            out[k] = nv
        return out
    if isinstance(v, list):
        return [normalize(x) for x in v]
    return v
