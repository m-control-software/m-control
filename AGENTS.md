# m-control — Agent Guide

Canonical working rules for every AI coding agent (Claude Code, Codex, Cursor,
Copilot, …) and the shortest accurate description of the repo for humans.
`CLAUDE.md`, `.cursor/rules/m-control.mdc` and `.github/copilot-instructions.md`
point here. When a rule changes, change it **here**, not in the pointers.

How the repo stays deterministic, in order of preference: a **script** does
the mechanical work (`yarn new:tool`, `new:adr`, `release`), a **check** in
`yarn verify` catches what a script can't prevent, and only what neither can
cover is a rule written here. When you are about to add a rule, first ask
whether it can be a check.

## What this is

A personal CLI orchestrator (`mctl`) that discovers and runs standalone tool
processes, growing into a personal + work control center (ADR-0009, Proposed)
and, longer term, a product for developer teams (`docs/VISION.md`).

| Path | What it is |
|------|------------|
| `packages/core` | `@m-control/core` — runtime library: types, discovery, config, runner, event sinks. No CLI concerns. Public API = `src/index.ts`. |
| `apps/mctl` | `@m-control/mctl` — the CLI (`init`, `list`, `run`, `doctor`). Bundled by ncc into `apps/mctl/dist/bundle/index.js`. |
| `tools/<category>/<id>/` | Standalone tool processes in any runtime. **Not** npm packages, not in workspaces. |
| `templates/node-tool`, `templates/python-tool` | What `yarn new:tool` copies. Changing one changes every future tool. |
| `test-support/` | Shared Vitest helpers for tool tests (`runTool`, `expectProtocol`), imported as `@m-control/test-support` — a Vitest/tsconfig alias, not a package. |
| `test/` | Repo-wide tests: every tool's conformance, the scaffolder, docs. |
| `scripts/` | `verify.mjs` (= CI), `smoke.mjs`, `new-tool.mjs`, `new-adr.mjs`, `release.mjs`, `setup-linters.mjs`, `lint-powershell.ps1`, installers. |
| `docs/` | ADRs, architecture, project context. Index: `docs/README.md`. |
| `.claude/` | Skills (procedures, see below) and hook scripts, shared with Cursor via `.cursor/hooks.json`. |

Tools today: `hello-world` (node) and `hello-python` (python) as protocol
references; `agent-status` (node) — dashboard of AI coding-agent sessions;
`stream-deck` (powershell) — Stream Deck profiles from `*.deck.json` specs;
`logi-options` (python) — MX Master 4 profiles from `*.logi.json` specs.

## Commands

Always from the repo root (never `yarn install` inside a package):

```bash
yarn install
yarn verify                 # everything CI checks, in CI order — the definition of green
yarn verify --from=test     # resume after fixing a failed step (--only=<step> runs one)
yarn build                  # core first, then mctl (mctl compiles against core/dist)
yarn typecheck              # workspaces + all tests; needs core built first
yarn lint                   # ESLint + Prettier on all TS/JS
yarn format                 # fix formatting
yarn test                   # Vitest: packages/*/test, tools/**/test, test/
yarn smoke                  # the built bundle end to end, in a throwaway HOME
yarn new:tool --id=… --category=… --runtime=node|python --description="…"
yarn new:adr --title="…"
yarn release --version=X.Y.Z   # on main only; see the release skill
yarn setup:linters          # ruff + PSScriptAnalyzer at the versions in linters.json
node apps/mctl/dist/bundle/index.js <init|list|run|doctor>
```

