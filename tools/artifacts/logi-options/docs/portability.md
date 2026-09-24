# Portability and sync

## What a profile depends on

| Field / concept | Machine-specific? | On apply |
|---|---|---|
| Slot ids (`mx-master-4-2b042_c83`) | no: device **model** + HID++ control id | **preserved** (from the device table) |
| Device serial / udid / unit id | yes | **ignored**: profiles never reference them |
| Global profile id `420fd454-…` | no: Logitech constant | **preserved** |
| Built-in app id `application_id_google_chrome` | no: catalog constant | **preserved** |
| Custom app id | yes: random uuid4 when created in the UI | **regenerated** as `uuid5(lower(exe name))`, or **mapped** to an existing entry with the same executable name |
| Executable path | yes: user profile, versioned folders like `WebStorm 2023.3.3` | **mapped**: found on the target from the file name (`searchPaths`, PATH, Program Files, `%LOCALAPPDATA%\Programs`, JetBrains Toolbox) |
| App icon (`posterPath`/`posterUrl`) | yes | **regenerated** from the target's `icon_cache` when the agent has seen the app |
| Card bodies (tags, icons, taskId) | vary by Options+ version | **regenerated** from the target's installed catalog |
| Card ids | no: catalog constants | **preserved** as `preset`/`card` |
| Keystrokes | no: USB HID usages | **preserved** |
| Plugin / Smart Action cards (`macro.type: ACTION`) | the plugin must be installed | kept as `card`/`raw`; **unverified** across machines |
| Run times, pids, command lines, install times | yes | **ignored** (the agent fills them) |
| Host names, Easy-Switch, Flow, USB paths, firmware, battery | yes | **never exported, never written** |

**Machine A → B needs exactly two transformations:** resolve each custom app's
executable on B, and derive its icon fields from B's cache. The tool does both.
There is no per-device or per-host rewriting. Not yet exercised on a second
physical machine: run `check=true` first there.

## Sync model

```
C:\MikeM\m-control-personal\logi-options\*.logi.json   ← source of truth (a pack; any sync or VCS you like)
            │  mctl run logi-options               one agent restart for all packs; no-op when in sync
            ▼
each machine's own settings.db
            │  mctl run logi-options check=true    drift report (read-only)
```

- **One-way, spec → device** (ADR-0010). A UI tweak is reported as drift and
  overwritten by the next apply. Adopt it with `mode=export` and commit the diff.
  Export is always a deliberate step.
- **Specs may sync** through OneDrive, Syncthing, or Git. They're small text
  files with nothing machine-specific in them.
- **Never sync `settings.db`.** It is one document the agent rewrites in full
  on every save. Two agents behind a sync client would overwrite each other's
  documents and spread machine-specific state: host names, serials, USB paths,
  command lines.
- **Removal is explicit:** `mode=remove app=…`. A missing spec file does not delete a profile.
