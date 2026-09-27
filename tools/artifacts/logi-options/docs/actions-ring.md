# Actions Ring — can it be written from a spec?

A feasibility study, not an implementation. Reverse-engineered on 2026-09-27 on
Windows 11 (26200), Options+ agent 2.7.961922, catalog build `853130` (unchanged
since [internals.md](internals.md)), **LogiPluginService 6.4.1.3246**, MX Master 4,
with the controlled-change method of [maintenance.md](maintenance.md). Everything
here was observed unless it says otherwise; see [Evidence](#evidence).

**Verdict: B — feasible with transformations.** A keyboard-shortcut Ring item was
written programmatically, kept by its owner, shown in the Ring and the UI, and
opened Task Manager on the device; a second apply changed nothing. The Ring is
*not* in `settings.db` but in a second store with a second owner, and its items are
not Logitech cards, so it needs its own (small) compiler.

## Q1 — Storage

| Location | Holds | Changed by a Ring edit? |
|---|---|---|
| `%LOCALAPPDATA%\Logi\LogiPluginService\Applications\Loupedeck72\<app>\Profiles\<profile>\ProfileInfo.json` | **the Ring**: its 8 slots and the items they reference | **yes: the only authoritative file** |
| `…\Profiles\<profile>\ActionIcons\<action>.ict` | rendered icon (JSON: base64 SVG + label) | written by the UI; **optional** (R5 wrote none and the item still showed an icon) |
| `…\LogiPluginService\Snapshots\<guid>.st4` | zip of one whole profile: the UI's undo point | UI state; deleted again when the UI moves on |
| `…\LogiPluginService\LoupedeckSettings.ini` | `CurrentApplication/<device>`: which app the UI shows; `Sentry/…` start timestamp | UI state / noise |
| `…\LogiPluginService\Applications.Backups\backup_<date>.zip` | LPS's own backup of `Applications\` | at most daily, when the content hash changed |
| `…\LogiPluginService\Plugins\<Plugin>\` | a marketplace plugin, installed when a per-app Ring needs one (R3) | only on plugin install |
| `settings.db`, Global profile: `radial-menu-virtual-device-10000000_c408`…`_c415` | 8 ordinary cards (package defaults: cut, copy, paste, …) | **no**. Dormant: the Ring the user sees had different content, and no Ring edit touched them |
| `settings.db`, `mx-master-4-2b042_c416` (`show-radial-menu`) | the haptic panel **opens** the Ring | no. Separate from the Ring's content |

- `Loupedeck72` is the Actions Ring's device type inside LogiPluginService (LPS);
  `Loupedeck70`/`71` hold stock profiles for other Loupedeck form factors and were
  only touched by the plugin install.
- **Global Ring** = LPS application `@_defaultwin` ("System plugin"); its profile is
  `ApplicationInfo.json` → `defaultProfileName`.
- **Not cloud.** Every change was a local file; nothing else changed except agent noise.
- `settings.db`'s `radial-menu-virtual-device` package (`88b73d28-…`) is where the
  "`PRESET_TAG_LPS_ACTION_RING`" card comes from. Its slots look like a pre-LPS
  Ring model the agent still carries. Not written, not needed.

## Q2 — Model

```
ProfileInfo.json   (Newtonsoft: "$type" on every object, declared key order, 4-space indent, CRLF)
├── deviceType: "Loupedeck72", applicationName: "@_defaultwin" | "<exe stem>" | "@_<plugin app>"
├── layout.layoutModes[0].workspaces[0]
│   └── pressPages[0].controls[0..7]            THE RING: controlId 0..7
│       └── {controlId, pressAction: "<action ref>" | null, rotateAction}
├── layout.folderPages[]                        a folder item's own 8 controls (the way past 8 items)
├── profileActions[]                            parameterized items; name = "$@Generic___@ProfileAction___<GUID>"
│   └── {templateActionName, actionParameters.parameters{…}, displayName, …}
├── macroCommands[] / macroAdjustments[]        multi-step macros; name = "<GUID>", ref "$@Generic___@Macro___<GUID>"
└── rotatePages[], profileSettings, conversionHistory, lastModifiedTimeUtc, packageName/Version, …
```

- **8 slots**, `controlId` 0 = top, then **clockwise** (0 top, 2 right, 4 bottom, 6 left),
  matching the UI's "Slot 1…8". No 9th slot; folders nest further pages.
- **Order is positional.** Moving an item (R2) rewrote only the two `pressAction`
  strings; the referenced action is untouched.
- **Empty slot:** `"pressAction": null` (R3 empty profiles, R4 removal).
- **A Ring item is a reference string, not a card.** Three forms were seen:
  `$<Plugin>___<Action>` (a plugin's built-in action, e.g. `$DefaultWin___LockWorkstation`),
  `$@Generic___@Macro___<GUID>` → `macroCommands`, and
  `$@Generic___@ProfileAction___<GUID>` → `profileActions`.
- **The UI never garbage-collects.** Removing an item leaves its `profileActions`
  entry and `.ict` behind (R4).

## Q3 — Per-application Rings

Supported: the UI's "+" offers "Obsługiwane aplikacje" (apps with an LPS plugin)
and "Inne aplikacje" plus a file picker (any executable). Neither reuses the
profile ids of [internals.md](internals.md); they are a separate identity scheme.

| App kind | LPS application | Matched by | Portable? |
|---|---|---|---|
| Global | `@_defaultwin` | fallback | yes (constant) |
| App without a plugin (R3c: 7-Zip) | folder and `processOrBundleName` = **lower-case exe stem** (`7zfm`) | process name only, no path | **yes**, better than settings.db custom apps |
| App with a plugin (R3: Chrome) | `@_chromeextension`, created by installing plugin `ChromeExtension` 6.0.5 into `LogiPluginService\Plugins\` | the plugin's `applicationPatterns.executablePathPattern` (`Google\\Chrome\\Application\\chrome.exe$`) | only if the plugin is installed; Chrome's also needs the Logi Web Extension in the browser |

A new app profile starts with 8 `null` slots (not a copy of Global). Installing a
plugin also adds stock profiles (`Default Chrome Profile`) and an app under every
`Loupedeck7x` device.

## Q4 — Action types

**A plain keyboard shortcut: yes** (R1, R3, R5), as a profile action:

```jsonc
{ "$type": "Loupedeck.Service.ApplicationProfileCommand, LoupedeckService",
  "isCommand": true,
  "name": "$@Generic___@ProfileAction___<GUID>",
  "templateActionName": "$@Generic___@KeyboardKey",
  "actionParameters": { "$type": "…ActionEditorActionParameters, PluginApi",
    "parameters": { "$type": "…StringDictionaryNoCase, PluginApi",
      "keyboardKey": "ControlOrCommand+Shift+Escape___{hkl}___Ctrl+Shift+Escape___win-27#¤%&+?132#¤%&+?{hkl}#¤%&+?1" },
    "count": 1 },
  "displayName": "Ctrl+Shift+Escape", "description": "Activate a keyboard shortcut …",
  "groupName": "", "superGroupName": "@macro", "isProfileAction": true,
  "isMultiState": false, "isResetCommand": false, "adjustmentName": null, "states": null }
```

It is **not** the `macro.keystroke {code, modifiers}` card of button slots, so
`catalog`/`model` cannot compile it; it needs its own encoder. `keyboardKey` has
four `___`-separated fields plus a platform part split by the literal `#¤%&+?`:

| Part | Observed | Meaning |
|---|---|---|
| logical keys | `ControlOrCommand+Shift+Escape` | layout-independent names (`ControlOrCommand`, `Shift`, `KeyC`, `Key5`, `Space`, `Insert`, `Escape`) |
| field 2 | `{hkl}` | the keyboard layout (HKL) the UI recorded with; `4108` in Mac entries |
| display | `Ctrl+Shift+Escape` | UI text |
| `win-<VK>` | `win-27` | Windows virtual-key code (VK_ESCAPE) |
| modifier flags | `132` | **not decoded**: only Ctrl+Shift was observed |
| layout again | `{hkl}` | same HKL |
| trailing | `1` | **not decoded** |

A stock `Insert` item in the shipped profile has **no platform part at all**
(`Insert___269222921___Insert___`), which suggests the platform part is optional.
Untested.

Other item kinds, **seen in the data, not experimented with**:

| UI offers | Stored as |
|---|---|
| System actions (lock, screenshot, magnifier, explorer, media) | `$DefaultWin___<Action>` reference, no definition needed |
| Run program / open file | profile action `$@Generic___@ShellExecute`, `parameters.filePath` (**a machine path**) |
| Folder | profile action `$@Generic___@OpenFolder`, `parameters.folderName` → `layout.folderPages[name]` |
| Easy-Switch | profile action `$@Generic___@EasySwitch` (`device`, `channel`) |
| Open URL, keyboard modifier, date/time, stopwatch, … | `@Generic` dynamic actions (`OpenUrlDynamicAction`, `KeyboardShortcutDynamicAction`, … in `Logs\plugin_logs\Generic.log`); storage not observed |
| Smart Actions / AI prompts ("Reply with ChatGPT", "Ask Perplexity") | most likely `macroCommands` (multi-step macros); not experimented |
| Plugin actions (Chrome: new tab, find, downloads, …) | `$ChromeExtension___Loupedeck.ChromeExtensionPlugin.Actions.<Command>` |

## Q5 — Portability

| Field | Machine-specific? | On apply |
|---|---|---|
| device type `Loupedeck72`, app `@_defaultwin`, `$type` strings, template names, `$DefaultWin___…` | no: Logitech constants | preserved |
| plugin-less app name (`7zfm`) | no: exe stem | derived from the spec's `executable` |
| plugin app name (`@_chromeextension`) | no, but exists only once the plugin is installed | mapped; refuse if absent |
| profile folder name (`409DF296…`) | **unknown** (came with the installed package; may be per install) | **resolved** from `ApplicationInfo.json` → `defaultProfileName`, never hard-coded |
| action GUIDs | yes: random in the UI | **regenerated** deterministically (`uuid5`, as for custom apps) |
| `keyboardKey` HKL | yes: the keyboard layout | **derived** on the target (`GetKeyboardLayout`), or dropped if the short form works |
| `ShellExecute.filePath` | yes: a path | would need resolving like custom-app paths |
| `.ict` icons, `lastModifiedTimeUtc`, `Snapshots\`, ini | UI state | not written (icons optional, R5) |

## Q6 — Write path

- **Owner:** `LogiPluginService.exe`, a **child of the agent** (`LogiPluginServiceExt.exe`
  is its child). The tool's existing forced stop (`taskkill /T /F` on the agent)
  stops both; restarting the agent brings LPS back in ~6 s (and the updater service,
  which had been stopped by quitting Options+ from the tray).
- **Never written while it runs.** Its own ini says so ("Don't modify this file while
  Logi Plugin Service is running!"), it holds the profile in memory, and the UI's
  edits go through it.
- **No re-save on start or stop**, unlike the agent. Watched 60 s after R5 and 45 s
  after R6, plus quitting Options+ before R5: the file stayed byte-identical. Its
  first write is the next UI edit to that profile. So "kept" is proven by the item
  working (R5 b/c), not by a re-save.
- **Canonical serialization round-trips byte for byte:**
  `json.dumps(doc, indent=4, ensure_ascii=False).replace("\n", "\r\n")`, **keeping key
  order** (Newtonsoft writes declared order; do not `sort_keys`). Verified on the
  Global profile before/after, the Chrome profile, and the 7-Zip profile. No BOM.
- **Upgrade migrations:** `conversionHistory` shows LPS converters rewrote this file
  on four LPS updates (`KeyboardKeyConverter 6.0.2`, `6.1.0`, `ai 6.1.3`, …, 2026-09-03).
- **One restart for both stores:** a Ring write fits inside the existing agent
  stop → write → start window of `transaction.apply_change`.

## Q7 — Verdict

**B — feasible with transformations**, like buttons. What makes it B and not A:

1. A second store and owner (LPS) beside `settings.db`, with its own guards
   (round-trip, layout shape, owner-stopped).
2. A new item encoder (`keyboardKey`), not the card compiler; its modifier flags
   and trailing field are undecoded beyond Ctrl+Shift+Esc.
3. Per-machine derivation of the layout HKL, deterministic action ids, and per-app
   profile resolution (`defaultProfileName`, creating the app folder for plugin-less apps).

What keeps it from C: nothing is encrypted, signed or checksummed; no IPC is
needed; the file round-trips; the owner does not fight external writes; the device
executes a written item.

## Proposed spec shape

Additive, optional, per profile, next to `buttons` (so `specVersion` stays 1;
implementation decides):

```json
{
  "specVersion": 1, "pack": "personal", "device": "mx-master-4",
  "profiles": [
    { "application": { "global": true },
      "actionsRing": {
        "top":    { "shortcut": "CTRL+SHIFT+Y" },
        "bottom": { "nothing": true }
      } },
    { "application": { "executable": "rider64.exe", "name": "Rider" },
      "actionsRing": { "right": { "shortcut": "CTRL+SHIFT+A" } } }
  ]
}
```

- **Slots:** `top`, `top-right`, `right`, `bottom-right`, `bottom`, `bottom-left`,
  `left`, `top-left` (aliases `1`…`8`) → `controlId` 0…7.
- **Actions (v1):** `shortcut` (same grammar as buttons) and `nothing` (→ `null`).
  Later: `raw` (verbatim `pressAction` plus its definition, the export fallback),
  system actions by name (`$DefaultWin___…`), folders.
- **Only listed slots are written**; every other slot and all other items stay
  byte-identical (surgical, as for buttons).
- **Applications:** `global` → `@_defaultwin`; `executable` → LPS app `<lower(exe stem)>`,
  created with an empty profile if missing; `builtin` → the plugin app if the
  plugin is installed, otherwise a recoverable error naming the plugin.

Transformations the implementation needs:

| Step | From spec | To LPS |
|---|---|---|
| slot | `top` | `controls[controlId=0]` |
| shortcut | `CTRL+SHIFT+ESC` | `keyboardKey` string (logical names, VK, modifier flags, target HKL) + a profile action in the UI's key order |
| action id | the shortcut | `$@Generic___@ProfileAction___` + `uuid5(RING_NAMESPACE, "keyboard:" + keyboardKey)` → idempotent |
| app | `rider64.exe` | `Applications\Loupedeck72\rider64\` (+ `ApplicationInfo.json`, profile with 8 `null` slots) |
| profile | — | `ApplicationInfo.json` → `defaultProfileName` |
| replace/remove | a slot that pointed at one of **our** ids | drop that profile action if nothing references it any more; never touch others |
| verify | decompile `pressAction` → action → `keyboardKey` logical part | equal to the spec (the drift check, as for buttons) |

`research/ring_poc.py` implements the slot, shortcut, id, profile, write and verify
steps for Ctrl+Shift+Esc.

## Risks after an Options+ / LPS update

| Most likely break | Caught by ("refuse, not corrupt") |
|---|---|
| LPS migrates `ProfileInfo.json` (it did on 4 past updates): new fields, new `$type` versions, a new `keyboardKey` format | round-trip guard (a writer change fails it); layout-shape guard; a verify that decompiles `keyboardKey` and refuses unknown formats |
| Newtonsoft settings change (indent, escaping, key order) | round-trip guard before any write |
| Ring moves to another device type / folder, or back into `settings.db` | `ApplicationInfo.json` / `deviceType` guard; nothing found → refuse |
| More than 8 controls, multiple pages or workspaces | layout guard (`controls == 0..7`, one mode/workspace/page) |
| LPS starts re-saving on start and normalizes our item | post-restart semantic check (the PoC's "item kept"), rollback from the backup |
| LPS no longer a child of the agent | "refuse to write while LogiPluginService runs" check after stopping the agent |

## Open questions

| Question | Experiment that settles it |
|---|---|
| `keyboardKey` modifier flags (`132`) and trailing field for other shortcuts | UI-record Ctrl+Alt+Y, Win+Shift+S, Alt+F4, a bare letter; diff (like E1) |
| Is the platform part optional (portable string without the HKL)? | R5b: write the short form `…___Ctrl+Shift+Escape___`, test on the device |
| Second machine / other keyboard layout | run `ring_poc.py --dry-run`, then R5 there |
| Can LPS be restarted alone (no agent restart, buttons stay live)? | kill only `LogiPluginService.exe`, see whether the agent respawns it |
| Writing a new plugin-less app profile from scratch (not UI-created) | R5c: create `Applications\Loupedeck72\<stem>\` programmatically, test with the app in front |
| Is the Global profile folder name random per install? | compare `defaultProfileName` on a second machine or after a reinstall |
| Are `settings.db`'s `radial-menu` slots ever read? | not needed for the feature; leave untouched |
| Logitech account sync of LPS profiles | untested, as for `settings.db` |

## Evidence

The raw snapshots and file copies stayed under `~/.m-control/research/logi-options/`
(they contain paths and serials). The UI-written items are preserved in
[`../research/ring-ui-written.json`](../research/ring-ui-written.json), ready to move to `test/fixtures/`.

| # | Action | Result |
|---|---|---|
| R0 | two idle snapshots 20 s apart, watch list widened to all of LogiPluginService, `%PROGRAMDATA%\Logi`, `Logishrd`, `HKCU\Software\Logitech` | 0 changes |
| R1 | UI: Global Ring slot 1 (was Media Play/Pause) → keyboard shortcut Ctrl+Shift+Esc | `settings.db`: noise only, radial-menu cards untouched. Ring `ProfileInfo.json`: `controls[0].pressAction` → new `@ProfileAction___<GUID>`, one `@KeyboardKey` profile action appended, `lastModifiedTimeUtc`; plus an `.ict`. Both before/after files round-trip byte for byte |
| R2 | UI: drag it to slot 5 | swap of `controls[0]`/`controls[4]` `pressAction` only; UI undo point in `Snapshots\` |
| R3 | UI: add a Chrome Ring, then set its slot 1 → Ctrl+Shift+Esc | plugin `ChromeExtension` installed, app `@_chromeextension` ×3 devices, empty profile (8 `null`); then the same action body as R1 (new GUID) |
| R3c | UI: add a 7-Zip Ring (no plugin) | app `7zfm`, `processOrBundleName: "7zfm"`, empty profile; no path stored |
| R4 | UI: remove the Global item | slot → `null`; profile action and `.ict` left orphaned; not byte-identical to R0 |
| R5 | `ring_poc.py`: owner stopped (it was already quit), write the item into slot 5 of the R4 state, deterministic id, no `.ict`, restart | kept byte for byte (60 s, no LPS re-save); **verified on the device**: item shown with label and icon, Task Manager opens; shown in the UI; second apply a no-op with no process touched |
| R6 | restore LPS (minus `Logs\`, `Temp\`) and `cc_config.json` from the session-start copy, owner stopped | 0 differences after 45 s of LPS running, except LPS's `Sentry/LastOsCrashReportChecked` start stamp; `settings.db` profiles and `profile_keys` identical to R0 |

Known LPS noise, for future diffs: `Logs\`, `Temp\` (`GetServiceState.json`,
`WebSocketPort.txt`, `WebSocketServer.txt`, `DictionaryCache\`), the ini's `Sentry/…`
line, `Snapshots\*.st4`, and the daily `Applications.Backups` zip.
