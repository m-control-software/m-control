# ADR-0006: Single ProcessRunner for All Runtimes

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** Michał + Claude
**Tags:** runner, polyglot, execution

## Context

Tool Protocol v1 was designed to be language-agnostic (JSON on stdin, NDJSON
on stdout), but only `NodeRunner` existed — `python`, `dotnet`, and
`powershell` manifests threw `NotImplementedError`. The repo is becoming a
bucket for many tools in different languages, so polyglot execution has to
actually work, not just be typed.

The original plan implied one Runner class per runtime. Reviewing
`NodeRunner`, ~95% of it (stdin write, NDJSON parsing, guardrails, lifecycle)
is runtime-independent; the only runtime-specific part is the spawn command.

## Decision

Replace per-runtime runners with a single **`ProcessRunner`** plus a pure
function **`resolveSpawnCommand(runtime, entryPath, overrides)`**:

| Runtime | Default command |
|---------|-----------------|
| `node` | `process.execPath` (the Node running mctl) |
| `python` | `python` on Windows, `python3` elsewhere |
| `powershell` | `powershell` on Windows, `pwsh` elsewhere |
| `dotnet` | `dotnet <entry>` for `.dll` entries; direct spawn for executables |

Users override interpreters per machine via `runtimes` in
`~/.m-control/config.json` (e.g. `{ "python": "py" }`). `NodeRunner` remains
as a deprecated alias so existing imports keep working.

## Consequences

### Positive
- ✅ All four runtimes work today with one tested code path
- ✅ Adding a runtime = one switch case + a default command, not a new class
- ✅ Machine differences (py vs python3, pwsh vs powershell) handled by config, not code
- ✅ `resolveSpawnCommand` is pure — trivially unit-testable, reused by `mctl doctor`

### Negative
- ❌ Runtime-specific needs (venvs, dotnet project launch, node flags) must fit the "command + entry" shape or force a future refactor
- ❌ A missing interpreter is only detected at spawn time (mitigated by `mctl doctor`)

### Neutral
- ⚪ `NotImplementedError` remains in the error hierarchy for future runtimes

## Alternatives Considered

### Option A: One Runner class per runtime
**Why rejected:** ~300 lines of duplicated streaming/guardrail logic per
runtime; divergence over time is exactly the spaghettification this repo is
trying to avoid.

### Option B: Shell out via a per-tool `command` field in the manifest
**Why rejected:** Moves interpreter choice into every manifest, making tools
machine-specific. Manifests should describe *what* the tool is; the runner
and config decide *how* to execute it on this machine.

## Related Decisions

- **Builds on:** ADR-0003 (NDJSON protocol — the reason runners can be generic)
- **Related to:** ADR-0007 (config supplies the `runtimes` overrides)
