"""Actions Ring (lib/ring.py) against the UI-written evidence (stdlib unittest, any OS).

    python -m unittest discover -s tools/artifacts/logi-options/test -p "test_ring.py" -v

Every test works on a fixture LogiPluginService tree in a temp directory
(fixtures/make_ring_store.py), never the live one. A failure after an LPS update
means its format drifted: follow docs/maintenance.md before applying Ring specs.
"""
from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE / "fixtures"))

import ring  # noqa: E402
from errors import SpecError, StoreError  # noqa: E402
from make_ring_store import HKL_PL, make_ring_store, with_hkl  # noqa: E402

EVIDENCE = json.loads((HERE / "fixtures" / "ring-ui-written.json").read_text(encoding="utf-8"))
HKL_US = 0x04090409
# MapVirtualKeyEx(VK, MAPVK_VK_TO_VSC) for Polish (Programmers) and US: equal for these keys.
SCAN = {0x1B: 1, 0x20: 57, 0x25: 75, 0x0D: 28, 0xBF: 53, 0x70 + 3: 62, 0x7C: 100}
SCAN.update({ord(c): s for c, s in zip("QWERTYUIOP", range(16, 26), strict=True)})
SCAN.update({ord(c): s for c, s in zip("ASDFGHJKL", range(30, 39), strict=True)})
SCAN.update({ord(c): s for c, s in zip("ZXCVBNM", range(44, 51), strict=True)})
SCAN.update({ord(str(d)): 2 + (d - 1) % 10 for d in range(10)})
KB = ring.Keyboard(HKL_PL, frozenset({HKL_PL, HKL_US}), lambda vk, hkl: SCAN[vk])
KB_US = ring.Keyboard(HKL_US, frozenset({HKL_US}), lambda vk, hkl: SCAN[vk])

# Every recorded UI string -> the spec shortcut that must reproduce it.
RECORDED = {
    "Ctrl+Shift+Y": "CTRL+SHIFT+Y", "Ctrl+Alt+Y": "CTRL+ALT+Y", "Win+Shift+S": "SHIFT+WIN+S", "Alt+F4": "ALT+F4",
    "Y": "Y", "F13": "F13", "RCtrl+Y (stored as Ctrl+Y)": "CTRL+Y", "Ctrl+Shift+Z": "CTRL+SHIFT+Z",
    "Ctrl+Alt+Shift+Y": "CTRL+SHIFT+ALT+Y", "Win+Alt+Y": "ALT+WIN+Y", "Ctrl+1": "CTRL+1",
    "Ctrl+Shift+/": "CTRL+SHIFT+SLASH", "Ctrl+Space": "CTRL+SPACE", "Alt+Left": "ALT+LEFT", "Ctrl+Enter": "CTRL+ENTER",
}


def recorded_strings() -> dict[str, str]:
    rows = {**EVIDENCE["k1_keyboardKey_by_recorded_shortcut"], **EVIDENCE["k4_keyboardKey_by_recorded_shortcut"]}
    rows.pop("_comment")
    rows["Ctrl+Shift+Esc (R1)"] = EVIDENCE["r1_global_slot1_ctrl_shift_esc"]["profileAction"][
        "actionParameters"]["parameters"]["keyboardKey"]
    return rows


RECORDED["Ctrl+Shift+Esc (R1)"] = "CTRL+SHIFT+ESC"


