"""Compiler checks against what the Options+ UI actually wrote (stdlib unittest).

    python -m unittest discover -s tools/artifacts/logi-options/test -p "test_*.py" -v

Run after every Options+ update: a failure here means Logitech's model drifted
and docs/maintenance.md applies - before any real import is attempted.
Catalog-dependent tests skip when Options+ is not installed (the catalogs are
Logitech's files and are never copied into this repo).
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
sys.path.insert(0, str(HERE / "fixtures"))

WINDOWS = sys.platform == "win32"
if WINDOWS:
    import catalog as cat
    import model
    import packs
    import store as st
    from errors import LogiError, SpecError
    from make_store import make_store
    HAVE_CATALOG = cat.available()
else:
    HAVE_CATALOG = False

UI = json.loads((HERE / "fixtures" / "ui-written.json").read_text(encoding="utf-8"))
STORE = json.loads((HERE / "fixtures" / "store.json").read_text(encoding="utf-8"))
DEV = "mx-master-4"
CHROME = "application_id_google_chrome"
GLOBAL = "420fd454-0c36-499d-bde4-146823b16147"


def slot(assignments, suffix):
    return next(a for a in assignments if a["slotId"] == f"mx-master-4-2b042_{suffix}")


@unittest.skipUnless(WINDOWS and HAVE_CATALOG, "needs Windows with Logi Options+ installed (catalogs)")
class CompilerMatchesUI(unittest.TestCase):
    def test_shortcut_card_is_byte_identical_to_ui(self):
        ours = model.compile_button(DEV, "top", {"shortcut": "ctrl+shift+esc"}, GLOBAL, None)
        self.assertEqual(ours, UI["e1_global_top_ctrl_shift_esc"])

    def test_custom_gestures_are_byte_identical_to_ui(self):
        base = slot(UI["e2_chrome_profile_as_created"]["assignments"], "c195")
        ours = model.compile_button(DEV, "thumb", {"gestures": {"left": {"shortcut": "CTRL+SHIFT+TAB"},
                                                               "right": {"shortcut": "CTRL+TAB"}}}, CHROME, base)
        ui = copy.deepcopy(UI["e3_chrome_thumb_custom_gestures"])
        ui["card"]["nestedCards"]["custom_gesture"].pop("selectedNestedCard", None)  # UI's last-edited marker
        self.assertEqual(ours, ui)

    def test_new_profile_defaults_mean_what_the_ui_created(self):
        ours = {a["slotId"]: model.card_action(a["card"], CHROME) for a in model.default_assignments(DEV, CHROME)}
        ui = {a["slotId"]: model.card_action(a["card"], CHROME)
              for a in UI["e2_chrome_profile_as_created"]["assignments"]}
        self.assertEqual(ours, ui)

    def test_ui_written_cards_decompile_to_portable_actions(self):
        self.assertEqual(model.card_action(UI["e1_global_top_ctrl_shift_esc"]["card"], GLOBAL),
                         {"shortcut": "CTRL+SHIFT+ESC"})
        self.assertEqual(model.card_action(UI["e1_global_top_original_mode_shift"]["card"], GLOBAL),
                         {"preset": "mode-shift"})
        self.assertEqual(model.card_action(UI["e3_chrome_thumb_custom_gestures"]["card"], CHROME),
                         {"gestures": {"left": {"shortcut": "CTRL+SHIFT+TAB"}, "right": {"shortcut": "CTRL+TAB"}}})

    def test_every_fixture_profile_round_trips(self):
        for key in STORE["profile_keys"]:
            spec, warnings = model.profile_to_spec(STORE, key, DEV)
            self.assertEqual(warnings, [], key)
            app_id = STORE[key]["applicationId"]
            for b, action in spec["buttons"].items():
                stored = next(a for a in STORE[key]["assignments"] if a["slotId"] == cat.button_slot(DEV, b))
                self.assertEqual(model.canonical(action, DEV, b, app_id), model.card_action(stored["card"], app_id))


@unittest.skipUnless(WINDOWS and HAVE_CATALOG, "needs Windows with Logi Options+ installed (catalogs)")
class Validation(unittest.TestCase):
    CASES = [
        ({"thumb": {"shortcut": "CTRL+SHIFT+A", "gestures": "media-control"}}, "shortcut AND gestures on one button"),
        ({"back": {"gestures": {"left": {"shortcut": "A"}}}}, "gestures on a non-gesture button"),
        ({"gesture": {"preset": "back"}, "thumb": {"preset": "forward"}}, "two names for one button"),
        ({"thumb-button": {"shortcut": "A"}}, "unknown button"),
        ({"back": {"shortcut": "CTRL+HYPER+A"}}, "unknown key"),
        ({"back": {"preset": "teleport"}}, "unknown preset"),
        ({"thumb": {"gestures": {"sideways": {"shortcut": "A"}}}}, "unknown gesture direction"),
        ({"back": "ALT+LEFT"}, "bare string instead of an action object"),
    ]

    def test_rejects_likely_mistakes(self):
        for buttons, why in self.CASES:
            with self.subTest(why), self.assertRaises(SpecError):
                model.validate_profile(DEV, {"application": {"global": True}, "buttons": buttons}, "t")

    def test_rejects_bad_applications(self):
        for app in ({"executable": r"C:\x\rider64.exe"}, {"global": True, "builtin": "google-chrome"},
                    {"builtin": "not-an-app"}, {"global": False}, {"executable": "rider"}):
            with self.subTest(app), self.assertRaises(LogiError):
                model.validate_profile(DEV, {"application": app, "buttons": {"back": {"preset": "back"}}}, "t")


@unittest.skipUnless(WINDOWS and HAVE_CATALOG, "needs Windows with Logi Options+ installed (catalogs)")
class Packs(unittest.TestCase):
    def _pack(self, d: Path, name: str, profiles, pack="p"):
        p = d / f"{name}.logi.json"
        doc = {"specVersion": 1, "pack": pack, "device": DEV, "profiles": profiles}
        p.write_text(json.dumps(doc), encoding="utf-8")
        return p

    def test_packs_merge_by_button_and_conflict_on_same_button(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            (d / "a").mkdir()
            (d / "b" / "specs").mkdir(parents=True)
            self._pack(d / "a", "one", [{"application": {"global": True}, "buttons": {"back": {"preset": "back"}}}])
            self._pack(d / "b" / "specs", "two",
                       [{"application": {"global": True}, "buttons": {"top": {"preset": "mode-shift"}}}])
            files = packs.find_spec_files([str(d)])
            self.assertEqual(len(files), 2)  # a root holding several packs, incl. <pack>/specs/
            merged = packs.merge(files)
            self.assertEqual(len(merged), 1)
            self.assertEqual(sorted(merged[0].buttons), ["back", "top"])
            self._pack(d / "a", "three",
                       [{"application": {"global": True}, "buttons": {"mode-shift": {"nothing": True}}}])
            with self.assertRaisesRegex(SpecError, "set twice"):
                packs.merge(packs.find_spec_files([str(d)]))

    def test_absent_pack_dir_is_a_no_op(self):
        self.assertEqual(packs.find_spec_files([r"C:\does\not\exist", ""]), [])

    def test_pack_header_is_validated(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "x.logi.json"
            for bad in ({"specVersion": 2, "pack": "p", "device": DEV, "profiles": []},
                        {"specVersion": 1, "pack": "Not Kebab", "device": DEV, "profiles": []},
                        {"specVersion": 1, "pack": "p", "device": "mx-anywhere", "profiles": []},
                        {"specVersion": 1, "pack": "p", "device": DEV, "profiles": [], "extra": 1}):
                p.write_text(json.dumps(bad), encoding="utf-8")
                with self.subTest(bad), self.assertRaises(LogiError):
                    packs.load_pack(p)


@unittest.skipUnless(WINDOWS, "Windows only")
class Grammar(unittest.TestCase):
    @unittest.skipUnless(HAVE_CATALOG, "needs catalogs (module import)")
    def test_shortcut_grammar_round_trips_every_key(self):
        bad = [k for k in cat.KEYS if cat.format_shortcut(cat.parse_shortcut(f"CTRL+ALT+{k}")) != f"CTRL+ALT+{k}"]
        self.assertEqual(bad, [])

    def test_custom_app_ids_are_pinned(self):
        # Changing APP_NAMESPACE would orphan every profile imported so far.
        import uuid
        self.assertEqual(str(uuid.uuid5(model.APP_NAMESPACE, "rider64.exe")), "3de38ad7-c2f3-59b4-b578-bf28ada9bcd2")


@unittest.skipUnless(WINDOWS, "Windows only")
class Store(unittest.TestCase):
    def test_fixture_store_round_trips_and_writes_guarded(self):
        with tempfile.TemporaryDirectory() as t:
            make_store(HERE / "fixtures" / "store.json", Path(t))
            s = st.Store(Path(t))
            self.assertFalse(s.live)  # a non-live store never touches the agent
            snap = s.read()
            self.assertEqual(snap.doc, STORE)
            doc = copy.deepcopy(snap.doc)
            doc["schema_version"] = 27
            new_sha = s.write(doc, snap.sha256)
            self.assertEqual(s.read().sha256, new_sha)
            with self.assertRaises(LogiError):  # stale expected hash: refuse, write nothing
                s.write(snap.doc, snap.sha256)


if __name__ == "__main__":
    unittest.main()
