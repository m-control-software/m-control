# ADR-0008: Vitest as the Test Framework

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** Michał + Claude
**Tags:** testing, tooling

## Context

The repo had no tests and an open "Jest or Vitest" TBD. With the runtime
engine now handling multiple runtimes, config layering, and multi-root
discovery, regressions in `@m-control/core` would silently break every tool.
A decision was needed before tool-building starts in earnest.

## Decision

Use **Vitest**, configured at the monorepo root, with tests colocated per
package under `packages/<name>/test/*.test.ts`. `yarn test` runs the suite;
CI runs it on every push/PR.

Scope by layer:
- `packages/core` — unit tests (discovery, config, spawn-command resolution) are **required** for new behavior
- `apps/mctl` — covered by the CI smoke test (`list` + `run hello-world`); command unit tests optional
- `tools/` — no framework requirement; each tool is a black box exercised via `mctl run`

## Consequences

### Positive
- ✅ Native TypeScript/ESM support — no ts-jest transform config
- ✅ Jest-compatible API (describe/it/expect) — nothing new to learn
- ✅ Fast watch mode for TDD on core

### Negative
- ❌ Younger ecosystem than Jest (acceptable — no exotic needs here)

## Alternatives Considered

### Option A: Jest
**Why rejected:** Needs ts-jest/babel wiring for TS monorepos and is slower;
no feature this project needs that Vitest lacks.

### Option B: node:test (built-in)
**Why rejected:** Minimal assertions/mocking and weaker TS story; would grow
custom helpers that a framework provides for free.

## Related Decisions

- **Resolves TBD noted in:** CLAUDE.md stack section, ONBOARDING.md
