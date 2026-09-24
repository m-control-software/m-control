# m-control — Agent Guide

Canonical working rules for every AI coding agent (Claude Code, Codex, Cursor,
Copilot, …) and the shortest accurate description of the repo for humans.
`CLAUDE.md`, `.cursor/rules/m-control.mdc` and `.github/copilot-instructions.md`
point here. When a rule changes, change it **here**, not in the pointers.

## What this is

A personal CLI orchestrator (`mctl`) that discovers and runs standalone tool
processes, growing into a personal + work control center (ADR-0009, Proposed)
and, longer term, a product for developer teams (`docs/VISION.md`).

| Path | What it is |
|------|------------|
| `packages/core` | `@m-control/core` — runtime library: types, discovery, config, runner, event sinks. No CLI, no `process.argv`, no console output. Public API = `src/index.ts`. |
| `apps/mctl` | `@m-control/mctl` — the CLI (`init`, `list`, `run`, `doctor`). Bundled by ncc into `apps/mctl/dist/bundle/index.js`. |
| `tools/<category>/<id>/` | Standalone tool processes in any runtime. **Not** npm packages, not in workspaces. |
| `templates/node-tool`, `templates/python-tool` | Copy-paste starting points for new tools. |
| `docs/` | ADRs, architecture, AI prompts. Index: `docs/README.md`. |

Tools today: `hello-world` (node) and `hello-python` (python) as protocol
references; `agent-status` (node) — dashboard of AI coding-agent sessions;
`stream-deck` (powershell) — Stream Deck profiles from `*.deck.json` specs;
`logi-options` (python) — MX Master 4 profiles from `*.logi.json` specs.

## Commands

Always from the repo root (never `yarn install` inside a package):

```bash
yarn install
yarn build        # core first, then mctl (mctl compiles against core/dist)
yarn typecheck    # needs core built first
yarn lint
yarn test         # Vitest: packages/*/test, apps/*/test, tools/**/test
node apps/mctl/dist/bundle/index.js <init|list|run|doctor>
```

CI (`.github/workflows/ci.yml`) runs, in order: install `--frozen-lockfile`,
build core, typecheck, lint, test, build, then a smoke test (`--help`, `init`,
`list`, `doctor`, `run hello-world`, `run hello-python`). Run the same steps
before pushing. Only `src/` of each workspace is linted; tools are not.

## Contracts (source of truth: `packages/core/src/types.ts`)

**Manifest** — `tools/<category>/<id>/manifest.json`, validated at discovery
(`validateManifest` in `packages/core/src/discovery.ts`):

- Required: `manifestVersion: 1`, `id` (kebab-case, unique), `version`, `name`,
  `description`, `runtime` (`node` | `python` | `powershell` | `dotnet`), `entry`
  (path relative to the manifest).
- Optional: `requiredConfig`, `optionalConfig` (arrays of dot-paths),
  `timeoutMs` (positive number), `tags`.
- An invalid manifest is skipped with a warning; it never breaks discovery.

**Tool Protocol v1** — full spec in `docs/architecture/execution-model.md`:

- stdin: one JSON `ToolRequest` `{ context: { toolId, config, workspaceRoot }, input }`.
  Read to EOF before doing anything.
- stdout: NDJSON `ToolEvent` lines **only** (`started` → `log`* → `result` | `error`),
  each with `type`, `ts` (ISO-8601), `toolId`, `payload`. Anything human-readable
  goes in `log` events or stderr.
- Exit: `0` success, `1` expected failure (after an `error` event), `≥2` crash.
  `error.payload.recoverable`: `true` = the user can fix it, `false` = a bug.
- `mctl run <id> k=v …` puts bare `key=value` pairs into `input` as **strings**.
  `--flags` are consumed by mctl and never reach the tool — tools take options
  from `input` (e.g. `check=true`), never from argv.
- `workspaceRoot` is the directory mctl was invoked from.

**Config** — `~/.m-control/config.json`, optionally merged with
`<cwd>/.m-control/config.json` (project wins per key). `configVersion: 1`.

- `tools` is an **open schema**: a tool adds its own section (`tools.<id>.*`).
  Never add tool-specific types or keys to core.
- A tool receives only the keys its manifest declares in `requiredConfig` +
  `optionalConfig`, as a flat map keyed by the dot-path (`"azdo.token"`),
  resolved against the `tools` section. An undeclared key is always undefined.