CI runs `scripts/verify.mjs` and nothing else, so `yarn verify` passing locally
is the bar before pushing. Its steps: install `--frozen-lockfile`, build core,
typecheck (workspaces, plus every test file via the root `tsconfig.json`),
lint (ESLint + Prettier on all TS/JS including tools and scripts), lint-python
(ruff, `ruff.toml`), lint-powershell (PSScriptAnalyzer checks every `.ps1`
against Windows PowerShell 5.1), test, build, then `scripts/smoke.mjs`. The
Python and PowerShell linters are pinned in `linters.json` and installed by
`yarn setup:linters`; locally a missing one is skipped with a warning, in CI
it fails. The smoke test runs the bundle in a throwaway HOME (it never touches
your real config): `--help`,
`init`, `list`, `doctor` must fail on the fresh config, then pass once every
tool's `<tool>/test/smoke-config.json` is merged in, then `run hello-world` and
`run hello-python`. A tool with `requiredConfig` must ship
`<tool>/test/smoke-config.json` supplying those keys (`${toolDir}` expands to the
tool's directory). Add a new check to `verify.mjs`, never only to the workflow.

## Contracts (source of truth: `packages/core/src/types.ts`)

**Manifest** — `tools/<category>/<id>/manifest.json`, validated at discovery
(`validateManifest` in `packages/core/src/discovery.ts`):

- Required: `manifestVersion: 1`, `id` (kebab-case, unique), `version`, `name`,
  `description`, `runtime` (`node` | `python` | `powershell` | `dotnet`), `entry`
  (path relative to the manifest).
- Optional: `requiredConfig`, `optionalConfig` (arrays of dot-paths),
  `timeoutMs` (positive number), `tags`.
  `tags` is an array of strings.
- An invalid manifest is skipped with a warning; it never breaks discovery.
  `packages/core/test/repo-manifests.test.ts` fails CI for any invalid
  manifest in `tools/` or `templates/`.
- `packages/core/schemas/manifest.v1.schema.json` is the JSON Schema of the
  same rules (VS Code validates manifests with it); `test/manifest-schema.test.ts`
  fails when it and `validateManifest` disagree.

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

The `add-tool` skill runs this procedure with its design gate; other agents
read `.claude/skills/add-tool/SKILL.md`.

1. Scaffold — never copy by hand:
   `yarn new:tool --id=<kebab-id> --category=<kebab> --runtime=<node|python> --description="…"`.
   It fills the id everywhere, adds a protocol test and a CHANGELOG entry.
   `--dry-run` shows the plan. PowerShell has no template: copy the closest
   existing tool.
2. Edit `manifest.json`: config keys, `timeoutMs`, tags. The node and python
   templates read their id and `requiredConfig` from the manifest and fail with
   a recoverable `CONFIG_MISSING` error by themselves, so declaring a key is
   enough for the tool to enforce it.
3. Implement the entry following Tool Protocol v1. Emit `started` first; wrap
   everything so an unexpected exception still ends in an `error` event. Throw
   `ToolFailure(message, code, recoverable)` for expected failures.
4. Runtime conventions:
   - node: plain `.js`, no build step, no TypeScript, no dependencies unless
     unavoidable.
   - python: `main.py`, standard library only, Python 3.10+.
   - powershell: must parse and run under **Windows PowerShell 5.1** (no
     ternaries, no `??`, no PS7-only cmdlets); that is what `powershell` spawns
     on Windows.
5. Tests go in `tools/<category>/<id>/test/*.test.ts`, spawn the tool through
   `runTool` from `@m-control/test-support`, and assert with `expectProtocol`.
   Tests that need Windows or an installed app skip themselves elsewhere (CI is
   Ubuntu) — keep a platform-independent test for anything that can be checked
   without them. A tool with `requiredConfig` also ships
   `<tool>/test/smoke-config.json` (see "Commands").
6. Write the `README.md` (the scaffold has one): usage, config keys, external
   dependencies. The README is where config keys are documented — `mctl init`
   writes no tool sections. Add the tool to "Tools today" above.
7. Personal or client data (packs, names, paths) never goes into this repo. It
   lives in directories the user points the tool at via config (e.g.
   `tools.logi-options.packDirs`).
8. `yarn verify`.

## Procedures (skills)

Multi-step procedures live as skills in `.claude/skills/<name>/SKILL.md`
(the open Agent Skills format). Claude Code, GitHub Copilot (cloud agent, code
review, CLI, VS Code, JetBrains) and Cursor all load skills from that directory
by themselves; any other agent should read the matching `SKILL.md` and follow
it. Skills hold the judgment and the approval gates;
mechanical steps are scripts they call. `test/docs.test.ts` fails when a skill
is missing from this list.

| Skill | Use it to | Script it drives |
|-------|-----------|------------------|
| `add-tool` | Design, scaffold, implement, test and document a new tool. | `yarn new:tool` |
| `change-contract` | Change the manifest, protocol, config, discovery or CLI surface. | — |
| `write-adr` | Record a decision, or change an ADR's status. | `yarn new:adr` |
| `release` | Cut and tag a version (the known-good state, ADR-0012). | `yarn release` |
| `author-deck-profile` | Write or change Stream Deck specs (`*.deck.json`) and apply them. | `mctl run stream-deck` |
| `author-logi-profile` | Write or change MX Master 4 profiles (`*.logi.json`) and apply them. | `mctl run logi-options` |

## Code rules

- Throw the error hierarchy from `@m-control/core` (`ConfigError`,
  `ManifestError`, `DiscoveryError`, `RunnerError`, `RunnerGuardrailError`,
  `NotImplementedError`), never a raw `Error`. Messages say what to do next.
- Never swallow an error: rethrow with context, or surface it as a warning.
- `packages/core`: no `console.*`, no `process.exit`, no `process.argv`.
  Terminal writes stay in the `EventSink` implementations and the runner's
  stderr forwarding (see `docs/architecture/constraints.md` §1).
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

- Architectural decisions get an ADR in `docs/adr/`: `yarn new:adr` (the
  `write-adr` skill). ADR-0009 and ADR-0010 are **Proposed**: read their Open
  Questions before structural work (repo layout, manifest `kind`/`visibility`).
- Where to update what, when you change it:
  - a contract (manifest, protocol, config, CLI surface) → this file,
    `docs/architecture/execution-model.md`, and `CHANGELOG.md`;
  - a hard rule → `docs/architecture/constraints.md` and the "Code rules" above,
    and a check in `test/` or a lint rule if it can be checked;
  - something a reviewer must judge that no check can → `REVIEW.md`;
  - first-run steps → `QUICKSTART.md`.
- Other docs link to these instead of restating them. Restated rules go stale
  (see `LESSONS-LEARNED.md`).
- Branches (ADR-0012): `main` is the only long-lived branch. Work on a
  short-lived branch, run `yarn verify`, then merge or fast-forward
  into `main`. Never target `develop` (retired). Known-good states are release
  tags `vX.Y.Z`, not a branch.
