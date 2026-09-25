# m-control — Developer Introduction

> Onboarding doc for new contributors. Read this before touching any code.

---

## What is this?

**m-control** is a CLI orchestrator for developer automation. You run `mctl run <tool-id>` and the orchestrator discovers, spawns, and streams output from a tool process.

Current state: personal toolset for Michał's workflow, with real tools for AI
agent status, Stream Deck profiles, and MX Master 4 profiles.

The condensed, always-current rules are in `AGENTS.md`; this document explains
the codebase in more depth.
Direction: evolving toward a SaaS product for dev teams.

The key architectural bet: tools are **separate processes** (any language), orchestrated by a **TypeScript CLI**. The two communicate over a well-defined protocol — stdin/stdout with NDJSON events.

---

## Prerequisites

- Node.js 20+ (22 recommended, see `.nvmrc`)
- Yarn 1.22+
- Git
- Python 3.10+ (for Python tools)

---

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd m-control
yarn install

# Build all packages
yarn build

# Run (the build output is a single bundled file)
node apps/mctl/dist/bundle/index.js init      # creates ~/.m-control/config.json
node apps/mctl/dist/bundle/index.js list
node apps/mctl/dist/bundle/index.js run hello-world
node apps/mctl/dist/bundle/index.js doctor
```

`mctl run` requires the config and exits with a hint to run `mctl init` if it
is missing. `mctl list` works without it (it falls back to the repo `tools/`).

### Install as a global command

```powershell
.\scripts\install.ps1      # Windows — restart the terminal afterwards
```

```bash
./scripts/install.sh       # Linux/macOS
```

Then `mctl list`, `mctl run hello-world`.

---

## Monorepo Layout

```
m-control/
├── apps/
│   └── mctl/                  # CLI binary (@m-control/mctl)
│       └── src/
│           ├── index.ts       # Router — parses argv, delegates to commands
│           ├── paths.ts       # Repo-checkout detection, tools-root resolution
│           └── commands/
│               ├── init.ts    # mctl init
│               ├── list.ts    # mctl list
│               ├── run.ts     # mctl run <id>
│               └── doctor.ts  # mctl doctor
│
├── packages/
│   └── core/                  # Runtime engine (@m-control/core)
│       ├── src/
│       │   ├── types.ts       # All contracts (manifest, protocol, runner interface)
│       │   ├── errors.ts      # Error hierarchy
│       │   ├── discovery.ts   # Scans tools roots for manifest.json, validates
│       │   ├── config.ts      # Config loader, key extraction, tools roots, timeouts
│       │   ├── events.ts      # EventSink interface + ConsoleEventSink + JsonEventSink
│       │   └── runner/
│       │       ├── index.ts   # getRunner() factory
│       │       └── process-runner.ts  # ProcessRunner (all runtimes)
│       └── test/              # Vitest suites (run from TS sources)
│
├── tools/
│   ├── misc/
│   │   ├── hello-world/       # Node reference implementation of Protocol v1
│   │   └── hello-python/      # Python reference implementation
│   ├── agents/agent-status/   # AI coding-agent session dashboard (node)
│   └── artifacts/
│       ├── stream-deck/       # Stream Deck profiles from specs (powershell)
│       └── logi-options/      # MX Master 4 profiles from specs (python)
│
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── architecture/          # System design docs
│   └── ai/                    # AI assistant context (PROJECT-CONTEXT.md etc.)
│
├── templates/
│   ├── node-tool/             # What `yarn new:tool` copies for Node.js tools
│   └── python-tool/           # …and for Python tools
│
├── test/                      # Repo-wide tests: tool conformance, docs, scripts
├── test-support/              # Shared helpers for tool tests (runTool, expectProtocol)
├── scripts/                   # verify (= CI), smoke, new-tool, new-adr, release, installers
├── .claude/                   # Claude Code skills and hooks
│
├── tsconfig.base.json         # Shared TS config (extended by each package)
├── tsconfig.json              # Type-checks tests and test-support
└── package.json               # Yarn workspaces root
```

**Key rule:** `packages/core` is a library — no `bin`, no `process.argv`, no
`process.exit`, no `console.*`. Its only terminal writes are the `EventSink`
implementations and the runner's stderr forwarding. Everything else
user-facing lives in `apps/mctl`.

---

## Core Concepts

### 1. Tool Manifest

Every tool has a `manifest.json` next to its entry point:

```json
{
  "manifestVersion": 1,
  "id": "hello-world",
  "version": "0.1.0",
  "name": "Hello World",
  "description": "One-line description for mctl list",
  "runtime": "node",
  "entry": "index.js",
  "requiredConfig": [],
  "tags": ["misc"]
}
```

| Field | Description |
|-------|-------------|
| `manifestVersion` | Always `1`. Fail-fast on mismatch. |
| `id` | kebab-case. Used in `mctl run <id>`. Must be unique across all tools. |
| `version`, `name`, `description` | Required strings; `description` is what `mctl list` shows. |
| `runtime` | `node` \| `python` \| `powershell` \| `dotnet` — all run through `ProcessRunner`. |
| `entry` | Path relative to manifest dir. For node: a `.js` file (no TS, no build step). |
| `requiredConfig` | Dot-notation keys the tool can't work without. `mctl doctor` reports unset ones. |
| `optionalConfig` | Keys the tool reads when present. Only declared keys (required + optional) are delivered. |
| `timeoutMs` | Run budget when the 30 s default doesn't fit. |
| `tags` | Free-form labels. |

Discovery scans every tools root for `manifest.json` recursively. Any file that fails validation is skipped with a stderr warning — it never breaks the orchestrator.

---

### 2. Tool Protocol v1

The contract between orchestrator and tool process:

```
orchestrator                tool process
     │                           │
     │── JSON (stdin) ──────────>│  ToolRequest: { context, input }
     │                           │
     │<─ NDJSON (stdout) ────────│  stream of ToolEvent lines
     │<─ raw text (stderr) ──────│  diagnostic logs, stack traces
     │                           │
     │<─ exit code 0/1/≥2 ───────│  0=ok, 1=expected failure, ≥2=crash
