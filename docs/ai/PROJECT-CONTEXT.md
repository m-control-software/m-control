# m-control — AI Project Context

**Read `AGENTS.md` first** — it has the working rules and contracts. This file
is the project-level picture: what exists, what's next, and what's undecided.

## What is m-control?

A personal CLI orchestrator for developer productivity — discovers and runs standalone tool processes. Personal use today, SaaS product for developer teams tomorrow.

**Current phase:** MVP — building for personal use (Michał's workflow)
**Future:** SaaS product for developer teams
**Tech stack:** TypeScript monorepo, Node.js CLI, polyglot tool processes

---

## Current state (as of 2026-09-24)

### What works

- ✅ Yarn workspaces monorepo (`apps/mctl`, `packages/core`)
- ✅ `@m-control/core` — types, config (open schema, global + project merge),
  discovery across multiple tools roots, one `ProcessRunner` for node / python /
  powershell / dotnet (ADR-0006, ADR-0007), per-tool run budgets
- ✅ `@m-control/mctl` — `init`, `list`, `run <id> [k=v…] [--json]`, `doctor`
- ✅ Tool Protocol v1 — JSON stdin / NDJSON stdout / exit codes (ADR-0003)
- ✅ Tools:
  - `hello-world` (node), `hello-python` (python) — protocol references
  - `agent-status` (node) — pending sessions across Claude Code, Codex CLI,
    Cursor (cloud + IDE) and Copilot, with verified liveness via Claude hooks
  - `stream-deck` (powershell) — Stream Deck profile generated from `*.deck.json`
    packs and installed live (ADR-0010 "Generated artifacts")
  - `logi-options` (python) — MX Master 4 profiles from `*.logi.json` packs,
    applied to the live Options+ agent (ADR-0011). Authoring skill:
    `.claude/skills/author-logi-profile/`
- ✅ Vitest suites for core and tools (ADR-0008)
- ✅ ncc bundle at `apps/mctl/dist/bundle/index.js` (single self-contained file)
- ✅ ESLint + Prettier + TypeScript strict mode
- ✅ GitHub Actions CI — build, typecheck, lint, test, smoke test
- ✅ Installers: `scripts/install.ps1` (Windows), `scripts/install.sh` (Linux/macOS)

### What's next

- 🔨 First real tool: AZDO PR review (Claude-powered)
- 🔨 Kubernetes pod inspector
- 🔨 Service abstractions (auth, logger, telemetry stubs)

### ⏸️ Open decisions — read before architectural work

Two ADRs are **Proposed, not Accepted**. They change repo layout and the
manifest schema, so don't start structural work without resolving them:

- `docs/adr/0009-repository-topology-and-personal-work-split.md` —
  broadening m-control into a personal + work control center; GitHub org,
  personal tools as a second tools root, secrets handling
- `docs/adr/0010-tool-kinds-task-app-artifact.md` —
  optional manifest `kind` / `visibility` / `requires.bin`, plus
  `mctl apply` for config artifacts

Each has an **Open Questions** section listing exactly what's undecided.

### Roadmap

- v0.5: License system
- v1.0: Cloud backend
- v1.0+: Marketplace

---

## Monorepo structure

```
m-control/
├── apps/mctl/          # CLI binary (@m-control/mctl)
│   └── dist/bundle/    # ncc output — index.js is the runnable binary
├── packages/core/      # Runtime engine (@m-control/core) — library, no I/O
│   └── dist/           # TypeScript compiled output
├── tools/              # Standalone tool processes (NOT npm packages)
│   ├── misc/           # hello-world, hello-python
│   ├── agents/         # agent-status
│   └── artifacts/      # stream-deck, logi-options
├── templates/          # Boilerplate for new tools
├── docs/               # Architecture, ADRs, AI context (archive/ = superseded)
└── scripts/            # install.ps1, install.sh
```

**Build output:** `apps/mctl/dist/bundle/index.js` — run with `node apps/mctl/dist/bundle/index.js`

---

## Build order (critical)

```bash
yarn install                            # from monorepo root always
yarn workspace @m-control/core build    # FIRST
yarn workspace @m-control/mctl build    # SECOND (imports core/dist)
yarn build                              # runs both in correct order
```

---

## CI pipeline (GitHub Actions)

Pipeline: `.github/workflows/ci.yml`
Triggers: push or PR to `main`

Steps:
1. Checkout, setup Node 22
2. `yarn install --frozen-lockfile`
3. `yarn workspace @m-control/core build` — typecheck of mctl needs core's `dist/`
4. `yarn typecheck`
5. `yarn lint`
6. `yarn test` — Vitest; Windows-only tool suites skip on the Ubuntu runner
7. `yarn build`
8. Smoke test: `--help`, `init`, `list`, `doctor` (must fail on the fresh
   config, then pass after CI fills the required keys), `run hello-world`,
   `run hello-python`

---

## Branching strategy

Trunk-based on `main` (ADR-0012): short-lived branches (often agent-created
`claude/*`) merged into `main`, CI on every push. Known-good = release tags
`vX.Y.Z`. `develop` is retired. See `CONTRIBUTING.md`.

---

## Backlog

GitHub Projects is the backlog tool. Issues use templates from `.github/ISSUE_TEMPLATE/` (feature, bug).

---

## Architecture overview

```
User
  ↓
mctl CLI (apps/mctl)
  ↓
@m-control/core
  ├─ discoverTools()     — scans the tools roots for manifest.json
  ├─ getRunner()         — ProcessRunner: spawns, writes stdin, parses NDJSON
  ├─ loadConfig() etc.   — config, declared-key extraction, run budgets
  └─ Types               — ToolRequest, ToolEvent, ToolManifest, MControlConfig
  ↓
Tool process (tools/<category>/<id>/)
  ├─ stdin  → JSON ToolRequest
  ├─ stdout → NDJSON ToolEvent stream
  └─ stderr → raw diagnostic logs
```

**Key principle:** Core coordinates, tools execute. Details:
`docs/architecture/OVERVIEW.md`.

---

## Key constraints (MUST READ)

### Never
- `console.*` in `packages/core`; tool events rendered any way but an `EventSink`
- Hardcode paths — use `path.resolve()` or config
- Modify `packages/core` public API without updating `src/index.ts`
- Raw stdout in tools — all output via ToolEvent NDJSON
- Import from `packages/core/src/` directly — use the package name `@m-control/core`
- Store credentials in plaintext logs
- Break config compatibility without migration

### Always
- Use structured logging
- Validate user input
- Handle errors gracefully with actionable messages
- Think: "Does this work local AND cloud?"
- Document WHY not just WHAT (ADRs for architecture decisions)

**Full list:** `docs/architecture/constraints.md`

---

## Error handling

Use the error class hierarchy — never throw raw `Error`:

```typescript
import { ConfigError, ManifestError, RunnerError } from '@m-control/core';
throw new ConfigError('configVersion mismatch: expected 1, got 2. Delete ~/.m-control/config.json and run mctl init.');
```

**Full guide:** `.claude/rules/errors.md`

---

## Adding a tool

See `AGENTS.md` → "Adding a tool" (checklist) and
`docs/ai/PROMPTS/implement-tool.md` (prompt). Protocol:
`docs/architecture/execution-model.md`.

---

## Common tasks

```bash
yarn install                            # install dependencies (from root)
yarn typecheck                          # type-check all packages
yarn lint                               # lint all packages
yarn test                               # Vitest
yarn build                              # full build
node apps/mctl/dist/bundle/index.js init          # create config
node apps/mctl/dist/bundle/index.js list          # list tools
node apps/mctl/dist/bundle/index.js run hello-world
node apps/mctl/dist/bundle/index.js doctor
```

---

## Where to find things

| Question | File |
|----------|------|
| Working rules and contracts | `AGENTS.md` |
| Architecture map | `docs/architecture/OVERVIEW.md` |
| Architecture rules | `docs/architecture/constraints.md` |
| Tool Protocol spec | `docs/architecture/execution-model.md` |
| Code patterns | `docs/ai/CODING-GUIDELINES.md` |
| Anti-patterns | `docs/ai/ANTI-PATTERNS.md` |
| Past decisions | `docs/adr/` |
| Product vision | `docs/VISION.md` |
| First run guide | `QUICKSTART.md` |

---

## Red flags in AI-generated code

Stop and review if you see:
- `console.*` in `packages/core`, or tool events printed without an `EventSink`
- Hardcoded paths (should use `path.resolve()` or config)
- `any` type without a comment explaining why
- Breaking config changes without a migration path
- Direct access to `packages/core/src/` internals
- Synchronous I/O on large or unbounded data (small startup reads of config and manifests are fine)
- A tool reading a config key its manifest doesn't declare (it will always be undefined)
- Personal or client data (names, paths, specs) committed to the repo

---

**Last updated:** 2026-09-24
