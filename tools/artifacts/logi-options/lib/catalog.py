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


@functools.lru_cache(maxsize=None)
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


@functools.lru_cache(maxsize=None)
def cards() -> dict[str, dict]:
    return {c["id"]: c for c in _load(r"logioptionsplus\data\card_presets\card_presets_win.json")["cards"]}


@functools.lru_cache(maxsize=None)
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


@functools.lru_cache(maxsize=None)
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


# ------------------------------------------------------------ keys (USB HID usage page 0x07)

# Codes are the USB HID keyboard usage table (a published standard, so they do
# not drift with Options+ versions). virtualKeyId/displayCharacter are what the
# Options+ catalogs pair with each code (research/probe_keycodes.py); they are
# cosmetic — catalog cards omit them and still work.
MODIFIERS = {"CTRL": 224, "SHIFT": 225, "ALT": 226, "WIN": 227, "RCTRL": 228, "RSHIFT": 229, "RALT": 230, "RWIN": 231}
MODIFIER_ALIASES = {"CONTROL": "CTRL", "LCTRL": "CTRL", "LSHIFT": "SHIFT", "LALT": "ALT", "OPTION": "ALT",
                    "ALTGR": "RALT", "META": "WIN", "SUPER": "WIN", "CMD": "WIN", "LWIN": "WIN", "WINDOWS": "WIN"}
KEYS: dict[str, tuple[int, str, str]] = {}
for i, ch in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    KEYS[ch] = (4 + i, f"VK_{ch}", ch)
for i, (d, shifted) in enumerate(zip("1234567890", "!@#$%^&*()")):
    KEYS[d] = (30 + i, f"VK_{d}", f"{d} / {shifted}")
for n in range(1, 13):
    KEYS[f"F{n}"] = (57 + n, f"VK_F{n}", f"F{n}")
for n in range(13, 25):
    KEYS[f"F{n}"] = (91 + n, "", "")
KEYS.update({
    "ENTER": (40, "VK_RETURN", "Enter"), "ESC": (41, "VK_ESCAPE", "Escape"), "BACKSPACE": (42, "VK_BACK", "Backspace"),
    "TAB": (43, "VK_TAB", "Tab"), "SPACE": (44, "VK_SPACE", "Spacebar"), "MINUS": (45, "VK_MINUS", "- / _"),
    "EQUAL": (46, "VK_EQUAL", "= / +"), "LBRACKET": (47, "VK_LEFT_BRACKET", "[ / {"),
    "RBRACKET": (48, "VK_RIGHT_BRACKET", "] / }"), "BACKSLASH": (49, "VK_BACKSLASH", "\\ / |"),
    "SEMICOLON": (51, "VK_SEMICOLON", "; / :"), "QUOTE": (52, "VK_QUOTE", "' / \""), "GRAVE": (53, "VK_GRAVE", "` / ~"),
    "COMMA": (54, "VK_COMMA", ", / <"), "PERIOD": (55, "VK_PERIOD", ". / >"), "SLASH": (56, "VK_SLASH", "/ / ?"),
    "CAPSLOCK": (57, "VK_CAPITAL", "Caps Lock"), "PRINTSCREEN": (70, "", ""), "SCROLLLOCK": (71, "", "Scroll Lock"),
    "PAUSE": (72, "", ""), "INSERT": (73, "", "Insert"), "HOME": (74, "", "Home"), "PAGEUP": (75, "", "Page Up"),
    "DELETE": (76, "", "Delete"), "END": (77, "", "End"), "PAGEDOWN": (78, "", "Page Down"),
    "RIGHT": (79, "VK_RIGHT", "Right"), "LEFT": (80, "VK_LEFT", "Left"), "DOWN": (81, "VK_DOWN", "Down Arrow"),
    "UP": (82, "VK_UP", "Up Arrow"), "NUMLOCK": (83, "VK_NUMLOCK", "Num Lock"),
    "NUMPADDIVIDE": (84, "VK_DIVIDE", "Num /"), "NUMPADMULTIPLY": (85, "VK_MULTIPLY", "Num *"),
    "NUMPADMINUS": (86, "VK_SUBTRACT", "Num -"), "NUMPADPLUS": (87, "", "Num +"),
    "NUMPADENTER": (88, "VK_NUMPAD_ENTER", "Num Enter"), "NUMPADDECIMAL": (99, "VK_DECIMAL", "Num ."),
})
for n in range(1, 10):
    KEYS[f"NUMPAD{n}"] = (88 + n, f"VK_NUMPAD{n}", f"Num {n}")
KEYS["NUMPAD0"] = (98, "VK_NUMPAD0", "Num 0")
KEY_ALIASES = {"ESCAPE": "ESC", "RETURN": "ENTER", "SPACEBAR": "SPACE", "DEL": "DELETE", "INS": "INSERT",
               "PGUP": "PAGEUP", "PGDN": "PAGEDOWN", "PAGE_UP": "PAGEUP", "PAGE_DOWN": "PAGEDOWN",
               "ARROWLEFT": "LEFT", "ARROWRIGHT": "RIGHT", "ARROWUP": "UP", "ARROWDOWN": "DOWN",
               "-": "MINUS", "=": "EQUAL", "[": "LBRACKET", "]": "RBRACKET", "\\": "BACKSLASH", ";": "SEMICOLON",
               "'": "QUOTE", "`": "GRAVE", ",": "COMMA", ".": "PERIOD", "/": "SLASH", "PRTSC": "PRINTSCREEN"}
CODE_TO_KEY = {code: name for name, (code, _, _) in KEYS.items()}
MOD_TO_NAME = {code: name for name, code in MODIFIERS.items()}


def parse_shortcut(text: str) -> dict:
    """"CTRL+SHIFT+A" -> keystroke message. Modifier-only ("ALT") is allowed; the
    gesture presets use exactly that for hold-to-switch behaviour."""
    parts = [p.strip().upper() for p in text.split("+")]
    if not text.strip() or any(not p for p in parts):
        raise SpecError(f"Malformed shortcut '{text}'. Write e.g. CTRL+SHIFT+A (for the + key use SHIFT+EQUAL).")
    mods, key = [], None
    for i, p in enumerate(parts):
        m = MODIFIER_ALIASES.get(p, p)
        if m in MODIFIERS:
            if MODIFIERS[m] in mods:
                raise SpecError(f"Modifier {m} repeated in '{text}'.")
            mods.append(MODIFIERS[m])
            continue
        if i != len(parts) - 1:
            raise SpecError(f"'{p}' in '{text}' is not a modifier; only the last element may be a key. "
                               f"Modifiers: {', '.join(MODIFIERS)}.")
        k = KEY_ALIASES.get(p, p)
        if k not in KEYS:
            raise SpecError(f"Unknown key '{p}' in '{text}'. Examples: A, 5, F5, ESC, TAB, LEFT, PAGEUP, SLASH.")
        key = k
    ks: dict = {"modifiers": sorted(mods)}
    if key:
        code, vk, disp = KEYS[key]
        ks["code"] = code
        if vk:
            ks["virtualKeyId"] = vk
        if disp:
            ks["displayCharacter"] = disp
    return ks


def format_shortcut(keystroke: dict) -> str | None:
    """Inverse of parse_shortcut; None if the keystroke uses a code we cannot name."""
    names = []
    for m in sorted(keystroke.get("modifiers", [])):
        if m not in MOD_TO_NAME:
            return None
        names.append(MOD_TO_NAME[m])
    code = keystroke.get("code", 0)
    if code:
        if code not in CODE_TO_KEY:
            return None
        names.append(CODE_TO_KEY[code])
    return "+".join(names) or None
