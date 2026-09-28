"""Build a fixture LogiPluginService data folder with a Global Ring: <dir>/Applications/Loupedeck72/@_defaultwin.

    python make_ring_store.py <data dir> [--install <dir>]

The Global profile holds the UI-written evidence of ring-ui-written.json: the
original 8 controls (R0), the UI's Ctrl+Shift+Esc item (R1) and its first K1
item as orphans (R4: the UI never garbage-collects). The folder behind slot
`right` and the two macros are synthetic stand-ins (their bodies were never
captured); only their references are real. --install also writes a synthetic
DefaultWin xliff (a few of the S1 names) so system actions resolve without LPS.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "lib"))

import ring  # noqa: E402

HKL_PL = 0x04150415  # the layout the evidence was recorded under
GLOBAL_PROFILE = "0F1E2D3C4B5A69788796A5B4C3D2E1F0"  # made up; the real one is read from ApplicationInfo
EVIDENCE = json.loads((HERE / "ring-ui-written.json").read_text(encoding="utf-8"))
SYSTEMS = ["LockWorkstation", "WindowsExplorer", "WindowsScreenshot", "WindowsMagnifier", "MediaPlayPause",
           "MediaNextTrack", "VolumeMute"]


def with_hkl(v, hkl: int = HKL_PL):
    return json.loads(json.dumps(v).replace("{hkl}", str(hkl)))


def global_profile() -> dict:
    _, _, doc = ring.new_app(ring.GLOBAL_APP, "System plugin", dt.datetime(2026, 9, 28, tzinfo=dt.timezone.utc))
    doc.update(name=GLOBAL_PROFILE, displayName="Default", nativePluginName="DefaultWin", hasNativePlugin=True,
               additionalNativePluginNames=[])
    mode = doc["layout"]["layoutModes"][0]
    mode["modeName"] = "System"
    mode["workspaces"][0]["pressPages"][0]["controls"] = copy.deepcopy(EVIDENCE["r0_global_controls_before"])
    folder_ref = EVIDENCE["r0_global_controls_before"][2]["pressAction"]
    macro_refs = [EVIDENCE["r0_global_controls_before"][i]["pressAction"] for i in (1, 4)]
    folder = copy.deepcopy(EVIDENCE["k1_first_action_full"])  # synthetic: same envelope, folder template
    folder.update(name=folder_ref, templateActionName=ring.FOLDER_TEMPLATE, displayName="Explore AI",
                  superGroupName="@folder")
    folder["actionParameters"]["parameters"] = {"$type": "Loupedeck.StringDictionaryNoCase, PluginApi",
                                                "folderName": "FOLDERPAGE1"}
    doc["layout"]["folderPages"] = [ring._page("FOLDERPAGE1", "Explore AI")]
    doc["macroCommands"] = [{"$type": "Loupedeck.Service.MacroCommand, LoupedeckService",  # synthetic
                             "name": ref[len(ring.MACRO):], "displayName": "New Note", "steps": []}
                            for ref in macro_refs]
    doc["profileActions"] = [folder, with_hkl(EVIDENCE["r1_global_slot1_ctrl_shift_esc"]["profileAction"]),
                             with_hkl(EVIDENCE["k1_first_action_full"])]
    return doc


def global_info() -> dict:
    return {"$type": "Loupedeck.Service.SupportedApplicationInfo, LoupedeckService", "name": ring.GLOBAL_APP,
            "displayName": "System plugin", "description": None, "deviceType": ring.RING_DEVICE,
            "nativePluginName": "DefaultWin", "hasNativePlugin": True, "processOrBundleName": None,
            "modes": [{"$type": "Loupedeck.Service.ApplicationMode, LoupedeckService", "name": "System",
                       "parentModeName": None, "displayName": "System"}],
            "defaultProfileName": GLOBAL_PROFILE, "isEnabled": True}


def write_xliff(install_dir: Path) -> Path:
    units = "".join(f'        <trans-unit id="$DefaultWin___{n}" translate="yes">\n'
                    f"          <source>{n}</source>\n          <target>{n}</target>\n        </trans-unit>\n"
                    for n in SYSTEMS)
    text = ('﻿<?xml version="1.0" encoding="utf-8"?>\n<xliff version="1.2">\n'
            '  <file original="$DefaultWin___System" source-language="en" target-language="" datatype="plaintext">\n'
            '    <body>\n      <group id="@commands">\n' + units + '      </group>\n'
            '      <group id="@adjustments">\n        <trans-unit id="$DefaultWin___Volume" translate="yes">\n'
            '          <source>System Volume</source>\n        </trans-unit>\n      </group>\n'
            '    </body>\n  </file>\n</xliff>\n')
    path = install_dir / ring.SYSTEM_XLIFF
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def make_ring_store(data_dir: Path, install_dir: Path | None = None) -> Path:
    app = data_dir / "Applications" / ring.RING_DEVICE / ring.GLOBAL_APP
    (app / "Profiles" / GLOBAL_PROFILE).mkdir(parents=True, exist_ok=True)
    (app / "ApplicationInfo.json").write_bytes(ring.canonical_json(global_info()))
    (app / "Profiles" / GLOBAL_PROFILE / "ProfileInfo.json").write_bytes(ring.canonical_json(global_profile()))
    if install_dir is not None:
        write_xliff(install_dir)
    return app


if __name__ == "__main__":
    install = Path(sys.argv[sys.argv.index("--install") + 1]) if "--install" in sys.argv else None
    print(make_ring_store(Path(sys.argv[1]), install))
