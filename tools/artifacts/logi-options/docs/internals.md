# Internals — how Logi Options+ stores mouse configuration

This was reverse-engineered on 2026-09-24 on Windows 11 (26200) with Options+
catalog build `853130` (agent 2.7.961922) and an MX Master 4 (model `2b042`),
using controlled experiments (see [Evidence](#evidence)). Everything here was
observed, not assumed. Re-verify after Options+ updates
([maintenance.md](maintenance.md)).

## Where state lives

| Location | Holds | Changed by a binding edit? |
|---|---|---|
| `%LOCALAPPDATA%\LogiOptionsPlus\settings.db` (+`-wal`, `-shm`) | **everything**: profiles, bindings, app list, device state | **yes: the only file** |
| `%LOCALAPPDATA%\LogiOptionsPlus\macros.db`, `privacy_settings.db`, `logi_voice_settings.db` | one flag / consent + region history / empty | no |
| `%LOCALAPPDATA%\LogiOptionsPlus\cc_config.json` | UI state: theme, language, tours | no |
| `%LOCALAPPDATA%\LogiOptionsPlus\icon_cache\<sha256(lower-cased exe path)>.png` | one icon per executable the agent has seen | no |
| `%APPDATA%\logioptionsplus\` | Electron profile (window geometry, IndexedDB UI cache) | churns, but not authoritative: the UI rebuilt correctly from the agent after every external write |
| `%PROGRAMDATA%\LogiOptionsPlus\depots\<build>\` | **Logitech's catalogs**: card presets, built-in apps, device packages | no. Read-only input for the compiler, never copied into this repo |
| `HKCU\Software\Logitech\LogiOptionsPlus\Data` | 4 binary values; they rotate together with `accounts_refresh_token_expiration` | encrypted account tokens, not settings |

## settings.db

```sql
CREATE TABLE data(_id INTEGER PRIMARY KEY, _date_created datetime default current_timestamp, file BLOB NOT NULL)
CREATE TABLE snapshots(_id INTEGER PRIMARY KEY, _date_created datetime default current_timestamp,
                       uuid TEXT NOT NULL, label TEXT NOT NULL, file BLOB NOT NULL)   -- 0 rows
```

- **One row** in `data`. `file` is one **UTF-8 JSON document** (~226 KB, `schema_version: 26`).
  It's not compressed, not encrypted, not signed, and not checksummed.
- **Rewrite-on-save.** The agent rewrites the whole document on every save,
  including right after it starts. `_date_created` is the time of the last save.
- **Canonical form.** `json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True)`
  reproduces the blob **byte for byte**, which makes patches provably minimal.
  `store.read_db()` refuses to continue if that ever stops being true.
- **proto3-JSON conventions.** Default scalars are omitted (`readOnly: false`, `code: 0`),
  enums are strings, empty sub-messages are kept (`"macro": {}`), and empty maps
  are dropped (`nestedCards`). The agent evidently holds a protobuf model:
  fields it doesn't know are dropped on load (the catalog's `category` never appears).
- **Safe concurrent reads.** `?mode=ro` plus the SQLite backup API gives a
  consistent copy while the agent runs, without writing or checkpointing.

## The model

```
settings document
├── profile_keys: ["profile-<id>", …]                 sorted; the agent re-sorts it on load
├── profile-<id>                                       one per application
│   ├── id == applicationId
│   ├── baseProfileId → Global id                      app profiles only
│   └── assignments[]                                  one per slot
│       ├── slotId = <device slot prefix>_<control>    mx-master-4-2b042_c83
│       ├── cardId = card.id
│       ├── tags   = ["UI_PAGE_BUTTONS"]
│       └── card                                       the action: a full copy, no references
│           ├── id, attribute, macro {type, keystroke {code, modifiers[]}, …}
│           ├── nestedCards {name → card}, selectedNestedCard   (gesture button)
│           └── name, icons, tags, taskId              UI metadata; varies with the Options+ version
├── applications.applications[]                        built-ins it detected + custom apps
│   └── custom: {applicationId, applicationPath (lower-case), applicationPathsList[], isCustom, name, posterPath, posterUrl, …}
└── device state: ever_connected_devices, easy_switch, battery/…, dfu/…, iconsLocalPathCache
```

- **App profiles hold only the 7 button slots.** The Global profile also holds
  device settings (`_mouse_settings`, `_mouse_scroll_wheel_settings`,
  `_haptic_settings`, `_force_sensing_settings`, `_mouse_thumb_wheel_settings`),
  webcam slots, and the Actions Ring's own slots.
- **Slots** come from the device package's `core_metadata.json`. Control suffixes
  are HID++ control ids: `c82` middle (0x52), `c83` back, `c86` forward, `c195`
  gesture/thumb (0xC3), `c196` mode shift/top, `c416` haptic panel (0x1A0),
  plus `thumb_wheel_adapter`.

### Identity

| Profile | Key | Deterministic across machines? |
|---|---|---|
| Global | `profile-420fd454-0c36-499d-bde4-146823b16147`, the key of `defaults_slot.json` in every device package | yes |
| Built-in app | `profile-application_id_<name>`, from the catalog (`applications.json`, 22 apps) | yes |
| Custom app made in the UI | `profile-<random uuid4>` | no, so import matches by executable **name** |
| Custom app made by this tool | `profile-<uuid5(lower(exe name))>` | yes (`model.APP_NAMESPACE`; pinned by a test) |

Profiles are keyed by device **model**, never by serial or host.

### How the UI builds a card

Verified byte-for-byte by `test/test_model.py` against the evidence in `test/fixtures/ui-written.json`.

1. Take the preset from `card_presets/card_presets_win.json`, or the built-in
   app's own variant from `applications.json` when there is one.
2. Normalize (`catalog.normalize`): drop proto3 defaults and empty lists/maps,
   keep empty sub-messages, drop `category`, sort keys.
3. **Keyboard shortcut:** start from `card_global_presets_keyboard_shortcut`
   and set `macro.keystroke = {code, modifiers[], virtualKeyId, displayCharacter}`.
   `code` and `modifiers` are **USB HID usages** (A=4…Z=29, Esc=41, Tab=43,
   Left=80; LCtrl=224, LShift=225, LAlt=226, LWin=227, R* = 228–231, sorted
   ascending). `virtualKeyId` and `displayCharacter` are cosmetic; catalog cards omit them.
4. **Custom gestures:** set `selectedNestedCard: "custom_gesture"` on the gesture
   card, and put ordinary action cards under
   `nestedCards.custom_gesture.nestedCards.{up,down,left,right,click}`.
   The UI also records the last-edited direction in
   `custom_gesture.selectedNestedCard`, which is UI state.
5. **New app profile:** the device's `default_configurations.json` control
   defaults, overlaid with `defaults_slot.json` for Global and then for the app.
   It is not a copy of the Global profile.
6. **Custom app entry:** `{applicationId, applicationPath, applicationPathsList, isCustom, name}`
   plus `posterPath`/`posterUrl` pointing into `icon_cache`. The profile tab
   icon reads those two fields, and the agent never back-fills them for entries
   it didn't create (observed as a generic icon until they were added).

`tags`, `icons`, and `taskId` come from whichever catalog version wrote a card.
Cards from 2025 lack tags that today's UI adds, and the agent loads both. The
decompiler (`model.card_action`) ignores them. Two cards are equal when they
decompile to the same portable action.

## Process model and reload behaviour

| Process | Role |
|---|---|
| `logioptionsplus_updater.exe` | service `OptionsPlusUpdaterService` (SYSTEM, auto-start). Installs updates and launches the agent in the console user's session. It does **not** respawn a stopped agent (watched 25 s) |
| `logioptionsplus_agent.exe` | the backend and **sole writer of settings.db**. Owns the device, resolves the foreground app, executes actions. Pipe `\\.\pipe\logitech_kiros_agent-<hash>`; TCP `0.0.0.0:59869` (likely Flow) |
| `logioptionsplus_appbroker.exe` | spawned by the agent; survives an agent tree-kill harmlessly |
| `LogiPluginService.exe` / `…Ext.exe` | plugin host (Actions Ring, marketplace); children of the agent |
| `logioptionsplus.exe` ×N | Electron UI, a client of the agent. It never touched settings.db |

What applying a change needs:

- **The agent must be stopped.** It holds the document in memory and rewrites
  all of it on its next save. Writing while it runs was deliberately never tried
  (the risk is corrupting live state), and `Store.write()` refuses to.
- **Forced stop.** `taskkill` without `/F` returns SUCCESS but the agent keeps
  running. A forced stop is safe for the data: SQLite commits are durable, and
  the store was intact after every one of 7+ cycles.
- **Start** `logioptionsplus_agent.exe` as the user. Its first re-save comes
  ~8 s later, and that re-save is the signal that it loaded the document.
- **The UI** reconnects by itself and shows new bindings. Only a new app
  *icon* needs the window reopened (Electron image cache).
- **Not needed:** logoff, device reconnect, admin rights, or a service restart.
- **Not used:** the agent pipe. It's how the UI applies changes live, but it's
  an undocumented protocol, far more fragile than the file store (ADR-0011).
- **Cloud backup.** `settings_backup_state_v2` is all `false` on the reference
  machine. If Logitech account backup is enabled, a cloud restore could
  overwrite applied profiles. Untested.

## Evidence

The controlled experiments. The raw snapshots stayed on the reference machine
because they contain personal data. The UI-written cards are preserved in
`test/fixtures/ui-written.json`.

| # | Action | Result |
|---|---|---|
| E0 | two idle snapshots 20 s apart | 0 changes: files, registry, document |
| E1 | UI: Global → top button → shortcut Ctrl+Shift+Esc | exactly one assignment changed (`_c196`: mode-shift card → keyboard-shortcut card, `code 41, modifiers [224,225]`), plus token noise. `settings.db-wal` was the only config file touched |
| E1a–b | stop / start the agent | not respawned; no write on shutdown; re-save with noise only on start; profiles intact |
| E1c–d | revert `_c196` from a raw export, then re-apply it | kept by the agent; **verified at the device** (SmartShift toggles; Task Manager opens); second apply a no-op |
| E2 | UI: add a Chrome profile | `profile-application_id_google_chrome`, built from defaults (the top button was mode-shift while Global's was Ctrl+Shift+Esc) |
| E3 | UI: Chrome thumb → custom gestures left/right | as in step 4 above |
| E4 | compile E1 and E3 from specs | byte-identical to the UI's output |
| E5 | import a generated Rider profile (new custom app, uuid5) | kept; profile listed; **verified at the device**: the haptic panel sends Ctrl+Shift+A only while Rider is in front |
| E5a | Rider tab showed a generic icon | fixed by writing `posterPath/posterUrl`; verified |
| E6 | remove the test profiles, restore `_c196` from raw bytes | Global, WebStorm, `profile_keys`, custom-app list byte-identical to before E1 |

**Feasibility verdict:** B, feasible with transformations. Custom apps need an
id and a path resolved per machine, and applying needs an agent restart.
Everything else is either a constant or rebuilt from the installed catalog.
The reasoning is in ADR-0011.