- Nothing enforces `requiredConfig` at run time; `mctl doctor` reports missing
  required keys. Tools must still fail with a recoverable `error` event when a
  key they need is empty.
- `runtimes` overrides interpreter commands per machine (e.g. `{ "python": "py" }`).
- `timeouts` sets run budgets. Precedence, highest first: `timeouts.tools[<id>]`,
  `manifest.timeoutMs`, `timeouts.default`, built-in 30 000 ms. Other guardrails:
  10 MB of stdout, 10 000 events.

**Discovery** — the first non-empty source of tools roots wins (they are not
merged): `M_CONTROL_TOOLS_ROOT` (several paths joined by the OS path
delimiter), then `paths.toolsRoots` in config, then the repo's `tools/` (only
when mctl runs from a checkout). Discovery is automatic; there is no
registration step.

**Runtimes** — one `ProcessRunner` for all of them; the runtime only changes the
spawn command (`resolveSpawnCommand`): node → the running Node binary; python →
`python` (Windows) / `python3`; powershell → `powershell` (Windows PowerShell
5.1) / `pwsh`; dotnet → `dotnet <x.dll>` or the executable itself.

## Adding a tool

1. `cp -r templates/node-tool tools/<category>/<id>` (or `python-tool`). Edit
   `manifest.json`: every required field above, plus the config keys and budget
   the tool needs.
2. Implement the entry following Tool Protocol v1. Emit `started` first; wrap
   everything so an unexpected exception still ends in an `error` event.
3. Runtime conventions:
   - node: plain `.js`, no build step, no TypeScript, no dependencies unless
     unavoidable.
   - python: `main.py`, standard library only, Python 3.10+.
   - powershell: must parse and run under **Windows PowerShell 5.1** (no
     ternaries, no `??`, no PS7-only cmdlets); that is what `powershell` spawns
     on Windows.
4. Give the tool a `README.md` (the template has one): usage, config keys,
   external dependencies.
5. Tests go in `tools/<category>/<id>/test/*.test.ts` and spawn the tool as a
   process. Tests that need Windows or an installed app skip themselves
   elsewhere (CI is Ubuntu) — keep a platform-independent test for anything
   that can be checked without them.
6. Personal or client data (packs, names, paths) never goes into this repo. It
   lives in directories the user points the tool at via config (e.g.
   `tools.logi-options.packDirs`).
7. Add an `[Unreleased]` entry to `CHANGELOG.md`.

## Code rules

- Throw the error hierarchy from `@m-control/core` (`ConfigError`,
  `ManifestError`, `DiscoveryError`, `RunnerError`, `RunnerGuardrailError`,
  `NotImplementedError`), never a raw `Error`. Messages say what to do next.
- Never swallow an error: rethrow with context, or surface it as a warning.
- `packages/core`: no console output and no `process.exit`; report through
  return values, errors, and the `EventSink` interface.
- `apps/mctl`: tool events are rendered only through an `EventSink`
  (`createEventSink`). Command output of mctl itself (`list`, `doctor`, `init`,
  usage errors) is plain console output — that is the CLI's UI.
- Import core only as `@m-control/core`, never `packages/core/src/…`. A new
  public export goes through `packages/core/src/index.ts`.
- No hardcoded paths: `path.join`/`path.resolve`, config, or env. Must work on
  Windows (primary) and Linux.
- A breaking change to `ToolManifest` or `MControlConfig` needs a new
  `manifestVersion`/`configVersion` and a migration path. Additive optional
  fields don't.
- TypeScript strict; `any` only with a comment saying why. Prettier formats;
  ESLint must pass.

## Decisions and docs

- Architectural decisions get an ADR in `docs/adr/` (copy `TEMPLATE.md`, next
  free number). ADR-0009 and ADR-0010 are **Proposed**: read their Open
  Questions before structural work (repo layout, manifest `kind`/`visibility`).
- Where to update what, when you change it:
  - a contract (manifest, protocol, config, CLI surface) → this file,
    `docs/architecture/execution-model.md`, and `CHANGELOG.md`;
  - a hard rule → `docs/architecture/constraints.md` and the "Code rules" above;
  - first-run steps → `QUICKSTART.md`.
- Other docs link to these instead of restating them. Restated rules go stale
  (see `LESSONS-LEARNED.md`).
- Branches: work happens on short-lived branches merged into `main`, which CI
  gates. ADR-0005 describes a `main` + `develop` model that is not currently
  followed (`develop` is behind `main`); see `CONTRIBUTING.md`.
