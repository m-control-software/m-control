# m-control — Developer Introduction

> Onboarding doc for new contributors. Read this before touching any code.

---

## What is this?

**m-control** is a CLI orchestrator for developer automation. You run `mctl run <tool-id>` and the orchestrator discovers, spawns, and streams output from a tool process.

Current state: personal toolset for Michał's workflow.
Direction: evolving toward a SaaS product for dev teams.

The key architectural bet: tools are **separate processes** (any language), orchestrated by a **TypeScript CLI**. The two communicate over a well-defined protocol — stdin/stdout with NDJSON events.

---

## Prerequisites

- Node.js 18+
- Yarn 1.22+
- Git

---

## Getting Started

```bash
# Clone and install
git clone <repo-url>
cd m-control
yarn install

# Build all packages
yarn build

# Run
node apps/mctl/dist/index.js list
node apps/mctl/dist/index.js run hello-world
```

First run of `mctl run` will initialise `~/.m-control/config.json` if it doesn't exist.

### Windows — install as global command

```powershell
.\scripts\install.ps1
# Restart terminal, then:
mctl list
mctl run hello-world
```

---

## Monorepo Layout

```
m-control/
├── apps/
│   └── mctl/                  # CLI binary (@m-control/mctl)
│       └── src/
│           ├── index.ts       # Router — parses argv, delegates to commands
│           └── commands/
│               ├── list.ts    # mctl list
│               └── run.ts     # mctl run <id>
│
├── packages/
│   └── core/                  # Runtime engine (@m-control/core)
│       └── src/
│           ├── types.ts       # All contracts (manifest, protocol, runner interface)
│           ├── errors.ts      # Error hierarchy
│           ├── discovery.ts   # Scans tools/**/manifest.json
│           ├── config.ts      # Config loader (global + project merge)
│           ├── events.ts      # EventSink interface + ConsoleEventSink + JsonEventSink
│           └── runner/
│               ├── index.ts   # getRunner() factory
│               └── process-runner.ts  # ProcessRunner (all runtimes)
│
├── tools/
│   └── misc/
│       └── hello-world/
│           ├── manifest.json  # Tool descriptor
│           └── index.js       # Tool implementation (plain JS, Protocol v1)
│
├── docs/
│   ├── adr/                   # Architecture Decision Records
│   ├── architecture/          # System design docs
│   └── ai/                    # AI assistant context (PROJECT-CONTEXT.md etc.)
│
├── templates/
│   ├── node-tool/             # Copy for new Node.js tools
│   └── python-tool/           # Copy for new Python tools
│
├── tsconfig.base.json         # Shared TS config (extended by each package)
└── package.json               # Yarn workspaces root
```

**Key rule:** `packages/core` is a library — it has no `bin`, no `process.argv`, no direct I/O.
Everything user-facing lives in `apps/mctl`.

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
| `runtime` | `node` \| `python` \| `dotnet` \| `powershell`. Only `node` is implemented. |
| `entry` | Path relative to manifest dir. For node: a `.js` file (no TS, no build step). |
| `requiredConfig` | Dot-notation keys extracted from config and passed to the tool. |

Discovery scans `tools/**/manifest.json` recursively. Any file that fails validation is skipped with a stderr warning — it never breaks the orchestrator.

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
  "input": { }
}
```

Tools must read stdin to EOF before executing.

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

Global config lives at `~/.m-control/config.json`:

```json
{
  "configVersion": 1,
  "tools": {
    "azdo": { "token": "", "organization": "" },
    "k8s":  { "defaultContext": "" }
  }
}
```

Optional project-local config at `.m-control/config.json` in cwd is merged over global (project values win per-key).

`configVersion` mismatch → hard fail with actionable message. No silent corruption.

The orchestrator extracts only the keys listed in `manifest.requiredConfig` and passes them as a flat map to the tool via `context.config`. Tools never receive the full config.

---

### 4. Runner

```typescript
interface Runner {
  run(tool: ResolvedTool, context: RunContext, input: ToolInput, options?: RunnerOptions): AsyncIterable<ToolEvent>;
}
```

`ProcessRunner` spawns the runtime command for the manifest (e.g. `node <entryPath>`, `python3 <entryPath>`), writes the request to stdin, parses NDJSON from stdout line by line, forwards stderr raw.

Guardrails (all configurable, these are defaults):

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

1. Create `tools/<category>/<tool-id>/`
2. Copy `templates/node-tool/` or `templates/python-tool/` as a starting point
3. Write `manifest.json` — set `id`, `runtime`, `entry`, `requiredConfig`
4. Implement your tool (reads stdin JSON, emits NDJSON events to stdout)
5. `mctl list` — verify it appears
6. `mctl run <tool-id>` — verify it runs

No registration step. Discovery is automatic.

**Node tools** — plain `.js`, no TypeScript compilation. Keep dependencies minimal or zero.
**Other runtimes** — `manifest.json` is the same; python, powershell, and dotnet are executed by the same `ProcessRunner`, only the spawn command differs. Interpreters can be overridden per machine via `runtimes` in the config.

---

## CLI Reference

```bash
mctl list                     # List all discovered tools
mctl run <tool-id>            # Run tool, pretty-print events
mctl run <tool-id> --json     # Run tool, passthrough raw NDJSON
mctl --help
```

---

## Build & Dev Commands

```bash
yarn build                    # Build all packages (core → mctl)
yarn lint                     # ESLint across all packages
yarn format                   # Prettier across all packages
yarn typecheck                # tsc --noEmit across all packages

# Build individual package
yarn workspace @m-control/core build
yarn workspace @m-control/mctl build
```

Build order matters: `core` must be built before `mctl` (mctl imports from `core/dist`).

---

## Key Files to Know

| File | Why you'd open it |
|------|------------------|
| `packages/core/src/types.ts` | Source of truth for all contracts |
| `docs/architecture/execution-model.md` | Tool Protocol v1 spec in prose |
| `docs/adr/0003-ndjson-protocol.md` | Why NDJSON over alternatives |
| `docs/adr/0002-monorepo-workspaces.md` | Why yarn workspaces, why not Nx |
| `docs/architecture/constraints.md` | Hard rules — read before making architectural decisions |
| `docs/ai/PROJECT-CONTEXT.md` | Attach to every new AI coding session |
| `tools/misc/hello-world/index.js` | Reference implementation of Tool Protocol v1 |
| `templates/node-tool/`, `templates/python-tool/` | Copy-paste start for new tools |

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
- TUI / interactive mode — removed in this refactor, will return later
- Auth abstraction, telemetry — intentionally deferred
- Per-tool guardrail overrides in the manifest (runner defaults apply to all tools)

---

## Further Reading

```
docs/
├── VISION.md                  Where this is going (CLI → SaaS)
├── architecture/OVERVIEW.md   Component map
├── architecture/plugin-contract.md
├── ai/CODING-GUIDELINES.md    Patterns to follow
└── ai/ANTI-PATTERNS.md        What not to do (with rationale)
```
