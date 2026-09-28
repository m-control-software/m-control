# Actions Ring — can it be written from a spec?

A feasibility study; the implementation is `lib/ring.py` (ADR-0013).
Reverse-engineered on 2026-09-27/28 on Windows 11 (26200), Options+ agent 2.7.961922, catalog build `853130` (unchanged
since [internals.md](internals.md)), **LogiPluginService 6.4.1.3246**, MX Master 4,
with the controlled-change method of [maintenance.md](maintenance.md). Everything
here was observed unless it says otherwise; see [Evidence](#evidence).

**Verdict: B — feasible with transformations.** A keyboard-shortcut Ring item was
written programmatically, kept by its owner, shown in the Ring and the UI, and
opened Task Manager on the device; a second apply changed nothing. The shortcut
encoding is decoded and reproduced byte for byte; the layout id must be filled in
per machine but need not match the active layout. The Ring is
*not* in `settings.db` but in a second store with a second owner, and its items are
not Logitech cards, so it needs its own (small) compiler.

**Decided in [ADR-0013](../../../../docs/adr/0013-actions-ring-in-logi-options-packs.md).**
Where this study and the ADR differ (v1 scope, action ids, drift equality), the
ADR wins; "Proposed spec shape" below is the study's input to it.

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
| **Chrome without its plugin (R7)** | plugin-less app `chrome`, written by the tool | process name `chrome` | **yes**: the plugin isn't needed for a Chrome Ring |

A new app profile starts with 8 `null` slots (not a copy of Global). Installing a
plugin also adds stock profiles (`Default Chrome Profile`) and an app under every
`Loupedeck7x` device.

**A plugin-less app written by a script works (R5c, R7).** The files the UI
wrote for 7-Zip, reproduced with deterministic ids, were enough for both `chrome`
(an app that has a Logitech plugin, not installed) and `notepad` (an app the UI
never saw, and a Store app). The right Ring showed with the app in front, the
item fired, and the Global Ring came back with another app in front. The Options+
UI lists both apps with their icons and edits them like its own (K4).

- **`defaultProfileName` is `null` for plugin-less apps** (R3c, as the UI writes
  it), and the profile folder name is random. The profile is **the only folder
  under `Profiles\`**; a tool refuses when there are several. Only plugin apps and
  `@_defaultwin` name theirs.
- `ApplicationInfo.displayName` is what the UI shows as the app's name (the UI
  took 7-Zip's from the exe's version info). The profile's `displayName` is
  localized by the UI (`"7-Zip File Manager Profil"`) and isn't shown in the Ring.
- A UI edit of a script-created profile rewrote only what it edited: our item
  stayed byte-identical, and the file still round-trips (K4).

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
`catalog`/`model` cannot compile it; it needs its own encoder.

### The `keyboardKey` grammar (K1)

Decoded from fifteen UI recordings (Polish Programmers layout; K1 and K4) plus
Ctrl+Shift+Esc from R1. `research/ring_poc.py`'s `encode()` rebuilds **all sixteen
byte for byte** from this grammar and the machine's layout.

```
<logical>___<hkl>___<display>___win-<VK>#¤%&+?<flags>#¤%&+?<hkl>#¤%&+?<scan>
```

`___` separates the four fields, and the literal `#¤%&+?` separates the parts of the
Windows platform part (the fourth field). Everything is decimal.

| Part | Rule | Evidence |
|---|---|---|
| `<logical>` | modifiers then key, `+`-joined. Modifiers: `ControlOrCommand`, `AltOrOption`, `Windows`, `Shift`. Keys: `Key<A-Z>`, `Key<0-9>`, `F<n>`, `Escape`, `Space`, `ArrowLeft`, `Return`, `Oem2` (the `/` key, VK_OEM_2); also seen in stock items: `Insert` | K1, K4 rows |
| modifier order | **Ctrl, Win, Alt, Shift** as far as observed: Ctrl < Alt, Ctrl < Shift, Win < Shift (K1), Win < Alt, Alt < Shift (K4). Ctrl vs Win was never recorded: the encoder rejects a shortcut with both | K1 rows 1–3, 8; K4 rows 1–2 |
| `<hkl>` (both) | the HKL of the keyboard layout active in the Options+ window when recording, decimal: `0x04150415` Polish, `0x04090409` US | K2.2 |
| `<display>` | the UI label: `Ctrl`, `Win`, `Alt`, `Shift`, then the key (`Y`, `1`, `F4`, `Escape`, `/`, `ArrowLeft`, `Return`, and a literal space for Space), `+`-joined, same order as `<logical>`. Cosmetic: the UI shows it, nothing replays from it | K1, K4 rows |
| `win-<VK>` | the **Windows virtual-key code** of the key (Y 89 = 0x59, S 83, Z 90, 1 49, F4 115 = 0x73, F13 124 = 0x7C, Esc 27, Space 32, Left 37, Enter 13, `/` 191 = 0xBF) | K1, K4 rows |
| `<flags>` | a **bitmask** of modifiers: **Alt 2, Shift 4, Win 8, Ctrl 128**. Bits 1, 16, 32, 64 never appeared (**guessed**: unused on Windows) | 134 = Ctrl+Alt+Shift, 132 = Ctrl+Shift, 130 = Ctrl+Alt, 12 = Win+Shift, 10 = Win+Alt, 2 = Alt, 128 = Ctrl, 0 = none |
| `<scan>` | the **scan code** (set 1) of the key under that layout (`MapVirtualKeyEx(VK, MAPVK_VK_TO_VSC, hkl)`): Y 21 = 0x15, S 31, Z 44 = 0x2C, 1 2, F4 62 = 0x3E, F13 100 = 0x64, Esc 1, Space 57, Left 75 (no extended bit), Enter 28, `/` 53 | K1, K4 rows |

| Recorded in the UI | Stored `keyboardKey` (`#¤%&+?` shown as ` # `) |
|---|---|
| Ctrl+Shift+Y | `ControlOrCommand+Shift+KeyY___{hkl}___Ctrl+Shift+Y___win-89 # 132 # {hkl} # 21` |
| Ctrl+Alt+Y | `ControlOrCommand+AltOrOption+KeyY___{hkl}___Ctrl+Alt+Y___win-89 # 130 # {hkl} # 21` |
| Win+Shift+S | `Windows+Shift+KeyS___{hkl}___Win+Shift+S___win-83 # 12 # {hkl} # 31` |
| Alt+F4 | `AltOrOption+F4___{hkl}___Alt+F4___win-115 # 2 # {hkl} # 62` |
| Y | `KeyY___{hkl}___Y___win-89 # 0 # {hkl} # 21` |
| F13 (injected, the keyboard has none) | `F13___{hkl}___F13___win-124 # 0 # {hkl} # 100` |
| RCtrl+Y | `ControlOrCommand+KeyY___{hkl}___Ctrl+Y___win-89 # 128 # {hkl} # 21`: **identical to left Ctrl** |
| Ctrl+Shift+Z (control: Z/Y as on US) | `ControlOrCommand+Shift+KeyZ___{hkl}___Ctrl+Shift+Z___win-90 # 132 # {hkl} # 44` |
| Ctrl+Shift+Esc (R1) | `ControlOrCommand+Shift+Escape___{hkl}___Ctrl+Shift+Escape___win-27 # 132 # {hkl} # 1` |
| Ctrl+Alt+Shift+Y (K4) | `ControlOrCommand+AltOrOption+Shift+KeyY___{hkl}___Ctrl+Alt+Shift+Y___win-89 # 134 # {hkl} # 21` |
| Win+Alt+Y (K4) | `Windows+AltOrOption+KeyY___{hkl}___Win+Alt+Y___win-89 # 10 # {hkl} # 21` |
| Ctrl+1 (K4) | `ControlOrCommand+Key1___{hkl}___Ctrl+1___win-49 # 128 # {hkl} # 2` |
| Ctrl+Shift+/ (K4) | `ControlOrCommand+Shift+Oem2___{hkl}___Ctrl+Shift+/___win-191 # 132 # {hkl} # 53` |
| Ctrl+Space (K4) | `ControlOrCommand+Space___{hkl}___Ctrl+ ___win-32 # 128 # {hkl} # 57`: the UI shows "Ctrl+ ", but the item is complete |
| Alt+Left (K4) | `AltOrOption+ArrowLeft___{hkl}___Alt+ArrowLeft___win-37 # 2 # {hkl} # 75` |
| Ctrl+Enter (K4) | `ControlOrCommand+Return___{hkl}___Ctrl+Return___win-13 # 128 # {hkl} # 28` |

Keys with no recording (Tab, Delete, Home, the other arrows, the other OEM keys, …)
have names that can be guessed (`ArrowRight`? `Oem1`? `OemComma`?) but weren't
observed, so the encoder rejects them. A slot the UI made with one of them still
decompiles, and exports as `raw`.

- **No left/right modifiers.** RCtrl was stored exactly as Ctrl, so the Ring can't
  express `RCTRL` and friends; an encoder must reject them rather than silently map them.
- **Playback sends left modifiers.** LPS sent `LCtrl`, `LShift`, `Y` as injected
  events (`SendInput`, `dwExtraInfo` 0), modifiers pressed first and released last.
- **The UI edits in place.** Re-recording keeps the action's GUID and rewrites its
  body, so a written item's id says nothing about its content: compare content.
- **The platform part is required (K2.1).** Two forms were written with the PoC and
  both were loaded and labelled "Ctrl+Shift+Y", but **selecting them sent nothing**:
  `short` (`…KeyY______Ctrl+Shift+Y___`, no platform part, no layout) and `nolayout`
  (platform part kept, both `<hkl>` empty). The full form sent Ctrl+Shift+Y. The stock
  `Insert___269222921___Insert___` item has no platform part, so it is probably inert
  on Windows too (**guessed**; it isn't in any Ring slot).
- Mac entries in the stock profile use a different platform part
  (`mac-<keycode>#¤%&+?<CGEventFlags>#¤%&+?<char>#¤%&+?<input source>`), not needed here.

**The label is free text (K5).** An item whose `displayName` is `"YT → mp3"`
while its shortcut is Ctrl+Shift+Esc showed that label in the Ring and in the
Options+ UI, kept the non-ASCII arrow (written verbatim, `ensure_ascii=False`),
survived restarts and a UI edit of another slot, and still fired. No `.ict` was
written; the Ring drew its own icon.

### System actions (S1)

The installed definition is
`%ProgramFiles%\Logi\LogiPluginService\Plugins\DefaultWin\localization\DefaultWinPlugin.xliff`,
group `@commands` of `<file original="$DefaultWin___System">` (English `source`
labels; `_pl-PL.xliff` etc. hold the translations). A Ring slot references one as
`$DefaultWin___<Name>`, with no definition in the profile (R0: `MediaPlayPause`,
`LockWorkstation`, `WindowsScreenshot`, `WindowsMagnifier`, `WindowsExplorer`).
LogiPluginService 6.4.1.3246 ships:

| `<Name>` | Label | | `<Name>` | Label |
|---|---|---|---|---|
| `LockWorkstation` | Lock Workstation | | `NextDesktop` | Next Desktop |
| `WindowsActions` | Windows Actions (Quick Settings) | | `PreviousDesktop` | Previous Desktop |
| `WindowsDesktop` | Windows Desktop (show/hide) | | `VolumeUp` | Volume Up |
| `WindowsExplorer` | Windows Explorer | | `VolumeDown` | Volume Down |
| `WindowsSettings` | Windows Settings | | `VolumeMute` | Toggle Mute |
| `WindowsRun` | Windows Run | | `MediaPlayPause` | Play/Pause |
| `WindowsSearch` | Windows Search | | `MediaStop` | Stop |
| `WindowsScreenshot` | Windows Screenshot | | `MediaNextTrack` | Next Track |
| `WindowsEmoji` | Emoji | | `MediaPrevTrack` | Previous Track |
| `WindowsKeyboardLayout` | Keyboard Layout | | `ActivateMenuBar` | Activate Menu Bar |
| `WindowsMagnifier` | Magnifier | | `ResetBrightness` | Reset Screen Brightness |
| `AddDesktop` | Add Desktop | | `ResetVolume` | Toggle Mute (the Volume dial's reset) |
| `CloseDesktop` | Close Desktop | | | |

Not plain commands, so not in that list for a spec: `Brightness` and `Volume` (group
`@adjustments`, dials), and `Loupedeck.DefaultWinPlugin.WindowsSettingsApplicationDynamicCommand`
(a parameterized dynamic command). The DLL's strings match the names; the xliff is
the readable list, so a tool reads it at run time instead of freezing a copy, as
it does with the Options+ catalogs.

Other item kinds, **seen in the data, not experimented with**:

| UI offers | Stored as |
|---|---|
| System actions (lock, screenshot, magnifier, explorer, media) | `$DefaultWin___<Action>` reference, no definition needed (S1 above) |
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
| `keyboardKey` HKL | yes: the keyboard layout | **filled in** on the target, never taken from the spec (K2; see below) |
| `keyboardKey` scan code | per layout, but equal for letters and F-keys on Polish/US | **derived** on the target (`MapVirtualKeyEx`) |

### Can the spec omit the layout id? (K2)

**The spec omits it; apply must fill it in.** An empty layout makes the item inert
(K2.1). But it doesn't have to match the layout in use: an item recorded under US
(`0x04090409`) fired correctly with Polish active (K2.2). So apply writes any valid
HKL installed on the target, in this order:

1. the default input layout: `HKCU\Keyboard Layout\Preload\1` (a KLID such as
   `00000415`), as the HKL the system loaded for it, or
2. the first entry of `GetKeyboardLayoutList`, or
3. `GetKeyboardLayout(0)` of the applying process (what `ring_poc.py` does; for a
   console process it returned the default layout here).

It must also compute `<scan>` with `MapVirtualKeyEx` for *that* HKL. Only layouts
that put the key at the same VK and scan code as US were tested. On a layout where
they differ (German QWERTZ: Y and Z swapped), which of VK, scan and HKL LPS
replays from is **not known**.
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
- **LPS alone can be restarted (K3), but that is not a write window.** Killing only
  `LogiPluginService.exe` (tree: `…Ext.exe` and its host) left the agent running; the
  agent respawned LPS after **1.5 s** (old process gone after 1.2 s), `…Ext.exe`
  followed, and the Ring came back. **The mouse buttons kept working throughout**
  (verified on the device). So a Ring-only change could be *reloaded* without
  touching the buttons. But with the agent respawning LPS in about 1.5 s,
  "kill LPS, then write" is a race: writes still need the agent tree stopped.

## Q7 — Verdict

**B — feasible with transformations**, like buttons. What makes it B and not A:

1. A second store and owner (LPS) beside `settings.db`, with its own guards
   (round-trip, layout shape, owner-stopped).
2. A new item encoder (`keyboardKey`), not the card compiler. The grammar is decoded
   (K1, K4) and reproduced byte for byte; Ctrl vs Win order and the unrecorded keys
   are rejected rather than guessed.
3. Per-machine derivation of the layout HKL, deterministic action ids, and per-app
   profile resolution (`defaultProfileName`, creating the app folder for plugin-less apps).

What keeps it from C: nothing is encrypted, signed or checksummed; no IPC is
needed; the file round-trips; the owner does not fight external writes; the device
executes a written item.

## Proposed spec shape

The input to ADR-0013, kept as written. ADR-0013 changed three things: v1 also
has `system` and `raw` actions, action ids derive from the spec action
(`uuid5(RING_NAMESPACE, "shortcut:CTRL+SHIFT+Y")`), not from the encoded
`keyboardKey`, and a slot is in sync when it decompiles to the spec action,
whatever installed HKL it carries.

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
| shortcut | `CTRL+SHIFT+ESC` | `keyboardKey` per [the grammar](#the-keyboardkey-grammar-k1): logical names, VK, flag bits, the target's HKL and scan code; plus a profile action in the UI's key order. Reject `RCTRL`/`RSHIFT`/`RALT`/`RWIN` (not expressible) |
| action id | the shortcut | `$@Generic___@ProfileAction___` + `uuid5(RING_NAMESPACE, "shortcut:" + canonical spec shortcut)` → idempotent, same on every machine and layout (ADR-0013; `ring_poc.py` still hashes the encoded `keyboardKey`) |
| app | `rider64.exe` | `Applications\Loupedeck72\rider64\` (+ `ApplicationInfo.json`, profile with 8 `null` slots) |
| profile | — | `ApplicationInfo.json` → `defaultProfileName` |
| replace/remove | a slot that pointed at one of **our** ids | drop that profile action if nothing references it any more; never touch others |
| verify | decompile `pressAction` → action → `keyboardKey` logical part | equal to the spec (the drift check, as for buttons) |

`research/ring_poc.py` implements the slot, shortcut (`--shortcut`, `encode()`), id,
profile, write and verify steps for Ctrl/Alt/Win/Shift with A–Z, F1–F24 or Esc.

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
| Modifier order for Ctrl vs Win (e.g. Ctrl+Win+Y) | UI-record it; diff. Alt vs Win and Alt vs Shift were settled by K4 |
| Logical names of the unrecorded keys: other arrows, other OEM keys, Tab, Delete, Home, … | UI-record them; diff. K4 settled digits, `/`, Space, Left, Enter |
| On a layout where VK and scan differ from US (German QWERTZ), what does LPS replay? | add German, record Ctrl+Y under it, replay under Polish with the key logger |
| Does *any* installed HKL work, or only one whose VK/scan agree with the key? | same experiment; also write an item with the UK HKL and replay |
| Second machine | run `ring_poc.py --dry-run`, then R5 there |
| Is the Global profile folder name random per install? | compare `defaultProfileName` on a second machine or after a reinstall |
| Are `settings.db`'s `radial-menu` slots ever read? | not needed for the feature; leave untouched |
| Logitech account sync of LPS profiles | untested, as for `settings.db` |

## Evidence

The raw snapshots and file copies stayed under `~/.m-control/research/logi-options/`
(they contain paths and serials). The UI-written items are preserved in
[`../test/fixtures/ring-ui-written.json`](../test/fixtures/ring-ui-written.json), the evidence `test/test_ring.py` checks the implementation against.

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
| K1 | UI, 2026-09-27, Polish Programmers layout: record 8 shortcuts in turn into Global slot 1 (the list in [the grammar](#the-keyboardkey-grammar-k1)); a watcher took a full snapshot before and after each | each step changed only the Ring profile and its `.ict` (plus one UI undo point); one profile action edited in place; the grammar above; `encode()` reproduces all 8 (+R1) byte for byte |
| K2.1 | `ring_poc.py --form short`, then `--form nolayout`, then `--form full` (control), Ctrl+Shift+Y in slot 1, each with the owner stopped | all three kept and labelled "Ctrl+Shift+Y" in the Ring. **Verified on the device with a low-level key logger**: `short` and `nolayout` sent nothing; `full` sent injected LCtrl↓ LShift↓ Y↓ Y↑ LShift↑ LCtrl↑ |
| K2.2 | UI, 2026-09-28: re-record Ctrl+Shift+Y with the US layout active in the Options+ window; then select it with Polish active | both `<hkl>` fields became `0x04090409`, all else unchanged; **verified on the device**: it sent Ctrl+Shift+Y under Polish |
| K3 | kill only the LPS process tree, press a mouse button throughout | agent (same PID) respawned LPS in 1.5 s; buttons kept working (**verified on the device**); Ring back; nothing written |
| R6b | restore the follow-up's start state (Ring profile, 2 orphaned `.ict`, LPS's daily-backup files, ini), owner stopped | 0 differences after 45 s, except `backup.date` and the Sentry stamp; `settings.db` profiles identical to the follow-up baseline |
| R7 | 2026-09-28, ChromeExtension plugin **not** installed (no `Plugins\`, only `@_defaultwin`): `ring_poc.py --app chrome --create`: plugin-less app `chrome` (the 7-Zip files of R3c, deterministic ids), Ctrl+Shift+Esc in slot 1, owner stopped | kept byte for byte (30 s). **Verified on the device**: Chrome in front shows the Chrome Ring (slot 1 only), the item opens Task Manager; another app in front shows the Global Ring. **Logitech's plugin and web extension are not needed** |
| R5c | the same for `notepad` (never seen by the UI; Windows 11 Store Notepad, process `Notepad.exe`) | kept; **verified on the device**: Notepad Ring shown, item fires |
| K5 | `ring_poc.py --label "YT → mp3"`: only the `displayName` of the Chrome slot-1 item changed | kept; **verified on the device**: "YT → mp3" shown in the Ring and in the Options+ UI, arrow intact, Task Manager still opens |
| K4 | UI, Polish Programmers: record Ctrl+Alt+Shift+Y, Win+Alt+Y, Ctrl+1, Ctrl+Shift+/, Ctrl+Space, Alt+Left, Ctrl+Enter in turn into slot 2 of the script-created Chrome Ring; a watcher copied the profile after each save | one profile action edited in place per step; the rows above; `encode()` reproduces all 16 recordings byte for byte. The UI left the script-written slot-1 item byte-identical and wrote one `.ict` and one undo point. The Ctrl+Space recording showed "Ctrl+ " in the UI but is complete in the file |
| S1 | read the installed LPS files (`Plugins\DefaultWin\localization\DefaultWinPlugin.xliff`, `DefaultWinPlugin.dll`, `Logs\plugin_logs\DefaultWin.log`) | the `$DefaultWin___…` list above; nothing written |
| R6c | restore the phase start (delete `chrome\`, `notepad\`, the undo point; ini from the baseline copy), owner stopped | all 2568 files of the baseline hash manifest identical, except the ini's Sentry stamp; `check=true` in sync |

Known LPS noise, for future diffs: `Logs\`, `Temp\` (`GetServiceState.json`,
`WebSocketPort.txt`, `WebSocketServer.txt`, `DictionaryCache\`, `mp\MarketplaceInfo.bin`),
the ini's `Sentry/…` line, `Snapshots\*.st4`, and `Applications.Backups`. LPS's daily
backup: on its first start of a day it writes `backup.date`, zips `Applications\` and
keeps the zip only if its hash differs from `backup.hash`. So a zip taken during an
experiment captures test state, and after restoring you'll see one more `backup.date` change.
Agent-side: `easy_switch…deviceId` can renumber across restarts, and
`%PROGRAMDATA%\LogiOptionsPlus\periodic_check.json` is the updater's daily check.
