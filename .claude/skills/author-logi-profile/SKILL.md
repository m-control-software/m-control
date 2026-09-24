---
name: author-logi-profile
description: Create or change Logitech MX Master 4 button, gesture or per-application mouse profiles (Logi Options+) by writing *.logi.json specs and applying them with `mctl run logi-options`. Use when the user asks to set up, change, remap, back up, export, sync or restore mouse buttons, thumb gestures, the haptic panel, thumb wheel or an app-specific mouse profile (e.g. "make my mouse do X in Rider", "set up the MX Master for VS Code", "copy my mouse setup to this machine", "what are my mouse buttons set to"). Also use when logi-options reports a storage/round-trip/catalog error after an Options+ update.
---

# Author a Logi Options+ profile

The tool is `tools/artifacts/logi-options`. Before writing anything, read
**`tools/artifacts/logi-options/docs/spec-format.md`**. It is the canonical
reference for the file format, buttons, action forms, gestures, and the shortcut
grammar. Don't restate it from memory; the details matter.

## Workflow

1. **Find the pack.** Specs live in the directories listed in
   `tools.logi-options.packDirs` in `~/.m-control/config.json`; read it there
   rather than assuming a location. **Never put personal or client
   specs into the m-control repo.** `examples/` in the tool is reference material,
   and it is never applied.
2. **See the current state** before changing it:
   `mctl run logi-options mode=list`, and `mode=export app=<handle>` (prints a
   profile as a spec). If there's no pack yet, seed one with
   `mode=export app=all out=<pack dir>/personal.logi.json pack=personal`.
3. **Map the request onto the hardware** (the button table is in spec-format.md):
   - The **thumb button is the gesture button**. It takes either one action
     *or* `gestures`, never both. A request that implies both is physically
     impossible: say so, and propose where the other action should go (usually
     `haptic-panel` or `top`).
   - v1 does not cover device settings (pointer speed, SmartShift, scroll
     direction, haptics), macros, or other devices. Say so rather than
     approximating.
   - Only listed buttons change. A new profile starts from Logitech defaults,
     not from the Global profile.
4. **Get real shortcuts from the application's actual key bindings**, never
   from memory (spec-format.md, "Choosing the shortcuts"). If you can't
   determine them, record the assumption in the profile's `description` and
   tell the user.
5. **Vocabulary:** `mctl run logi-options mode=presets` lists buttons, preset
   names, gesture presets, keys, and built-in apps. Prefer `builtin` over
   `executable` when the app is on that list.
6. **Validate and preview:** `mctl run logi-options check=true`. Show the user
   the drift and planned change.
7. **Ask before applying.** Applying restarts the Options+ agent, so the mouse
   is on default buttons for a few seconds. Then run `mctl run logi-options`,
   and confirm the result shows `changed: true, verified: true` (or `changed:
   false` when already in sync). If it reports `verified: false`, run
   `check=true` again after a moment.
8. **Ask the user to try it at the device.** The tool can verify what Options+
   stored; only a person can verify what the button does in the app.

## Never

- Edit `settings.db` directly, or write to it while `logioptionsplus_agent.exe` runs.
  All writes go through the tool.
- Sync or copy `settings.db` between machines. Sync the spec files instead.
- Commit backups, research snapshots, or exported packs containing personal
  setup into m-control. Snapshots hold host names, serials, and app command lines.
- Pass `--check`-style flags. mctl drops them. Flags are `key=value` (`check=true`).

## When the tool refuses

Errors mentioning the settings.db row layout, "round-trips byte-identically",
a missing catalog file, or `test_model.py` failures mean **Options+ changed its
internals** (usually after an update). Don't work around the guard. Follow
**`tools/artifacts/logi-options/docs/maintenance.md`**: run the tests, then the
controlled-change method with `research/`. Background:
`docs/internals.md`, ADR-0011.
