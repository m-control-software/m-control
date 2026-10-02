"""Actions Ring items (ADR-0013): portable `actionsRing` specs <-> LogiPluginService's Ring store.

The Ring is not in settings.db. It lives in a second store with a second owner
(docs/actions-ring.md, the reference for everything here):

    %LOCALAPPDATA%\\Logi\\LogiPluginService\\Applications\\Loupedeck72\\<app>\\
        ApplicationInfo.json
        Profiles\\<profile>\\ProfileInfo.json       8 slots (controlId 0 = top, clockwise)

owned by LogiPluginService.exe (LPS), a child of the Options+ agent. Verified
facts this module relies on:

- ProfileInfo.json is Newtonsoft JSON: json.dumps(indent=4, ensure_ascii=False)
  with CRLF, in declared key order, reproduces it byte for byte. read_profile()
  refuses anything that doesn't, and anything whose layout isn't one mode, one
  workspace and one press page with controls 0..7.
- A slot is a reference string or null. Keyboard shortcuts are profile actions
  (`$@Generic___@KeyboardKey`) whose `keyboardKey` string encodes logical keys,
  a Windows VK, a modifier bitmask and a keyboard layout (HKL) with its scan code.
- LPS never re-saves on start or stop and must not run while the file is written.

Everything here is platform-independent: Windows APIs (keyboard layouts,
processes) are injected, so the tests run on any OS against a fixture tree.
"""
from __future__ import annotations

import copy
import datetime as dt
import functools
import hashlib
import json
import os
import re
import shutil
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import keys
from errors import SpecError, StoreError, VerifyError

RING_DEVICE = "Loupedeck72"  # the Actions Ring's device type inside LPS
GLOBAL_APP = "@_defaultwin"
LIVE_DATA_DIR = Path(os.environ.get("LOCALAPPDATA", "")) / "Logi" / "LogiPluginService"
INSTALL_DIR = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Logi" / "LogiPluginService"
SYSTEM_XLIFF = Path("Plugins") / "DefaultWin" / "localization" / "DefaultWinPlugin.xliff"
LPS_PROCESSES = {"logipluginservice.exe", "logipluginserviceext.exe"}
# Deterministic action ids: uuid5 of the canonical spec action. Changing this
# namespace orphans every item written so far (test_ring pins it) - don't.
RING_NAMESPACE = uuid.UUID("5b0f3c1e-7a42-4d7e-9c35-2f6a8e1d4b90")

SLOTS = ("top", "top-right", "right", "bottom-right", "bottom", "bottom-left", "left", "top-left")
SLOT_ALIASES = {str(i + 1): s for i, s in enumerate(SLOTS)}
ACTION_KEYS = ("shortcut", "system", "nothing", "raw", "folder")
# A folder page shows 4 slots; the UI allows no gaps and no folder inside a folder (F2-F4b).
FOLDER_MAX_ITEMS = 4
FOLDER_DESCRIPTION = "Group and nest multiple actions"  # what the current UI writes (F1); an older one wrote ""
FOLDER_GROUP = "Folders"  # the UI language's word for it ("Foldery" in Polish); cosmetic (F6)
PAGE_TYPE = "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayoutPage7, LoupedeckService"

PROFILE_ACTION = "$@Generic___@ProfileAction___"
MACRO = "$@Generic___@Macro___"
SYSTEM_PREFIX = "$DefaultWin___"
KEYBOARD_TEMPLATE = "$@Generic___@KeyboardKey"
FOLDER_TEMPLATE = "$@Generic___@OpenFolder"
SEP = "#¤%&+?"  # separator inside the platform part of keyboardKey (observed)
CONTROL_TYPE = "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayoutControl7, LoupedeckService"

# Built-in Options+ apps that have a Ring mapping. Chrome: the plugin app when
# Logitech's ChromeExtension plugin is installed, else a plugin-less `chrome`
# app, which works without the plugin (R7).
BUILTIN_APPS = {"application_id_google_chrome": {"pluginApp": "@_chromeextension", "stem": "chrome",
                                                 "display": "Google Chrome", "alias": "google-chrome"}}

# keyboardKey (docs/actions-ring.md "The keyboardKey grammar"):
#   <logical>___<hkl>___<display>___win-<VK>#¤%&+?<flags>#¤%&+?<hkl>#¤%&+?<scan>
# Modifiers in the order the UI writes them: (spec name, logical, display, flag bit).
# Observed: Ctrl<Alt, Ctrl<Shift, Win<Shift (K1); Win<Alt, Alt<Shift (K4). Ctrl vs Win never.
MODIFIERS = (("CTRL", "ControlOrCommand", "Ctrl", 128), ("WIN", "Windows", "Win", 8),
             ("ALT", "AltOrOption", "Alt", 2), ("SHIFT", "Shift", "Shift", 4))
# spec key -> (logical, display, VK). Only keys the UI was seen writing (K1, K4).
KEYS: dict[str, tuple[str, str, int]] = {
    "ESC": ("Escape", "Escape", 0x1B), "SPACE": ("Space", " ", 0x20), "LEFT": ("ArrowLeft", "ArrowLeft", 0x25),
    "ENTER": ("Return", "Return", 0x0D), "SLASH": ("Oem2", "/", 0xBF)}
