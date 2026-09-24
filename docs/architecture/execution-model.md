# Execution Model — Tool Protocol v1

How the orchestrator discovers, invokes, and processes output from tools.

> **Decision reference:** [ADR-0003](../adr/0003-ndjson-protocol.md) — why NDJSON over stdin/stdout

---

## Overview

```
mctl run <id>
     │
     ▼
[Discovery] scan tools/**/manifest.json
     │  reads: manifestVersion, id, runtime, entry
     ▼
[Config] load ~/.m-control/config.json
     │  extracts: the keys this tool declares
     │            (manifest.requiredConfig + manifest.optionalConfig)
     ▼
[Runner] spawn child process
     │  writes: ToolRequest JSON → stdin
     │  reads:  ToolEvent NDJSON ← stdout (line by line)
     │  reads:  raw text ← stderr (logged, not parsed)
     ▼
[EventSink] renders events → terminal (or passthrough with --json)
     │
     ▼
exit code → 0 ok / 1 expected failure / ≥2 crash
```

---

## Tool Protocol v1

### Channels

| Channel | Direction | Format | Purpose |
|---------|-----------|--------|---------|
| `stdin` | orchestrator → tool | Single JSON object | `ToolRequest` (context + input) |
| `stdout` | tool → orchestrator | NDJSON (one event per line) | `ToolEvent` stream |
| `stderr` | tool → orchestrator | Raw text | Diagnostic logs, stack traces |
| Exit code | tool → OS | Integer | `0` success / `1` expected failure / `≥2` crash |

**Critical rule:** `stdout` is exclusively NDJSON `ToolEvent` lines.  
All human-readable messages must be `log` events or go to `stderr`.  
A tool emitting raw text to stdout breaks the orchestrator's parser.

---

### stdin — ToolRequest

Written once by the orchestrator before the tool starts executing.  
Tools must read stdin to EOF, then parse as JSON.

```typescript
interface ToolRequest {
  context: RunContext;
  input: ToolInput;   // arbitrary, tool-defined
}

interface RunContext {
  toolId: string;
  config: Record<string, unknown>; // flat key-value, e.g. { "azdo.token": "..." }
  workspaceRoot: string;           // absolute path to project root
}
```

**Example:**
```json
{
  "context": {
    "toolId": "azdo-pr-review",
    "config": {
      "azdo.token": "pat-xxxx",
      "azdo.organization": "myorg"
    },
    "workspaceRoot": "/home/michal/projects/myrepo"
  },
  "input": {
    "prId": 42
  }
}
```

---

### stdout — ToolEvent NDJSON stream

Every line is a complete JSON object. No partial lines. No blank lines.

```typescript
interface BaseEvent {
  type: 'started' | 'log' | 'result' | 'error';
  ts: string;       // ISO-8601, set by the TOOL at emission time
  toolId: string;   // must match manifest.id
  payload: unknown;
}
```

#### Event types

**`started`** — emitted immediately after tool init, before any work:
```json
{"type":"started","ts":"2025-02-25T10:00:00.000Z","toolId":"hello-world","payload":{}}
```

**`log`** — structured human output:
```json
{"type":"log","ts":"...","toolId":"hello-world","payload":{"level":"info","message":"Fetching PR #42"}}
```
Levels: `debug | info | warn | error`

**`result`** — final payload (last one wins if multiple):
```json
{"type":"result","ts":"...","toolId":"hello-world","payload":{"review":"LGTM"}}
```

**`error`** — structured failure:
```json
{"type":"error","ts":"...","toolId":"hello-world","payload":{"message":"PAT expired","code":"AUTH_FAILED","recoverable":true}}
```
`recoverable: true` = user can fix  
`recoverable: false` = bug, should be reported

---

### Exit codes

| Code | Meaning | Expected events |
|------|---------|-----------------|
| `0` | Success | `started`, optional `log`s, `result` |
| `1` | Expected failure | `started`, optional `log`s, `error` |
| `≥2` | Crash | Anything or nothing — treat as unrecoverable |

---

## Runner Guardrails

| Guardrail | Default | Behaviour when hit |
|-----------|---------|-------------------|
| `timeoutMs` | 30,000ms | SIGTERM → error event → caller notified |
| `maxOutputBytes` | 10 MB | SIGTERM → error event |
| `maxEvents` | 10,000 | SIGTERM → error event |

Guardrail hits surface as `ErrorEvent` with `code: 'RUNNER_GUARDRAIL'`.

### Resolving `timeoutMs`

The 30s default suits a tool that calls an API. It does not suit one that
renders 93 icons or drives a desktop app, so the budget is per tool.
`mctl run` resolves it highest-precedence first:

| Source | Meaning |
|--------|---------|
| `config.timeouts.tools["<id>"]` | the user's decision for this tool, on this machine |
| `manifest.timeoutMs` | what the tool author measured it to cost |
| `config.timeouts.default` | the user's blanket preference |
| built-in `30_000` | |

A manifest budget wins over `timeouts.default`: the default covers tools that
never said what they need, it is not a cap on the ones that did. Values that
are not positive finite numbers are rejected at discovery, because a zero
budget would kill every run instantly.

---

## Runner Interface

```typescript
interface Runner {
  run(
    manifest: ToolManifest,
    context: RunContext,
    input: ToolInput,
    options?: RunnerOptions,
  ): AsyncIterable<ToolEvent>;
}
```

---

## CLI Modes

```bash
# Pretty-print (default)
mctl run hello-world

# NDJSON passthrough — for piping / scripting
mctl run hello-world --json
```

---

## Tool Implementation Checklist

- [ ] Read all of stdin, parse as `ToolRequest` JSON
- [ ] Emit `started` event before doing any work
- [ ] All human output → `log` events or stderr (never raw stdout)
- [ ] Emit `result` on success, `error` on expected failure
- [ ] Set `ts` (ISO string) and `toolId` in every event
- [ ] Exit 0 / 1 / ≥2 appropriately

---

## Related Docs

- [Plugin Contract](plugin-contract.md)
- [ADR-0003](../adr/0003-ndjson-protocol.md) — protocol design rationale
- [ADR-0002](../adr/0002-monorepo-workspaces.md) — monorepo structure

---

**Last updated:** 2025-02-25 — Rewritten for Tool Protocol v1  
**Supersedes:** Previous temp-file-based execution model