```

**stdout is exclusively NDJSON.** Never `console.log` raw text to stdout in a tool — it breaks the parser.

#### ToolRequest (stdin)

```json
{
  "context": {
    "toolId": "hello-world",
    "config": { "azdo.token": "pat-xxx" },
    "workspaceRoot": "/path/to/project"
  },
  "input": { "name": "You" }
}
```

Tools must read stdin to EOF before executing. `input` comes from
`mctl run <id> key=value …` (values are strings); `--flags` never reach the tool.

#### ToolEvent (stdout, one JSON object per line)

```typescript
type ToolEvent =
  | { type: 'started'; ts: string; toolId: string; payload: { meta?: object } }
  | { type: 'log';     ts: string; toolId: string; payload: { level: 'debug'|'info'|'warn'|'error'; message: string; data?: unknown } }
  | { type: 'result';  ts: string; toolId: string; payload: unknown }
  | { type: 'error';   ts: string; toolId: string; payload: { message: string; code?: string; recoverable: boolean } }
```

Every tool SHOULD emit: `started` → (optional `log` events) → `result` or `error`.

---

### 3. Config

Global config lives at `~/.m-control/config.json`. `mctl init` writes it
with no tool sections; each tool's section is added by hand, from the keys its
README lists (`mctl doctor` names the required ones that are missing):

```json
{
  "configVersion": 1,
  "tools": {
    "stream-deck":  { "profileName": "Work", "packDirs": ["C:\\packs\\work"] },
    "agent-status": { "githubToken": "ghp_…" }
  },
  "paths": { "toolsRoots": ["C:\\src\\m-control\\tools"] }
}
```

Optional project-local config at `.m-control/config.json` in cwd is merged over global (project values win per-key).

`configVersion` mismatch → hard fail with actionable message. No silent corruption.

The orchestrator extracts only the keys listed in `manifest.requiredConfig` and `manifest.optionalConfig`, resolved against the `tools` section, and passes them as a flat map to the tool via `context.config`. Tools never receive the full config.

Other top-level sections: `paths.toolsRoots` (where to discover tools),
`runtimes` (interpreter overrides such as `{ "python": "py" }`), and `timeouts`
(`default`, and `tools` keyed by tool id).

---

### 4. Runner

```typescript
interface Runner {
  run(tool: ResolvedTool, context: RunContext, input: ToolInput, options?: RunnerOptions): AsyncIterable<ToolEvent>;
}
```

`ProcessRunner` spawns the runtime command for the manifest (e.g. `node <entryPath>`, `python3 <entryPath>`), writes the request to stdin, parses NDJSON from stdout line by line, forwards stderr raw.

Guardrails (defaults; the timeout resolves per tool as
`timeouts.tools[id]` > `manifest.timeoutMs` > `timeouts.default` > 30 s):

| Guardrail | Default | Behaviour |
|-----------|---------|-----------|
| `timeoutMs` | 30s | SIGTERM + error event |
| `maxOutputBytes` | 10 MB | SIGTERM + error event |
| `maxEvents` | 10,000 | SIGTERM + error event |

Malformed NDJSON lines on stdout → warning to stderr, orchestrator keeps running.

---

### 5. EventSink

```typescript
interface EventSink {
  emit(event: ToolEvent): void;
  flush?(): void;
}
```

Two implementations:

- **`ConsoleEventSink`** — pretty-prints for humans. `warn`/`error` log events go to stderr; everything else to stdout.
- **`JsonEventSink`** — raw NDJSON passthrough to stdout. Used with `mctl run <id> --json`.

---

## Adding a New Tool

```bash
yarn new:tool --id=my-tool --category=misc --runtime=node --description="What it does"
```

That copies the template, fills in the id, and adds a protocol test and a
changelog entry. No registration step: discovery is automatic, so `mctl list`
shows it right away. The full procedure — design, config, tests, README — is
`AGENTS.md` → "Adding a tool"; `test/conformance.test.ts` checks the result.

Node tools are plain `.js` without dependencies; python, powershell and dotnet
tools use the same manifest and the same `ProcessRunner` — only the spawn
command differs. PowerShell must run under Windows PowerShell 5.1 (the linter
checks it).

---

## CLI Reference

```bash
mctl init                     # Create ~/.m-control/config.json
mctl list                     # List all discovered tools
mctl run <tool-id> [k=v ...]  # Run tool, pretty-print events
mctl run <tool-id> --json     # Run tool, passthrough raw NDJSON
mctl doctor                   # Diagnose config, tools roots, runtimes, required config
mctl --help
```

---

## Build & Dev Commands

`AGENTS.md` → "Commands". The one to remember is `yarn verify`: it runs
exactly what CI runs, and resumes with `--from=<step>` after a failure. Build
order matters: `core` is built before `mctl`, which imports from `core/dist`.

---

## Key Files to Know

| File | Why you'd open it |
|------|------------------|
| `AGENTS.md` | Condensed rules and contracts |
| `packages/core/src/types.ts` | Source of truth for all contracts |
| `docs/architecture/execution-model.md` | Tool Protocol v1 spec in prose |
| `docs/adr/0003-ndjson-protocol.md` | Why NDJSON over alternatives |
| `docs/adr/0002-monorepo-workspaces.md` | Why yarn workspaces, why not Nx |
| `docs/architecture/constraints.md` | Hard rules — read before making architectural decisions |
| `docs/ai/PROJECT-CONTEXT.md` | Where the project stands; open decisions |
| `tools/misc/hello-world/index.js` | Reference implementation of Tool Protocol v1 |
| `templates/node-tool/`, `templates/python-tool/` | What `yarn new:tool` copies |
| `test-support/tool-harness.ts` | How tool tests spawn and check a tool |
| `REVIEW.md` | What a reviewer checks beyond `yarn verify` |

---

## Error Hierarchy

```
MControlError
├── ConfigError          config missing, wrong version, unreadable
├── ManifestError        manifest invalid, wrong version, bad schema
├── DiscoveryError       tools root unreadable (not individual manifests)
├── RunnerError          process spawn failure, process error event
│   └── RunnerGuardrailError   timeout / maxOutputBytes / maxEvents hit
└── NotImplementedError  runtime not yet supported
```

---

## What's Not Here Yet

- Structured `--input` JSON for `mctl run` (bare `key=value` pairs work; values arrive as strings)
- TUI / interactive mode — removed in the monorepo refactor, may return later
- Auth abstraction, telemetry, OS keychain for secrets — intentionally deferred
- Per-tool overrides for `maxOutputBytes` / `maxEvents` (only the timeout is per tool)
- Manifest `kind` / `visibility` and `mctl apply` — ADR-0010, still Proposed

---

## Further Reading

```
docs/
├── VISION.md                  Where this is going (CLI → SaaS)
├── architecture/OVERVIEW.md   Component map and run flow
├── architecture/constraints.md  Hard rules
├── adr/                       Why things are the way they are
└── ai/CODING-GUIDELINES.md    Patterns to follow
LESSONS-LEARNED.md             Why things changed, mistakes included
```
