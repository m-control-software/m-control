# Architecture Overview

How m-control is put together today. For the rules, see
[`constraints.md`](constraints.md); for the wire protocol, see
[`execution-model.md`](execution-model.md); for the reasons, see the
[ADRs](../adr/).

## Shape

```
user
 │  mctl <init | list | run | doctor>
 ▼
apps/mctl  (@m-control/mctl)  ── the CLI: argument parsing, terminal output,
 │                                exit codes; bundled to dist/bundle/index.js
 │  imports
 ▼
packages/core  (@m-control/core) ── library: types, config, discovery,
 │                                   runner, event sinks
 │  spawns (one process per run)
 ▼
tools/<category>/<id>/  ── standalone processes in node | python |
                           powershell | dotnet, speaking Tool Protocol v1
```

- **Core coordinates, tools execute.** Core never embeds tool logic, and a tool
  never imports core; the protocol is the only coupling. A crash stays in the
  tool's process.
- **Adding a tool never touches core or mctl.** Discovery finds manifests; the
  config schema is open under `tools.*`.
- **One runner for every runtime** (ADR-0006). The runtime only picks the
  spawn command.

## Components

| Module | Responsibility |
|--------|----------------|
| `core/src/types.ts` | Every contract: `ToolManifest`, `ToolEvent`, `ToolRequest`/`RunContext`, `Runner`, `MControlConfig`, exit codes |
| `core/src/discovery.ts` | Recursively scans tools roots for `manifest.json`, validates each, returns `{ tools, errors }` |
| `core/src/config.ts` | Loads global + project config, extracts a tool's declared keys, resolves tools roots and run budgets, writes the initial config |
| `core/src/runner/` | `ProcessRunner`: spawn, write the request, parse NDJSON, enforce guardrails; `getRunner()`, `resolveSpawnCommand()` |
| `core/src/events.ts` | `EventSink` plus `ConsoleEventSink` (human) and `JsonEventSink` (`--json` passthrough) |
| `core/src/errors.ts` | `MControlError` hierarchy |
| `mctl/src/commands/` | `init`, `list`, `run`, `doctor` |
| `mctl/src/paths.ts` | Repo-checkout detection and tools-root resolution for the CLI |

## Run flow

```
mctl run <id> k=v … [--json]
  1. load config            ~/.m-control/config.json (+ <cwd>/.m-control/config.json)
                            missing → "run mctl init"
  2. resolve tools roots    M_CONTROL_TOOLS_ROOT | paths.toolsRoots | repo tools/
  3. discover + find <id>   invalid manifests → warnings, not failures
  4. build RunContext       declared config keys only, workspaceRoot = cwd
  5. resolve budget         timeouts.tools[id] | manifest.timeoutMs | timeouts.default | 30 s
  6. run                    spawn → stdin ToolRequest → stdout NDJSON → EventSink
  7. exit                   0 ok | 1 expected failure | ≥2 crash / guardrail
```

`mctl doctor` runs steps 1–3 without executing anything, then checks that each
runtime in use is on PATH and that every `requiredConfig` key is set.

## Tool kinds in practice

ADR-0010 (Proposed) adds an optional manifest `kind`: `task` (run and report —
everything today), `app` (long-running, launched detached), and `artifact`
(files linked into place by a future `mctl apply`, never executed). It also
names a pattern that is *not* a kind: the **generated artifact**, a task that
turns declarative specs into a device or app config. Today:

| Tool | Runtime | Shape |
|------|---------|-------|
| `hello-world`, `hello-python` | node, python | protocol reference |
| `agent-status` | node | task — reads local agent logs and APIs, reports |
| `stream-deck` | powershell | generated artifact — specs → Stream Deck profile, installed live |
| `logi-options` | python | generated artifact — specs → Options+ settings, applied to a running agent (ADR-0011) |

Generated-artifact tools share a pattern: declarative specs in personal pack
directories outside the repo, a `check=true` dry run, backup before write, and
verification after.

## Local and cloud

Everything runs locally today. Config, including credentials, is a plaintext
file in `~/.m-control/`. Cloud sync, licensing, and teams (`docs/VISION.md`)
are future work; the protocol's process boundary and JSON contracts are what
keep that door open.

## Distribution

`yarn build` produces a single self-contained file,
`apps/mctl/dist/bundle/index.js` (ncc). `scripts/install.ps1` /
`scripts/install.sh` copy it to `~/.m-control/mctl.js`, create `mctl` and `mm`
launchers, and register the checkout's `tools/` as a tools root (ADR-0004,
ADR-0007).

**Last updated:** 2026-09-24
