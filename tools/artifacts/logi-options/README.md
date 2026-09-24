# logi-options

> Logitech Options+ mouse profiles from declarative `*.logi.json` packs:
> apply, check for drift, export, restore. MX Master 4 on Windows.

Options+ keeps every button binding in one JSON document inside a SQLite file
owned by a running agent. This tool compiles small, portable specs ("back =
Alt+Left in Rider") into exactly what the Options+ UI would have written. It
patches only those bindings, restarts the agent, and verifies the agent kept
them. It is the ADR-0010 "spec + generator" pattern with an applier on top
(ADR-0011).

## Usage

```bash
mctl run logi-options check=true            # validate packs, report drift, show the planned change - writes nothing
mctl run logi-options                       # apply all packs (one agent restart, ~15 s; no-op when in sync)
mctl run logi-options mode=presets          # authoring vocabulary: buttons, presets, gesture presets, keys, built-in apps
mctl run logi-options mode=list             # profiles on this machine and which pack defines each
mctl run logi-options mode=export app=all out=C:/MikeM/m-control-personal/logi-options/personal.logi.json pack=personal
mctl run logi-options mode=export app=rider64.exe      # print one profile as a spec (no file written)
mctl run logi-options mode=remove app=rider64.exe
mctl run logi-options mode=backup | mode=backups | mode=restore backup=latest
mctl run logi-options mode=inspect          # store, processes, catalog build, profiles in portable form
```

Flags are `key=value` ToolInput pairs. mctl drops `--flags`, so `--check`
would do nothing. Unknown keys are rejected, so `chek=true` fails instead
of applying. `export` refuses to overwrite a file unless `force=true` is given.

**While applying, the mouse falls back to default buttons for a few seconds**
(the agent is restarted). The UI reconnects by itself.

## Spec

```json
{
  "specVersion": 1, "pack": "personal", "device": "mx-master-4",
  "profiles": [
    { "application": { "executable": "rider64.exe", "name": "Rider" },
      "buttons": { "back": { "shortcut": "ALT+LEFT" }, "haptic-panel": { "shortcut": "CTRL+SHIFT+A" },
                   "thumb": { "gestures": { "left": { "shortcut": "CTRL+PAGEUP" }, "right": { "shortcut": "CTRL+PAGEDOWN" } } } } }
  ]
}
```

Full reference: [docs/spec-format.md](docs/spec-format.md). Worked example:
[examples/rider.logi.json](examples/rider.logi.json).

## Config

In `~/.m-control/config.json`, under `tools.logi-options`. All keys are listed in
`requiredConfig` because that is the only way mctl delivers config to a tool;
only `packDirs` is needed in practice.

| Key | Default | Description |
|---|---|---|
| `packDirs` | *(none)* | Directories holding packs. Each may be one pack or a root of several (one subfolder level is scanned). Personal/client packs live here, **never in this repo** |
| `dataDir` | `%LOCALAPPDATA%\LogiOptionsPlus` | Store location. Pointing it anywhere else (tests, a copy) means **the agent is never touched** |
| `backupDir` | `~/.m-control/backups/logi-options` | Where every pre-write backup goes |

```json
"tools": { "logi-options": { "packDirs": ["C:/MikeM/m-control-personal"] } }
```

## Safety

- Every write takes a consistent backup first, and nothing is written while the agent runs.
- Patches are surgical: unlisted buttons, other profiles, and device settings stay byte-identical.
- After the agent restarts, what it kept is decompiled and compared with the specs.
  A mismatch is rolled back automatically.
- Refuses, rather than guesses, if Options+ changed its storage or JSON writer. See [docs/maintenance.md](docs/maintenance.md).
- Stays inside mctl's 30 s kill timeout (the kill runs no cleanup on Windows).
  The agent is only stopped when enough time remains to restart it.

## Runtime and dependencies

- Windows only (v1). Python 3.10+, standard library only (`sqlite3`, `ctypes`).
  `mctl doctor` checks the interpreter. Override it via `runtimes.python`.
- Logi Options+ installed. The tool reads Logitech's own catalogs from
  `%PROGRAMDATA%\LogiOptionsPlus\depots`; nothing from them is copied into this repo.

## Layout

```
main.py            protocol + mode dispatch
lib/               store (SQLite, agent control) · catalog (Logitech catalogs, keys) · model (compile/decompile/verify)
                   packs (discovery, merge) · transaction (budgeted apply) · backup · docdiff · modes · protocol
docs/              spec-format (authoring) · internals (how Options+ stores it, evidence) · portability · maintenance
examples/          reference specs - never auto-applied
research/          developer scripts for re-deriving the model (run directly, not via mctl)
test/              test_model.py (compiler vs UI-written evidence) · protocol.test.ts (vitest) · fixtures/
```

## Tests

```bash
yarn test                                                         # includes tools/**/test
python -m unittest discover -s tools/artifacts/logi-options/test -p "test_*.py" -v
```

Tests use fixture stores only. Catalog-dependent tests skip when Options+ is not installed.