class Tree(unittest.TestCase):
    """A fresh fixture tree per test."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ring-"))
        self.data, self.install = self.tmp / "lps", self.tmp / "install"
        make_ring_store(self.data, self.install)
        self.store = ring.RingStore(self.data, self.install)
        ring.system_actions.cache_clear()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def plan(self, spec: dict, app: dict | None = None, kb: ring.Keyboard = KB) -> ring.Plan:
        target = ring.target_for(app or {"global": True}, self.store)
        return ring.plan(target, spec, {s: "test.logi.json#profiles[0]" for s in spec}, self.store, lambda: kb)

    def apply(self, spec: dict, app: dict | None = None, kb: ring.Keyboard = KB) -> ring.Plan:
        p = self.plan(spec, app, kb)
        if p.changes:
            ring.precheck([p])
            ring.write([p])
        return p

    def snapshot(self) -> dict[str, bytes]:
        return {str(f.relative_to(self.data)): f.read_bytes() for f in sorted(self.data.rglob("*")) if f.is_file()}

    def global_doc(self) -> dict:
        return self.store.read(ring.GLOBAL_APP).doc


class Encoder(unittest.TestCase):
    def test_every_recorded_string_is_rebuilt_byte_for_byte(self):
        for name, want in recorded_strings().items():
            with self.subTest(name):
                got, _ = ring.encode(ring.canonical_shortcut(RECORDED[name]), KB)
                self.assertEqual(got, want.replace("{hkl}", str(HKL_PL)))

    def test_every_recorded_string_decodes_to_its_shortcut(self):
        for name, key in recorded_strings().items():
            with self.subTest(name):
                d = ring.decode(key.replace("{hkl}", str(HKL_US)))
                self.assertEqual((d["shortcut"], d["hkl"]), (RECORDED[name], HKL_US))

    def test_inert_and_foreign_forms_do_not_decode(self):
        full = recorded_strings()["Ctrl+Shift+Y"].replace("{hkl}", str(HKL_PL))
        bad = {
            "short (K2.1: loaded but sends nothing)": "ControlOrCommand+Shift+KeyY______Ctrl+Shift+Y___",
            "nolayout (K2.1)": full.replace(str(HKL_PL), ""),
            "flags disagree with the modifiers": full.replace(f"{ring.SEP}132{ring.SEP}", f"{ring.SEP}128{ring.SEP}"),
            "VK disagrees with the key": full.replace("win-89", "win-90"),
            "modifiers out of the UI's order": full.replace("ControlOrCommand+Shift", "Shift+ControlOrCommand"),
            "unrecorded key name": full.replace("KeyY", "Tab"),
            "the two HKL fields differ": full.replace(f"{ring.SEP}{HKL_PL}{ring.SEP}", f"{ring.SEP}{HKL_US}{ring.SEP}"),
            "stock item without a platform part": "Insert___269222921___Insert___",
            "mac platform part": "KeyY___1___Y___mac-16#¤%&+?0#¤%&+?y#¤%&+?com.apple.keylayout.US",
        }
        for why, key in bad.items():
            with self.subTest(why):
                self.assertIsNone(ring.decode(key))

    def test_rejects_what_the_ring_cannot_store_or_was_never_observed(self):
        for text in ("RCTRL+Y", "CTRL+WIN+Y", "CTRL+TAB", "ALT+RIGHT", "CTRL+SHIFT", "ALT", "CTRL+HYPER+Y", ""):
            with self.subTest(text), self.assertRaises(SpecError):
                ring.canonical_shortcut(text)

    def test_spelling_is_normalized_like_buttons(self):
        self.assertEqual(ring.canonical_shortcut("shift+control+escape"), "CTRL+SHIFT+ESC")
        self.assertEqual(ring.canonical_shortcut("Ctrl+/"), "CTRL+SLASH")

    def test_default_layout_is_picked_from_preload_then_the_list(self):
        self.assertEqual(ring.pick_hkl("00000415", [HKL_US, HKL_PL]), HKL_PL)
        self.assertEqual(ring.pick_hkl("00010415", [HKL_US, 0xF0010415]), 0xF0010415)  # a variant of Polish
        self.assertEqual(ring.pick_hkl(None, [HKL_US, HKL_PL]), HKL_US)
        with self.assertRaises(StoreError):
            ring.pick_hkl("00000415", [])


class Compiler(unittest.TestCase):
    def test_shortcut_action_is_the_ui_body_with_a_deterministic_id(self):
        ui = with_hkl(EVIDENCE["r1_global_slot1_ctrl_shift_esc"]["profileAction"])
        ours = ring.keyboard_action({"shortcut": "CTRL+SHIFT+ESC"}, KB)
        self.assertEqual(ring.canonical_json({**ui, "name": ours["name"]}), ring.canonical_json(ours))

    def test_action_ids_are_pinned(self):
        # Changing RING_NAMESPACE or the key format orphans every item written so far.
        self.assertEqual(ring.action_id({"shortcut": "CTRL+SHIFT+ESC"}),
                         "$@Generic___@ProfileAction___EE415570BD615D9AAF3396CBB7775CF7")
        self.assertNotEqual(ring.action_id({"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"}),
                            ring.action_id({"shortcut": "CTRL+SHIFT+Y"}))

    def test_new_app_is_the_ui_7zip_app_with_deterministic_ids(self):
        info, name, doc = ring.new_app("7zfm", "7-Zip File Manager")
        ui = EVIDENCE["r3c_plugin_less_app"]
        self.assertEqual(ring.canonical_json(info), ring.canonical_json(ui["applicationInfo"]))
        ours = json.dumps({k: v for k, v in doc.items() if k != "lastModifiedTimeUtc"}, ensure_ascii=False)
        theirs = json.dumps(ui["profile"], ensure_ascii=False)
        ws = doc["layout"]["layoutModes"][0]["workspaces"][0]
        ui_ws = ui["profile"]["layout"]["layoutModes"][0]["workspaces"][0]
        for mine, uis in ((name, ui["profile"]["name"]), (ws["name"], ui_ws["name"]),
                          (ws["pressPages"][0]["name"], ui_ws["pressPages"][0]["name"]),
                          (ws["rotatePages"][0]["name"], ui_ws["rotatePages"][0]["name"])):
            ours = ours.replace(mine, uis)
        ours = ours.replace("7-Zip File Manager Profile", "7-Zip File Manager Profil")  # the UI localizes it
        self.assertEqual(ours, theirs)
        self.assertEqual(ring.new_app("chrome", "Google Chrome")[1], "5174E3B276955CB58C8778AC2271201F")


class Validation(unittest.TestCase):
    BAD = [
        ({"middle": {"nothing": True}}, "unknown slot"),
        ({"top": {"nothing": True}, "1": {"nothing": True}}, "two names for one slot"),
        ({"top": {"shortcut": "CTRL+Y", "system": "media-stop"}}, "two actions"),
        ({"top": {"system": "media-stop", "label": "x"}}, "label on a system action"),
        ({"top": {"shortcut": "CTRL+Y", "label": ""}}, "empty label"),
        ({"top": {"system": "MediaStop"}}, "system not kebab-case"),
        ({"top": {"nothing": False}}, "nothing false"),
        ({"top": {"folder": "x"}}, "folder"),
        ({"top": {"raw": {"pressAction": "$@Generic___@ProfileAction___X",
                          "definition": {"name": "$@Generic___@ProfileAction___X",
                                         "templateActionName": ring.FOLDER_TEMPLATE}}}}, "raw folder"),
        ({"top": {"raw": {"pressAction": "$@Generic___@ProfileAction___X", "definition": {"name": "Y"}}}},
         "raw definition that isn't the referenced one"),
        ({}, "empty"),
    ]

    def test_rejects_likely_mistakes(self):
        for spec, why in self.BAD:
            with self.subTest(why), self.assertRaises(SpecError):
                ring.validate_ring(spec, "t.actionsRing")

    def test_accepts_every_form(self):
        ring.validate_ring({"top": {"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"}, "2": {"system": "media-stop"},
                            "left": {"nothing": True},
                            "bottom": {"raw": {"pressAction": "$DefaultWin___LockWorkstation", "definition": None}}},
                           "t")


class Store(Tree):
    def test_fixture_round_trips_and_decompiles_like_the_live_global_ring(self):
        prof = self.store.read(ring.GLOBAL_APP)
        got = [ring.describe(ring.decompile(prof.doc, c["pressAction"], self.store.systems()))
               for c in ring.controls(prof.doc)]
        self.assertEqual(got[0], "system media-play-pause")
        self.assertEqual(got[2], "folder 'Explore AI'")
        self.assertTrue(got[1].startswith("raw $@Generic___@Macro___"))

    def test_guards_refuse_a_changed_writer_or_layout_and_write_nothing(self):
        prof = self.store.read(ring.GLOBAL_APP)
        cases = {
            "not byte-identical (another writer)": json.dumps(prof.doc, indent=2).encode(),
            "nine controls": ring.canonical_json(self._with(prof.doc, lambda d: ring.controls(d).append(
                dict(ring.controls(d)[0], controlId=8)))),
            "two workspaces": ring.canonical_json(self._with(prof.doc, lambda d: d["layout"]["layoutModes"][0][
                "workspaces"].append(d["layout"]["layoutModes"][0]["workspaces"][0]))),
            "another device type": ring.canonical_json(dict(prof.doc, deviceType="Loupedeck73")),
        }
        for why, data in cases.items():
            with self.subTest(why):
                prof.path.write_bytes(data)
                before = self.snapshot()
                with self.assertRaises(StoreError):
                    self.plan({"top": {"shortcut": "CTRL+SHIFT+Y"}})
                self.assertEqual(self.snapshot(), before)
        prof.path.write_bytes(prof.raw)

    @staticmethod
    def _with(doc, fn):
        d = copy.deepcopy(doc)
        fn(d)
        return d

    def test_plugin_less_profile_is_the_only_profile_folder(self):
        self.apply({"top": {"nothing": True}}, {"executable": "notepad.exe"})
        self.assertEqual(self.store.read("notepad").path.parent.name, ring.new_app("notepad", "x")[1])
        (self.store.apps_dir / "notepad" / "Profiles" / "EXTRA").mkdir()
        (self.store.apps_dir / "notepad" / "Profiles" / "EXTRA" / "ProfileInfo.json").write_text("{}")
        with self.assertRaises(StoreError):
            self.store.read("notepad")

    def test_system_actions_come_from_the_installed_xliff(self):
        systems = self.store.systems()
        self.assertEqual(systems["media-play-pause"], "MediaPlayPause")
        self.assertNotIn("volume", systems)  # an adjustment (dial), not a command
        with self.assertRaisesRegex(SpecError, "unknown system action"):
            self.plan({"top": {"system": "teleport"}})


class Patch(Tree):
    def test_a_no_op_writes_nothing(self):
        p = self.plan({"top": {"system": "media-play-pause"}})  # what slot top already is (R0)
        self.assertEqual((p.changes, p.drift), ([], []))

    def test_only_the_listed_slot_and_its_action_change(self):
        before = self.global_doc()
        p = self.apply({"top-right": {"shortcut": "CTRL+SHIFT+Y"}})
        after = self.global_doc()
        want = copy.deepcopy(before)
        ring.controls(want)[1]["pressAction"] = ring.action_id({"shortcut": "CTRL+SHIFT+Y"})
        want["profileActions"].append(ring.keyboard_action({"shortcut": "CTRL+SHIFT+Y"}, KB))
        self.assertEqual(after, want)  # every other slot, the folder, macros and UI orphans untouched
        self.assertEqual(ring.canonical_json(after), p.after)
        self.assertEqual(self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}).changes, [])  # idempotent

    def test_replacing_our_item_removes_it_but_never_a_ui_item(self):
        ui_names = [a["name"] for a in self.global_doc()["profileActions"]]
        self.apply({"top-right": {"shortcut": "CTRL+SHIFT+Y"}})
        p = self.apply({"top-right": {"shortcut": "CTRL+ALT+Y"}})
        names = [a["name"] for a in self.global_doc()["profileActions"]]
        self.assertEqual(names, ui_names + [ring.action_id({"shortcut": "CTRL+ALT+Y"})])
        self.assertTrue(any(c.startswith("- profileActions") for c in p.changes))
        self.apply({"top-right": {"nothing": True}})
        self.assertEqual([a["name"] for a in self.global_doc()["profileActions"]], ui_names)

    def test_an_hkl_difference_alone_is_in_sync(self):
        self.apply({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}, kb=KB_US)  # recorded under US
        self.assertEqual(self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}, kb=KB).changes, [])

    def test_an_hkl_not_installed_is_rewritten_in_place(self):
        self.apply({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}, kb=KB)  # Polish
        p = self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}, kb=KB_US)  # a machine with US only
        self.assertIn("keyboard layout not installed here", p.drift[0])
        self.assertEqual([c[:1] for c in p.changes], ["~", "~"])  # same id rewritten, slot unchanged ref
        ring.write([p])
        actions = [a for a in self.global_doc()["profileActions"]
                   if a["name"] == ring.action_id({"shortcut": "CTRL+SHIFT+Y"})]
        self.assertEqual(len(actions), 1)
        self.assertIn(f"___{HKL_US}___", actions[0]["actionParameters"]["parameters"]["keyboardKey"])

    def test_label_is_written_decompiled_and_part_of_the_identity(self):
        self.apply({"top": {"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"}}, {"builtin": "google-chrome"})
        prof = self.store.read("chrome")
        self.assertIn("YT → mp3".encode(), prof.raw)  # verbatim, like Newtonsoft
        got = ring.portable(ring.decompile(prof.doc, ring.controls(prof.doc)[0]["pressAction"], {}))
        self.assertEqual(got, {"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"})
        p = self.apply({"top": {"shortcut": "CTRL+SHIFT+Y"}}, {"builtin": "google-chrome"})
        self.assertEqual(len(self.store.read("chrome").doc["profileActions"]), 1)
        self.assertTrue(any("no longer referenced" in c for c in p.changes))

    def test_a_label_equal_to_the_default_text_is_no_label(self):
        spec = {"top": {"shortcut": "CTRL+SHIFT+Y", "label": "Ctrl+Shift+Y"}}
        self.assertEqual(ring.canonical_action(spec["top"], "x"), {"shortcut": "CTRL+SHIFT+Y"})
        self.apply(spec, {"builtin": "google-chrome"})
        self.assertEqual(self.plan(spec, {"builtin": "google-chrome"}).drift, [])  # not drift forever
        p = self.apply({"top": {"nothing": True}}, {"builtin": "google-chrome"})
        self.assertTrue(any("no longer referenced" in c for c in p.changes))  # still recognised as ours

    def test_a_raw_item_with_a_foreign_id_is_never_overwritten(self):
        doc = self.global_doc()
        ui = doc["profileActions"][1]  # the UI's R1 item (orphaned)
        changed = dict(ui, displayName="edited")
        with self.assertRaisesRegex(SpecError, "isn't the tool's own"):
            self.plan({"left": {"raw": {"pressAction": ui["name"], "definition": changed}}})
        p = self.plan({"left": {"raw": {"pressAction": ui["name"], "definition": ui}}})
        self.assertEqual([c for c in p.changes if "profileActions" in c], [])  # already there, reused as is

    def test_chrome_uses_logitechs_plugin_app_only_when_it_exists(self):
        self.assertEqual(ring.target_for({"builtin": "google-chrome"}, self.store).app, "chrome")
        plugin = self.store.apps_dir / "@_chromeextension"
        shutil.copytree(self.store.apps_dir / ring.GLOBAL_APP, plugin)
        for f, key in ((plugin / "ApplicationInfo.json", "name"),
                       (next(plugin.glob("Profiles/*/ProfileInfo.json")), "applicationName")):
            f.write_bytes(ring.canonical_json({**json.loads(f.read_bytes()), key: "@_chromeextension"}))
        self.assertEqual(ring.target_for({"builtin": "google-chrome"}, self.store).app, "@_chromeextension")
        with self.assertRaisesRegex(SpecError, "no Actions Ring mapping"):
            ring.target_for({"builtin": "microsoft-excel"}, self.store)
        self.assertEqual(ring.target_for({"executable": "Rider64.EXE"}, self.store).app, "rider64")


class Transaction(Tree):
    def test_precheck_refuses_a_file_changed_since_it_was_read(self):
        p = self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}})
        path = self.store.read(ring.GLOBAL_APP).path
        path.write_bytes(path.read_bytes().replace(b'"Default"', b'"Edited"'))
        before = self.snapshot()
        with self.assertRaises(StoreError):
            ring.precheck([p])
        self.assertEqual(self.snapshot(), before)

    def test_backup_write_restore_round_trip(self):
        before = self.snapshot()
        plans = [self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}),
                 self.plan({"top": {"shortcut": "CTRL+SHIFT+ESC"}}, {"builtin": "google-chrome"})]
        dest = self.tmp / "backup"
        dest.mkdir()
        ring.backup(plans, self.store, dest)
        ring.precheck(plans)
        ring.write(plans)
        self.assertEqual([ring.verify(p, self.store, lambda: KB) for p in plans], [[], []])
        self.assertNotEqual(self.snapshot(), before)
        safety = self.tmp / "safety"
        safety.mkdir()
        ring.restore(dest, self.store, safety)
        ring.verify_restore(dest, self.store)
        self.assertEqual(self.snapshot(), before)  # the created chrome app is gone again
        self.assertTrue((safety / "ring-apps" / "chrome").is_dir())

    def test_a_failed_write_puts_back_what_was_written(self):
        plans = [self.plan({"top-right": {"shortcut": "CTRL+SHIFT+Y"}}),
                 self.plan({"top": {"nothing": True}}, {"executable": "notepad.exe"})]
        before = self.snapshot()
        plans[1].path.parent.mkdir(parents=True)  # an empty folder appears: the second write fails
        ring.precheck(plans)  # no ApplicationInfo.json yet, so this can't see it
        with self.assertRaises(OSError):
            ring.write(plans)
        self.assertEqual(self.snapshot(), before)  # the first, already written plan was put back

    def test_verify_notices_a_rewrite_after_the_write(self):
        p = self.apply({"top-right": {"shortcut": "CTRL+SHIFT+Y"}})
        path = self.store.read(ring.GLOBAL_APP).path
        doc = json.loads(path.read_bytes())
        ring.controls(doc)[1]["pressAction"] = None
        path.write_bytes(ring.canonical_json(doc))
        problems = ring.verify(p, self.store, lambda: KB)
        self.assertEqual(len(problems), 2)  # changed since written, and top-right is no longer the item

    def test_owner_must_stop_within_the_budget(self):
        ring.wait_owner_stopped(lambda: [("explorer.exe", 1)], 0.1)
        with self.assertRaisesRegex(StoreError, "still running"):
            ring.wait_owner_stopped(lambda: [("LogiPluginService.exe", 2)], 0.1)


class Export(Tree):
    def test_export_round_trips_every_portable_form(self):
        self.apply({"left": {"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"},
                    "right": {"system": "media-next-track"}, "top-left": {"nothing": True}})
        slots, warnings = ring.export_slots(self.store.read(ring.GLOBAL_APP), self.store.systems())
        self.assertEqual(slots["left"], {"shortcut": "CTRL+SHIFT+Y", "label": "YT → mp3"})
        self.assertEqual(slots["top-left"], {"nothing": True})
        self.assertEqual(slots["right"], {"system": "media-next-track"})
        self.assertEqual(len(warnings), 2)  # the two macros are raw
        self.assertEqual(self.plan(slots).changes, [])  # re-imports as in sync, raw macros included

    def test_export_refuses_a_folder_naming_the_slot(self):
        with self.assertRaisesRegex(SpecError, "slot right: it is a folder"):
            ring.export_slots(self.store.read(ring.GLOBAL_APP), self.store.systems())

    def test_spec_application_of_each_app_kind(self):
        self.apply({"top": {"nothing": True}}, {"builtin": "google-chrome"})
        self.apply({"top": {"nothing": True}}, {"executable": "notepad.exe", "name": "Notepad"})
        got = {a: ring.spec_application(self.store.read(a), self.store) for a in self.store.app_names()}
        self.assertEqual(got, {ring.GLOBAL_APP: {"global": True}, "chrome": {"builtin": "google-chrome"},
                               "notepad": {"executable": "notepad.exe", "name": "Notepad"}})


if __name__ == "__main__":
    unittest.main()