KEYS.update({c: (f"Key{c}", c, ord(c)) for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"})
KEYS.update({f"F{n}": (f"F{n}", f"F{n}", 0x6F + n) for n in range(1, 25)})
_BY_LOGICAL = {logical: (name, vk) for name, (logical, _, vk) in KEYS.items()}
_MOD_BY_LOGICAL = {m[1]: m for m in MODIFIERS}


def canonical_json(doc: dict) -> bytes:
    """Newtonsoft's indented output: 4 spaces, CRLF, non-ASCII verbatim, declared key order."""
    return json.dumps(doc, indent=4, ensure_ascii=False).replace("\n", "\r\n").encode("utf-8")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ------------------------------------------------------------------ keyboard

@dataclass(frozen=True)
class Keyboard:
    """The target machine's layouts. hkl goes into new items; any HKL in
    `installed` counts as in sync (ADR-0013 Decision 5); scan(vk, hkl) is
    MapVirtualKeyEx(vk, MAPVK_VK_TO_VSC, hkl)."""
    hkl: int
    installed: frozenset[int]
    scan: Callable[[int, int], int]


def pick_hkl(preload_klid: str | None, installed: list[int]) -> int:
    """The default input layout (HKCU\\Keyboard Layout\\Preload\\1, a KLID such as
    00000415) as the HKL the system loaded for it, else the first installed one."""
    if not installed:
        raise StoreError("Windows reports no keyboard layouts; cannot encode a Ring shortcut.")
    try:
        klid = int(preload_klid or "", 16)
    except ValueError:
        klid = None
    if klid is not None:
        lang = klid & 0xFFFF
        if klid >> 16 == 0 and (lang << 16 | lang) in installed:
            return lang << 16 | lang
        same = [h for h in installed if h & 0xFFFF == lang]
        if same:
            return same[0]
    return installed[0]


def windows_keyboard() -> Keyboard:  # pragma: no cover - Windows only, exercised on the device
    import ctypes
    import winreg
    user32 = ctypes.windll.user32
    user32.MapVirtualKeyExW.restype = ctypes.c_uint
    user32.MapVirtualKeyExW.argtypes = (ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p)
    n = user32.GetKeyboardLayoutList(0, None)
    buf = (ctypes.c_void_p * max(n, 1))()
    n = user32.GetKeyboardLayoutList(n, buf)
    installed = [(buf[i] or 0) & 0xFFFFFFFF for i in range(n)]
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Keyboard Layout\Preload") as k:
            preload = str(winreg.QueryValueEx(k, "1")[0])
    except OSError:
        preload = None
    return Keyboard(pick_hkl(preload, installed), frozenset(installed),
                    lambda vk, hkl: int(user32.MapVirtualKeyExW(vk, 0, hkl)))


# ------------------------------------------------------------------ shortcuts

def canonical_shortcut(text: str, where: str = "shortcut") -> str:
    """The spec spelling (buttons' grammar, keys.format_shortcut order), limited to
    what the Ring can store and the UI was seen writing. Raises SpecError."""
    ks = keys.parse_shortcut(str(text))
    mods = [keys.MOD_TO_NAME[m] for m in ks.get("modifiers", [])]
    right = [m for m in mods if m.startswith("R")]
    if right:
        raise SpecError(f"{where}: '{text}' uses {'/'.join(right)}. The Actions Ring stores only left-hand "
                        "modifiers (a right one is saved as the left one); write CTRL/SHIFT/ALT/WIN.")
    if not ks.get("code"):
        raise SpecError(f"{where}: '{text}' has no key. A Ring item needs a key, e.g. CTRL+SHIFT+Y.")
    key = keys.CODE_TO_KEY[ks["code"]]
    if key not in KEYS:
        raise SpecError(f"{where}: key {key} in '{text}' was never observed in a Ring item, so it can't be encoded "
                        f"safely. Ring keys: A-Z, 0-9, F1-F24, ESC, SPACE, LEFT, ENTER, SLASH "
                        "(docs/actions-ring.md, K4). Other keys need a UI recording first (docs/maintenance.md).")
    if {"CTRL", "WIN"} <= set(mods):
        raise SpecError(f"{where}: '{text}' combines CTRL and WIN, whose order in a Ring item was never observed. "
                        "Use another shortcut, or record one in the UI first (docs/maintenance.md).")
    return keys.format_shortcut(ks)


def display_text(shortcut: str) -> str:
    """Canonical spec shortcut -> the label the UI gives it (`Ctrl+Shift+Y`)."""
    *mods, key = shortcut.split("+")
    return "+".join([m[2] for m in MODIFIERS if m[0] in mods] + [KEYS[key][1]])


def encode(shortcut: str, kb: Keyboard) -> tuple[str, str]:
    """Canonical spec shortcut -> (keyboardKey, display text), as the UI writes it."""
    *mods, key = shortcut.split("+")
    used = [m for m in MODIFIERS if m[0] in mods]
    logical_key, _, vk = KEYS[key]
    logical = "+".join([m[1] for m in used] + [logical_key])
    display = display_text(shortcut)
    flags = sum(m[3] for m in used)
    scan = kb.scan(vk, kb.hkl)
    return f"{logical}___{kb.hkl}___{display}___win-{vk}{SEP}{flags}{SEP}{kb.hkl}{SEP}{scan}", display


_KEYBOARD_KEY = re.compile(r"(?P<logical>[^_]+)___(?P<hkl>\d+)___(?P<display>.*)___win-(?P<vk>\d+)"
                           + re.escape(SEP) + r"(?P<flags>\d+)" + re.escape(SEP) + r"(?P<hkl2>\d+)"
                           + re.escape(SEP) + r"(?P<scan>\d+)")


def decode(keyboard_key: str) -> dict | None:
    """keyboardKey -> {shortcut, hkl, display}, or None for anything that isn't a
    fully consistent, known encoding (it then exports as raw and never matches a spec)."""
    m = _KEYBOARD_KEY.fullmatch(keyboard_key or "")
    if not m or m["hkl"] != m["hkl2"]:
        return None
    *mod_parts, key_part = m["logical"].split("+")
    if key_part not in _BY_LOGICAL or any(p not in _MOD_BY_LOGICAL for p in mod_parts):
        return None
    if len(set(mod_parts)) != len(mod_parts):
        return None
    used = [_MOD_BY_LOGICAL[p] for p in mod_parts]
    if used != [x for x in MODIFIERS if x in used]:  # not the UI's order
        return None
    key, vk = _BY_LOGICAL[key_part]
    if int(m["vk"]) != vk or int(m["flags"]) != sum(x[3] for x in used):
        return None
    text = "+".join([x[0] for x in used] + [key])
    try:
        shortcut = canonical_shortcut(text)
    except SpecError:
        return None
    return {"shortcut": shortcut, "hkl": int(m["hkl"]), "display": m["display"]}


# ------------------------------------------------------------------ system actions

def _kebab(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


@functools.cache
def system_actions(install_dir: Path) -> dict[str, str]:
    """kebab name -> LPS name (`media-play-pause` -> `MediaPlayPause`), read from the
    installed DefaultWin plugin (docs/actions-ring.md, S1). Plain commands only:
    the `@commands` group, without dynamic (dotted) names."""
    path = Path(install_dir) / SYSTEM_XLIFF
    if not path.is_file():
        raise StoreError(f"{path} not found. Is LogiPluginService (part of Logi Options+) installed? The Ring's system "
                         "actions are read from it; see docs/maintenance.md if it moved.")
    text = path.read_text(encoding="utf-8-sig")
    part = re.search(r'<file original="\$DefaultWin___System".*?</file>', text, re.S)
    group = re.search(r'<group id="@commands">(.*?)</group>', part.group(0), re.S) if part else None
    if not group:
        raise StoreError(f"{path} has no @commands group for $DefaultWin___System. LogiPluginService changed its "
                         "plugin format; see docs/maintenance.md.")
    names = re.findall(r'<trans-unit id="\$DefaultWin___([A-Za-z]+)"', group.group(1))
    return {_kebab(n): n for n in names}


def system_label(install_dir: Path, name: str) -> str | None:
    """English label from the xliff, for listings."""
    try:
        text = (Path(install_dir) / SYSTEM_XLIFF).read_text(encoding="utf-8-sig")
    except OSError:
        return None
    m = re.search(r'<trans-unit id="\$DefaultWin___' + re.escape(name) + r'"[^>]*>\s*<source>(.*?)</source>', text)
    return m.group(1) if m else None


# ------------------------------------------------------------------ spec validation

def slot_index(name: str, where: str) -> int:
    s = SLOT_ALIASES.get(str(name), str(name))
    if s not in SLOTS:
        raise SpecError(f"{where}: unknown Ring slot '{name}'. Slots: {', '.join(SLOTS)} (clockwise from the top; "
                        "aliases 1-8).")
    return SLOTS.index(s)


def _def_location(ref: str) -> tuple[str, str] | None:
    """Where a reference's definition lives: (list in the profile, its `name` there)."""
    if ref.startswith(PROFILE_ACTION):
        return "profileActions", ref
    if ref.startswith(MACRO):
        return "macroCommands", ref[len(MACRO):]
    return None


def canonical_action(action, where: str, in_folder: bool = False) -> dict:
    """Validate one Ring action and return what it means (aliases resolved)."""
    if not isinstance(action, dict):
        raise SpecError(f"{where}: expected an action object like {{\"shortcut\": \"CTRL+SHIFT+Y\"}}, got {action!r}.")
    kinds = [k for k in action if k in ACTION_KEYS]
    unknown = [k for k in action if k not in ACTION_KEYS and not (k == "label" and kinds == ["shortcut"])]
    if len(kinds) != 1 or unknown:
        raise SpecError(f"{where}: a Ring action is exactly one of {', '.join(ACTION_KEYS)} (a shortcut may add a "
                        f"label); got {kinds or 'none'}, unknown fields: {unknown or 'none'}.")
    kind, value = kinds[0], action[kinds[0]]
    if in_folder and kind in ("folder", "nothing"):
        raise SpecError(f"{where}: a folder item can't be {kind}: Options+ allows no folder inside a folder and no "
                        "empty slot between items (docs/actions-ring.md, F3/F4). List only the items, in order.")
    if kind == "folder":
        return {"folder": _canonical_folder(value, where)}
    if kind == "shortcut":
        out = {"shortcut": canonical_shortcut(value, where)}
        if "label" in action:
            if not isinstance(action["label"], str) or not action["label"].strip():
                raise SpecError(f"{where}.label must be a non-empty string.")
            # A label equal to the default text is no label: the stored item can't tell
            # them apart, so keeping it would read as drift forever and change the id.
            if action["label"] != display_text(out["shortcut"]):
                out["label"] = action["label"]
        return out
    if kind == "system":
        if not isinstance(value, str) or not re.fullmatch(r"[a-z]+(-[a-z]+)*", value):
            raise SpecError(f"{where}: system must be a kebab-case name like media-play-pause, got {value!r}. "
                            "List them: mctl run logi-options mode=presets")
        return {"system": value}
    if kind == "nothing":
        if value is not True:
            raise SpecError(f"{where}.nothing must be true.")
        return {"nothing": True}
    if not isinstance(value, dict) or set(value) - {"pressAction", "definition"} or "pressAction" not in value:
        raise SpecError(f"{where}: raw must be {{\"pressAction\": \"$...\", \"definition\": {{...}} | null}}.")
    ref, definition = value["pressAction"], value.get("definition")
    if not isinstance(ref, str) or not ref.startswith("$"):
        raise SpecError(f"{where}: raw.pressAction must be an LPS reference string starting with '$'.")
    loc = _def_location(ref)
    if definition is not None:
        if loc is None or not isinstance(definition, dict) or definition.get("name") != loc[1]:
            raise SpecError(f"{where}: raw.definition must be the profile action or macro that {ref} names.")
        if definition.get("templateActionName") == FOLDER_TEMPLATE:
            raise SpecError(f"{where}: a folder can't be raw: write it as {{\"folder\": {{\"label\": …, \"items\": "
                            "[…]}}}} (mode=export produces that form).")
    return {"raw": {"pressAction": ref, "definition": definition}}


def _canonical_folder(value, where: str) -> dict:
    if not isinstance(value, dict) or set(value) != {"label", "items"}:
        raise SpecError(f"{where}.folder must be {{\"label\": \"…\", \"items\": [1-{FOLDER_MAX_ITEMS} actions]}}.")
    label, items = value["label"], value["items"]
    if not isinstance(label, str) or not label.strip():
        raise SpecError(f"{where}.folder.label must be a non-empty string.")
    if not isinstance(items, list) or not 1 <= len(items) <= FOLDER_MAX_ITEMS:
        raise SpecError(f"{where}.folder.items must list 1-{FOLDER_MAX_ITEMS} actions: a folder page shows "
                        f"{FOLDER_MAX_ITEMS} slots (docs/actions-ring.md, F2).")
    return {"label": label,
            "items": [canonical_action(a, f"{where}.folder.items[{n}]", in_folder=True) for n, a in enumerate(items)]}


def walk(canon: dict):
    """The action and, for a folder, each of its items."""
    yield canon
    yield from canon.get("folder", {}).get("items", [])


def folder_guid(folder: dict) -> str:
    """From the folder's content, like a shortcut's id (ADR-0013 Decision 4): a rename or an item change
    gives a new folder, and the tool's old one is collected."""
    return uuid.uuid5(RING_NAMESPACE, "folder:" + json.dumps(folder, sort_keys=True, ensure_ascii=False)).hex.upper()


def validate_ring(ring, where: str) -> None:
    if not isinstance(ring, dict) or not ring:
        raise SpecError(f"{where}: expected a non-empty object of slot -> action, e.g. "
                        "{\"top\": {\"shortcut\": \"CTRL+SHIFT+Y\"}}.")
    seen: dict[int, str] = {}
    for slot, action in ring.items():
        i = slot_index(slot, where)
        if i in seen:
            raise SpecError(f"{where}: '{slot}' and '{seen[i]}' are the same Ring slot ({SLOTS[i]}).")
        seen[i] = slot
        canonical_action(action, f"{where}.{slot}")


def action_id(canon: dict) -> str:
    if "folder" in canon:
        return PROFILE_ACTION + folder_guid(canon["folder"])
    key = "shortcut:" + canon["shortcut"] + ("\nlabel:" + canon["label"] if "label" in canon else "")
    return PROFILE_ACTION + uuid.uuid5(RING_NAMESPACE, key).hex.upper()


# ------------------------------------------------------------------ profile documents

def controls(doc: dict) -> list[dict]:
    return doc["layout"]["layoutModes"][0]["workspaces"][0]["pressPages"][0]["controls"]


def check_shape(doc: dict, app: str, where: str) -> None:
    modes = (doc.get("layout") or {}).get("layoutModes") or []
    if doc.get("deviceType") != RING_DEVICE or doc.get("applicationName") != app:
        raise StoreError(f"{where}: deviceType/applicationName are {doc.get('deviceType')!r}/"
                         f"{doc.get('applicationName')!r}, expected {RING_DEVICE!r}/{app!r}. LogiPluginService "
                         "changed its store; see docs/maintenance.md before writing the Ring.")
    if len(modes) != 1 or len(modes[0].get("workspaces") or []) != 1:
        raise StoreError(f"{where}: expected one layout mode with one workspace. LogiPluginService changed the "
                         "Ring's layout; see docs/maintenance.md.")
    pages = modes[0]["workspaces"][0].get("pressPages") or []
    if len(pages) != 1 or [c.get("controlId") for c in pages[0].get("controls") or []] != list(range(8)):
        raise StoreError(f"{where}: expected one press page with controls 0..7. LogiPluginService changed the "
                         "Ring's layout; see docs/maintenance.md.")


def _gid(*parts: str) -> str:
    return uuid.uuid5(RING_NAMESPACE, ":".join(parts)).hex.upper()


def _page(name: str, display: str) -> dict:
    return {"$type": "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayoutPage7, LoupedeckService",
            "name": name, "displayName": display, "description": None,
            "controls": [{"$type": CONTROL_TYPE, "controlId": i, "pressAction": None, "rotateAction": None}
                         for i in range(8)]}


def new_app(stem: str, display: str, now: dt.datetime | None = None) -> tuple[dict, str, dict]:
    """(ApplicationInfo, profile folder, ProfileInfo) of a plugin-less app, in the exact
    shape and key order the UI wrote for 7-Zip (R3c), with deterministic ids (R5c, R7)."""
    info = {"$type": "Loupedeck.Service.SupportedApplicationInfo, LoupedeckService",
            "name": stem, "displayName": display, "description": None, "deviceType": RING_DEVICE,
            "nativePluginName": None, "hasNativePlugin": False, "processOrBundleName": stem,
            "modes": [{"$type": "Loupedeck.Service.ApplicationMode, LoupedeckService",
                       "name": "main", "parentModeName": None, "displayName": "Main"}],
            "defaultProfileName": None, "isEnabled": True}
    profile_name, workspace = _gid("profile", stem), _gid("workspace", stem)
    stamp = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%S.%f") + "0Z"
    profile = {
        "$type": "Loupedeck.Service.ApplicationProfile, LoupedeckService",
        "name": profile_name, "profileFlags": "None", "displayName": f"{display} Profile", "description": None,
        "deviceType": RING_DEVICE, "applicationName": stem, "nativePluginName": None, "hasNativePlugin": False,
        "additionalNativePluginNames": ["DefaultWin"], "lastModifiedTimeUtc": stamp,
        "profileSettings": {
            "$type": "Loupedeck.DictionaryNoCase`1[[System.String, System.Private.CoreLib]], PluginApi"},
        "actionImages90": None, "actionImages60": None, "wheelImages": None, "actionColors": None,
        "layout": {
            "$type": "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayout7, LoupedeckService",
            "deviceType": RING_DEVICE, "profileFlags": "None",
            "layoutModes": [{
                "$type": "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayoutMode7, LoupedeckService",
                "deviceType": RING_DEVICE, "modeName": "main", "parentModeName": None, "actions": None,
                "dynamicButtonPages": None, "dynamicEncoderPages": None,
                "workspaces": [{
                    "$type": "Loupedeck.Service.Devices.Loupedeck7Devices.ProfileLayoutWorkspace7, LoupedeckService",
                    "name": workspace, "displayName": "Workspace 1", "description": None,
                    "pressPages": [_page(_gid("press-page", stem), "Page (1)")],
                    "rotatePages": [_page(_gid("rotate-page", stem), "Dial Page")]}],
                "homeWorkspaceName": workspace}],
            "folderPages": []},
        "macroCommands": [], "macroAdjustments": [], "profileCommands": [], "profileAdjustments": [],
        "conversionHistory": None, "packageName": None, "packageVersion": None, "profileActions": []}
    return info, profile_name, profile


def keyboard_action(canon: dict, kb: Keyboard) -> dict:
    """A shortcut profile action in the exact key order the UI writes (R1)."""
    key, display = encode(canon["shortcut"], kb)
    return {
        "$type": "Loupedeck.Service.ApplicationProfileCommand, LoupedeckService",
        "isCommand": True,
        "name": action_id(canon),
        "templateActionName": KEYBOARD_TEMPLATE,
        "actionParameters": {
            "$type": "Loupedeck.ActionEditorActionParameters, PluginApi",
            "parameters": {"$type": "Loupedeck.StringDictionaryNoCase, PluginApi", "keyboardKey": key},
            "count": 1,
        },
        "displayName": canon.get("label", display),
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


def folder_action(guid: str, label: str) -> dict:
    """The folder item in the exact key order the UI writes it (F1)."""
    return {
        "$type": "Loupedeck.Service.ApplicationProfileCommand, LoupedeckService",
        "isCommand": True,
        "name": PROFILE_ACTION + guid,
        "templateActionName": FOLDER_TEMPLATE,
        "actionParameters": {
            "$type": "Loupedeck.ActionEditorActionParameters, PluginApi",
            "parameters": {"$type": "Loupedeck.StringDictionaryNoCase, PluginApi", "folderName": guid},
            "count": 1,
        },
        "displayName": label,
        "description": FOLDER_DESCRIPTION,
        "groupName": FOLDER_GROUP,
        "superGroupName": "@navigation",
        "isProfileAction": True,
        "isMultiState": False,
        "isResetCommand": False,
        "adjustmentName": None,
        "states": None,
    }


def folder_page(guid: str, refs: list[str]) -> dict:
    """The folder's page (F1): named like its action, the generic title "Folder" (the label lives on the
    action), and only the used controls, ids 0..n-1."""
    return {"$type": PAGE_TYPE, "name": guid, "displayName": "Folder", "description": FOLDER_DESCRIPTION,
            "controls": [{"$type": CONTROL_TYPE, "controlId": i, "pressAction": ref, "rotateAction": None}
                         for i, ref in enumerate(refs)]}


def _folder_page_of(doc: dict, definition: dict) -> dict | None:
    name = ((definition.get("actionParameters") or {}).get("parameters") or {}).get("folderName")
    pages = (doc.get("layout") or {}).get("folderPages") or []
    return next((p for p in pages if name and p.get("name") == name), None)


def _decompile_folder(doc: dict, definition: dict, systems: dict[str, str]) -> dict:
    label = definition.get("displayName") or ""
    page = _folder_page_of(doc, definition)
    if page is None:
        return {"_unsupported": f"folder {label!r} has no page"}
    refs = [c.get("pressAction") for c in page.get("controls") or []]
    ids = [c.get("controlId") for c in page.get("controls") or []]
    if not 1 <= len(refs) <= FOLDER_MAX_ITEMS or ids != list(range(len(refs))) or None in refs:
        return {"_unsupported": f"folder {label!r} has a page Options+ doesn't make (controls {ids}; "
                                "docs/actions-ring.md F2/F4: 1-4 used controls, ids 0..n-1)"}
    items = [decompile(doc, r, systems) for r in refs]
    if any("folder" in i or "_unsupported" in i for i in items):
        return {"_unsupported": f"folder {label!r} holds a folder, which Options+ doesn't allow (F3)"}
    return {"folder": {"label": label, "items": items}}


def _definition(doc: dict, ref: str) -> dict | None:
    loc = _def_location(ref)
    if loc is None:
        return None
    return next((a for a in doc.get(loc[0]) or [] if a.get("name") == loc[1]), None)


def decompile(doc: dict, ref: str | None, systems: dict[str, str]) -> dict:
    """What a slot's reference means, in spec form. A shortcut carries the HKL it was
    recorded with under "_hkl" (not part of the spec). A folder Options+ wouldn't make
    (no page, gaps, more than 4 items, a folder inside) is {"_unsupported": why}."""
    if ref is None:
        return {"nothing": True}
    by_name = {v: k for k, v in systems.items()}
    if ref.startswith(SYSTEM_PREFIX) and ref[len(SYSTEM_PREFIX):] in by_name:
        return {"system": by_name[ref[len(SYSTEM_PREFIX):]]}
    definition = _definition(doc, ref)
    if definition is not None and definition.get("templateActionName") == FOLDER_TEMPLATE:
        return _decompile_folder(doc, definition, systems)
    if definition is not None and definition.get("templateActionName") == KEYBOARD_TEMPLATE:
        params = (definition.get("actionParameters") or {}).get("parameters") or {}
        d = decode(params.get("keyboardKey", ""))
        if d is not None:
            out = {"shortcut": d["shortcut"]}
            if definition.get("displayName") != d["display"]:
                out["label"] = definition.get("displayName")
            out["_hkl"] = d["hkl"]
            return out
    return {"raw": {"pressAction": ref, "definition": copy.deepcopy(definition)}}


def portable(action: dict) -> dict:
    """The spec form: without the "_" annotations decompile adds, a folder's items included."""
    out = {k: v for k, v in action.items() if not k.startswith("_")}
    if "folder" in out:
        out["folder"] = {"label": out["folder"]["label"], "items": [portable(i) for i in out["folder"]["items"]]}
    return out


def describe(action: dict) -> str:
    if "_unsupported" in action:
        return action["_unsupported"]
    a = portable(action)
    if "shortcut" in a:
        return "shortcut " + a["shortcut"] + (f" (label {a['label']!r})" if "label" in a else "")
    if "system" in a:
        return "system " + a["system"]
    if "nothing" in a:
        return "nothing"
    if "folder" in a:
        return f"folder {a['folder']['label']!r} [" + ", ".join(describe(i) for i in a["folder"]["items"]) + "]"
    return "raw " + a["raw"]["pressAction"]


def in_sync(doc: dict, ref: str | None, canon: dict, kb_installed, systems) -> bool:
    got = decompile(doc, ref, systems)
    if portable(got) != canon:
        return False
    # an HKL difference alone never triggers a write, as long as that layout is installed here
    return all("_hkl" not in a or a["_hkl"] in kb_installed for a in walk(got))


def is_ours(action: dict, doc: dict, systems: dict[str, str]) -> bool:
    """Ours = a shortcut or folder action whose id is the one its own content derives (Decision 6)."""
    template = action.get("templateActionName")
    if template == FOLDER_TEMPLATE:
        got = _decompile_folder(doc, action, systems)
        return "folder" in got and action.get("name") == action_id(portable(got))
    if template != KEYBOARD_TEMPLATE:
        return False
    params = (action.get("actionParameters") or {}).get("parameters") or {}
    d = decode(params.get("keyboardKey", ""))
    if d is None:
        return False
    canon = {"shortcut": d["shortcut"]}
    if action.get("displayName") != d["display"]:
        canon["label"] = action.get("displayName")
    return action.get("name") == action_id(canon)


def _references(v, out: set[str], key: str | None = None) -> set[str]:
    if isinstance(v, dict):
        for k, x in v.items():
            _references(x, out, k)
    elif isinstance(v, list):
        for x in v:
            _references(x, out, key)
    elif isinstance(v, str) and key != "name" and v.startswith("$"):
        out.add(v)
    return out


# ------------------------------------------------------------------ store

@dataclass
class RingProfile:
    app: str
    app_dir: Path
    path: Path
    doc: dict
    raw: bytes
    info: dict

    @property
    def sha256(self) -> str:
        return sha256(self.raw)


def read_profile(app_dir: Path) -> RingProfile:
    """Read one app's Ring profile with the guards. Raises StoreError."""
    app = app_dir.name
    info_path = app_dir / "ApplicationInfo.json"
    try:
        info = json.loads(info_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        raise StoreError(f"{info_path}: unreadable ({e}). See docs/maintenance.md.") from e
    if info.get("deviceType") != RING_DEVICE or info.get("name") != app:
        raise StoreError(f"{info_path}: expected name {app!r} and deviceType {RING_DEVICE!r}. LogiPluginService "
                         "changed its store; see docs/maintenance.md.")
    name = info.get("defaultProfileName")
    if not name:  # plugin-less apps: the UI writes null and one profile folder (R3c)
        found = sorted(p.name for p in (app_dir / "Profiles").glob("*") if (p / "ProfileInfo.json").is_file())
        if len(found) != 1:
            raise StoreError(f"{app_dir}: no defaultProfileName and {len(found)} profiles; expected exactly one. "
                             "Remove the extra profile in the Options+ UI, or see docs/actions-ring.md.")
        name = found[0]
    path = app_dir / "Profiles" / name / "ProfileInfo.json"
    try:
        raw = path.read_bytes()
        doc = json.loads(raw.decode("utf-8"))
    except (OSError, ValueError) as e:
        raise StoreError(f"{path}: unreadable ({e}). See docs/maintenance.md.") from e
    if canonical_json(doc) != raw:
        raise StoreError(f"{path} no longer round-trips byte for byte: LogiPluginService changed its JSON writer. "
                         "Writing the Ring is unsafe until docs/maintenance.md is followed.")
    check_shape(doc, app, str(path))
    return RingProfile(app, app_dir, path, doc, raw, info)


@dataclass
class RingStore:
    """data_dir None = no Ring store (logi-options.dataDir points at a copy and no
    ringDataDir was given): Ring operations then refuse instead of touching the live one."""
    data_dir: Path | None
    install_dir: Path = INSTALL_DIR

    @property
    def available(self) -> bool:
        return self.data_dir is not None

    @property
    def live(self) -> bool:
        if self.data_dir is None:
            return False
        try:
            return self.data_dir.resolve() == LIVE_DATA_DIR.resolve()
        except OSError:
            return False

    @property
    def apps_dir(self) -> Path:
        if self.data_dir is None:
            raise StoreError("No Actions Ring store: logi-options.dataDir points at a copy of the Options+ store, so "
                             "the live Ring is off limits. Set logi-options.ringDataDir to a copy of "
                             "LogiPluginService's data folder to work on the Ring.")
        return self.data_dir / "Applications" / RING_DEVICE

    def app_names(self) -> list[str]:
        d = self.apps_dir
        if not d.is_dir():
            raise StoreError(f"{d} not found. Is Logi Options+ with the Actions Ring (LogiPluginService) installed?")
        return sorted(p.name for p in d.iterdir() if (p / "ApplicationInfo.json").is_file())

    def read(self, app: str) -> RingProfile | None:
        d = self.apps_dir / app
        return read_profile(d) if (d / "ApplicationInfo.json").is_file() else None

    def systems(self) -> dict[str, str]:
        return system_actions(self.install_dir)


# ------------------------------------------------------------------ applications

@dataclass
class Target:
    app: str
    label: str
    display: str                       # displayName for a new app
    profile: RingProfile | None        # None = to be created
    notes: list[str] = field(default_factory=list)


def target_for(spec_app: dict, store: RingStore) -> Target:
    """Spec application -> LPS Ring app (ADR-0013 Decision 2)."""
    if "global" in spec_app:
        prof = store.read(GLOBAL_APP)
        if prof is None:
            raise StoreError(f"{store.apps_dir / GLOBAL_APP} not found: no Global Ring on this machine. Open the "
                             "Actions Ring once in the Options+ UI, or see docs/actions-ring.md.")
        return Target(GLOBAL_APP, "Global Ring", "System plugin", prof)
    if "builtin" in spec_app:
        alias = str(spec_app["builtin"])
        app_id = alias if alias.startswith("application_id_") else "application_id_" + alias.replace("-", "_")
        m = BUILTIN_APPS.get(app_id)
        if m is None:
            known = ", ".join(v["alias"] for v in BUILTIN_APPS.values())
            raise SpecError(f"builtin '{alias}' has no Actions Ring mapping (mapped: {known}). Use "
                            "{\"executable\": \"<file>.exe\"} for its Ring; the tool never installs Logitech plugins.")
        plugin = store.read(m["pluginApp"])
        if plugin is not None:
            return Target(m["pluginApp"], f"{m['display']} Ring (Logitech plugin)", m["display"], plugin)
        stem = m["stem"]
        display = m["display"]
    else:
        stem = Path(str(spec_app["executable"])).stem.lower()
        display = str(spec_app.get("name") or stem)
    prof = store.read(stem)
    t = Target(stem, f"{display} Ring", display, prof)
    if prof is None:
        t.notes.append(f"new plugin-less Ring app {stem} (matched by process name {stem}.exe)")
    return t


def spec_application(prof: RingProfile, store: RingStore) -> dict | None:
    """LPS Ring app -> spec application, or None when it has no spec form (other plugin apps)."""
    if prof.app == GLOBAL_APP:
        return {"global": True}
    for m in BUILTIN_APPS.values():
        if prof.app == m["pluginApp"]:
            return {"builtin": m["alias"]}
        if prof.app == m["stem"] and store.read(m["pluginApp"]) is None:
            return {"builtin": m["alias"]}
    if not prof.info.get("hasNativePlugin") and prof.info.get("processOrBundleName") == prof.app:
        return {"executable": prof.app + ".exe", "name": prof.info.get("displayName") or prof.app}
    return None


# ------------------------------------------------------------------ plan (compile + surgical patch)

@dataclass
class Plan:
    target: Target
    slots: dict[int, dict]              # controlId -> canonical spec action
    sources: dict[int, str]
    before: bytes                       # b"" for a new app
    after: bytes
    info_bytes: bytes | None            # ApplicationInfo.json of a new app
    path: Path
    changes: list[str]
    drift: list[str]


def plan(target: Target, ring_spec: dict, sources: dict[str, str], store: RingStore,
         keyboard: Callable[[], Keyboard]) -> Plan:
    """Compile the listed slots into the target's profile. Only listed slots are
    written; only our own actions are replaced or removed (Decision 6).
    `keyboard` is called only when a shortcut must be encoded or compared."""
    slots = {slot_index(s, "actionsRing"): canonical_action(a, f"actionsRing.{s}") for s, a in ring_spec.items()}
    srcs = {slot_index(s, "actionsRing"): sources.get(s, "") for s in ring_spec}
    every = [a for top in slots.values() for a in walk(top)]
    if any("system" in a for a in every):
        systems = store.systems()
    else:
        try:  # only for describing a slot that currently holds a system action
            systems = store.systems()
        except StoreError:
            systems = {}
    for i, top in slots.items():
        for a in walk(top):
            if "system" in a and a["system"] not in systems:
                raise SpecError(f"{srcs[i]}: actionsRing.{SLOTS[i]}: unknown system action '{a['system']}'. "
                                f"Installed: {', '.join(sorted(systems))}.")
    kb = keyboard() if any("shortcut" in a for a in every) else None
    installed = kb.installed if kb else frozenset()

    changes, drift = [], []
    if target.profile is None:
        info, profile_name, doc = new_app(target.app, target.display)
        before, info_bytes = b"", canonical_json(info)
        path = store.apps_dir / target.app / "Profiles" / profile_name / "ProfileInfo.json"
        changes.append(f"+ app {target.app} (plugin-less, '{target.display}')")
        drift.append(f"{target.label}: Ring app {target.app} does not exist yet")
    else:
        doc, before, info_bytes, path = copy.deepcopy(target.profile.doc), target.profile.raw, None, target.profile.path

    ctls = controls(doc)
    for i in sorted(slots):
        canon, ctl = slots[i], ctls[i]
        ref = ctl.get("pressAction")
        if in_sync(doc, ref, canon, installed, systems):
            continue
        have = decompile(doc, ref, systems)
        if target.profile is not None:
            stale = portable(have) == canon  # same action, recorded under a layout not installed here
            drift.append(f"{target.label}: actionsRing.{SLOTS[i]} should be {describe(canon)}, is "
                         f"{describe(have)}" + (" (keyboard layout not installed here)" if stale else ""))
        new_ref = _compile_into(doc, canon, kb, systems, f"{srcs[i]}: actionsRing.{SLOTS[i]}", changes)
        if new_ref != ref:
            ctl["pressAction"] = new_ref
            changes.append(f"~ actionsRing.{SLOTS[i]} (controlId {i}): {describe(have)} -> {describe(canon)}")
        else:
            changes.append(f"~ actionsRing.{SLOTS[i]} (controlId {i}): {describe(canon)} re-encoded for keyboard "
                           f"layout {kb.hkl if kb else '-'}")
    _collect_garbage(doc, changes, systems)
    after = canonical_json(doc)
    if target.profile is not None and after == before:
        changes = []
    return Plan(target, slots, srcs, before, after, info_bytes, path, changes, drift)


def _compile_into(doc: dict, canon: dict, kb: Keyboard | None, systems: dict, where: str,
                  changes: list[str]) -> str | None:
    if "nothing" in canon:
        return None
    if "system" in canon:
        return SYSTEM_PREFIX + systems[canon["system"]]
    if "shortcut" in canon:
        assert kb is not None
        definition = keyboard_action(canon, kb)
        _upsert(doc.setdefault("profileActions", []), "profileActions", definition, where, changes, replace_ok=True)
        return definition["name"]
    if "folder" in canon:
        # The order the UI saves them in (F1): the folder action, each item, then the page.
        guid = folder_guid(canon["folder"])
        _upsert(doc.setdefault("profileActions", []), "profileActions", folder_action(guid, canon["folder"]["label"]),
                where, changes, replace_ok=True)
        refs = [_compile_into(doc, item, kb, systems, f"{where}.folder.items[{n}]", changes)
                for n, item in enumerate(canon["folder"]["items"])]
        _upsert(doc["layout"].setdefault("folderPages", []), "layout.folderPages", folder_page(guid, refs), where,
                changes, replace_ok=True)
        return PROFILE_ACTION + guid
    ref, definition = canon["raw"]["pressAction"], canon["raw"]["definition"]
    if definition is not None:
        list_name = _def_location(ref)[0]
        _upsert(doc.setdefault(list_name, []), list_name, copy.deepcopy(definition), where, changes, replace_ok=False)
    return ref


def _upsert(items: list, list_name: str, definition: dict, where: str, changes: list[str], replace_ok: bool) -> None:
    idx = next((j for j, a in enumerate(items) if a.get("name") == definition["name"]), None)
    if idx is None:
        items.append(definition)
        changes.append(f"+ {list_name}[{definition['name']}]")
    elif items[idx] != definition:
        # A shortcut's or folder's id is derived from its spec action in our namespace, so an
        # entry with that id is ours by construction; a raw definition's id is not.
        if not replace_ok:
            raise SpecError(f"{where}: {list_name}[{definition['name']}] already exists with different content, and "
                            "it isn't the tool's own. Export the Ring again (mode=export) to adopt it.")
        items[idx] = definition  # same id, new layout or scan code: rewritten in place (Decision 4)
        changes.append(f"~ {list_name}[{definition['name']}]")


def _collect_garbage(doc: dict, changes: list[str], systems: dict[str, str]) -> None:
    """Drop our own actions that nothing references any more, and the page of each of our folders
    dropped. Repeated, since dropping a folder unreferences its items. UI items and orphans stay."""
    while True:
        refs = _references(doc, set())
        gone = [a for a in doc.get("profileActions") or [] if a.get("name") not in refs and is_ours(a, doc, systems)]
        if not gone:
            return
        pages = {(p := _folder_page_of(doc, a)) and p.get("name") for a in gone} - {None}
        for a in gone:
            changes.append(f"- profileActions[{a['name']}] (the tool's own, no longer referenced)")
        doc["profileActions"] = [a for a in doc["profileActions"] if a not in gone]
        if pages:
            for name in sorted(pages):
                changes.append(f"- layout.folderPages[{name}] (its folder was the tool's own)")
            doc["layout"]["folderPages"] = [p for p in doc["layout"]["folderPages"] if p.get("name") not in pages]


def export_slots(prof: RingProfile, systems: dict[str, str]) -> tuple[dict, list[str]]:
    """All 8 slots in spec form, folders included. A folder Options+ wouldn't make is a
    recoverable error naming the slot: export never drops or rewrites what it can't express."""
    ring, warnings = {}, []
    for i, ctl in enumerate(controls(prof.doc)):
        a = decompile(prof.doc, ctl.get("pressAction"), systems)
        if "_unsupported" in a:
            raise SpecError(f"Ring app {prof.app}, slot {SLOTS[i]}: {a['_unsupported']}, which a Ring spec can't "
                            "express. Fix it in the Options+ UI, or export without the Ring: ring=false.")
        for item in walk(a):
            if "raw" in item:
                warnings.append(f"Ring app {prof.app} actionsRing.{SLOTS[i]}: {item['raw']['pressAction']} exported "
                                "as raw; it has no portable form and may not survive LPS updates.")
        ring[SLOTS[i]] = portable(a)
    return ring, warnings


def verify(p: Plan, store: RingStore, keyboard: Callable[[], Keyboard]) -> list[str]:
    """After the restart: the file is what was written (LPS never re-saves, so there is
    no "loaded" signal; Decision 9) and it decompiles to the spec."""
    prof = store.read(p.target.app)
    if prof is None:
        return [f"{p.target.label}: Ring app {p.target.app} is missing"]
    problems = []
    if prof.raw != p.after:
        problems.append(f"{p.target.label}: {prof.path} changed after it was written (LogiPluginService rewrote it)")
    kb = keyboard() if any("shortcut" in a for top in p.slots.values() for a in walk(top)) else None
    systems = store.systems()
    for i, canon in p.slots.items():
        ref = controls(prof.doc)[i].get("pressAction")
        if not in_sync(prof.doc, ref, canon, kb.installed if kb else frozenset(), systems):
            problems.append(f"{p.target.label}: actionsRing.{SLOTS[i]} should be {describe(canon)}, is "
                            f"{describe(decompile(prof.doc, ref, systems))}")
    return problems


# ------------------------------------------------------------------ owner, write, backup

Processes = Callable[[], list[tuple[str, int]]]


def lps_pids(processes: Processes) -> list[int]:
    return [pid for name, pid in processes() if name.lower() in LPS_PROCESSES]


def wait_owner_stopped(processes: Processes, timeout_s: float = 1.0) -> None:
    """After the agent tree was stopped, LPS must be gone within ~1 s (Decision 7)."""
    t0 = time.monotonic()
    while lps_pids(processes):
        if time.monotonic() - t0 > timeout_s:
            raise StoreError("LogiPluginService is still running after the Options+ agent stopped, so the Ring can't "
                             "be written safely. Nothing was written; the agent is being restarted. Quit Logi "
                             "Options+ from the tray and run the command again.")
        time.sleep(0.05)


def wait_owner_running(processes: Processes, until: Callable[[], bool]) -> bool:
    while not lps_pids(processes):
        if not until():
            return False
        time.sleep(0.2)
    return True


def _atomic_write(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".logi-options-tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def precheck(plans: list[Plan]) -> None:
    """Right before writing: nothing changed since it was read."""
    for p in plans:
        if p.info_bytes is not None:
            if (p.path.parents[2] / "ApplicationInfo.json").exists():
                raise StoreError(f"{p.path.parents[2]} appeared since it was planned. Nothing was written; "
                                 "run the command again.")
        elif not p.path.is_file() or sha256(p.path.read_bytes()) != sha256(p.before):
            raise StoreError(f"{p.path} changed since it was read. Nothing was written; run the command again.")


def write(plans: list[Plan]) -> None:
    """Write every plan; on any failure put back what was already written, then raise."""
    done: list[Plan] = []
    try:
        for p in plans:
            if p.info_bytes is not None:
                p.path.parent.mkdir(parents=True, exist_ok=False)
                _atomic_write(p.path.parents[2] / "ApplicationInfo.json", p.info_bytes)
            done.append(p)
            _atomic_write(p.path, p.after)
            if p.path.read_bytes() != p.after:
                raise StoreError(f"{p.path}: read-back after write does not match.")
    except (OSError, StoreError):
        undo(done)
        raise


def undo(plans: list[Plan]) -> None:
    for p in plans:
        if p.info_bytes is not None:
            shutil.rmtree(p.path.parents[2], ignore_errors=True)
        else:
            _atomic_write(p.path, p.before)


def backup(plans: list[Plan], store: RingStore, dest: Path) -> None:
    """Into an existing backup directory: dest/ring/manifest.json + the profiles as they were."""
    entries = []
    for p in plans:
        rel = p.path.relative_to(store.data_dir)
        e = {"app": p.target.app, "profile": rel.as_posix(), "createdApp": p.info_bytes is not None}
        if p.info_bytes is None:
            (dest / "ring" / "files" / rel).parent.mkdir(parents=True, exist_ok=True)
            (dest / "ring" / "files" / rel).write_bytes(p.before)
            e["sha256"] = sha256(p.before)
        entries.append(e)
    (dest / "ring").mkdir(parents=True, exist_ok=True)
    manifest = {"dataDir": str(store.data_dir), "entries": entries}
    (dest / "ring" / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def has_backup(src: Path) -> bool:
    return (src / "ring" / "manifest.json").is_file()


def check_backup(src: Path) -> list[dict]:
    manifest = json.loads((src / "ring" / "manifest.json").read_text(encoding="utf-8"))
    for e in manifest["entries"]:
        if not e["createdApp"] and sha256((src / "ring" / "files" / e["profile"]).read_bytes()) != e["sha256"]:
            raise StoreError(f"{src / 'ring' / 'files' / e['profile']} does not match its checksum; refusing to "
                             "restore it.")
    return manifest["entries"]


def restore(src: Path, store: RingStore, safety: Path) -> list[str]:
    """Put the Ring back as it was before the apply (owner stopped by the caller). The current
    state of each touched app is copied to safety/ring-apps/ first."""
    restored = []
    for e in check_backup(src):
        app_dir = store.apps_dir / e["app"]
        if app_dir.exists():
            shutil.copytree(app_dir, safety / "ring-apps" / e["app"], dirs_exist_ok=True)
        if e["createdApp"]:
            shutil.rmtree(app_dir, ignore_errors=True)
            restored.append(f"removed Ring app {e['app']}")
        else:
            target = store.data_dir / e["profile"]
            _atomic_write(target, (src / "ring" / "files" / e["profile"]).read_bytes())
            restored.append(f"restored {target}")
    return restored


def verify_restore(src: Path, store: RingStore) -> None:
    for e in check_backup(src):
        app_dir = store.apps_dir / e["app"]
        if e["createdApp"]:
            if app_dir.exists():
                raise VerifyError(f"{app_dir} still exists after the restore.")
        elif sha256((store.data_dir / e["profile"]).read_bytes()) != e["sha256"]:
            raise VerifyError(f"{store.data_dir / e['profile']} does not match the backup after the restore.")
