"""Keyboard shortcut grammar shared by button cards and Actions Ring items.

Pure tables and parsing (no Windows APIs, no catalogs), so lib/ring.py and its
tests import it on any platform. catalog re-exports these names.
"""
from __future__ import annotations

from errors import SpecError

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
for i, (d, shifted) in enumerate(zip("1234567890", "!@#$%^&*()", strict=True)):
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
