# m-control — Project Context

**Read `AGENTS.md` first**: layout, commands, contracts, procedures and code
rules live there and nowhere else. This file is the project-level picture a
new session needs on top of that: where the project stands, what's next, and
what is undecided. It deliberately does not repeat structure, commands or
rules — those went stale every time they were copied here.

## What it is

A personal CLI orchestrator for developer productivity: `mctl` discovers and
runs standalone tool processes over a small JSON/NDJSON protocol. Personal use
today; a product for developer teams is the long-term direction
(`docs/VISION.md`).

## Where it stands (2026-09-25)

- Core and CLI are stable: discovery across several tools roots, one process
  runner for node / python / powershell / dotnet, per-tool run budgets,
  `init` / `list` / `run` / `doctor`.
- Real tools: `agent-status` (AI coding-agent sessions dashboard),
  `stream-deck` and `logi-options` (device profiles generated from specs and
  applied to live state). The list with one-liners is in `AGENTS.md`.
- Engineering is AI-first: every rule that can be checked is a test or a lint
  (`yarn verify`, which CI runs verbatim), scaffolding is a script
  (`yarn new:tool`, `yarn new:adr`, `yarn release`), and multi-step
  procedures are skills (`AGENTS.md` → "Procedures (skills)").

## What's next

- First work tool: AZDO PR review (Claude-powered)
- Kubernetes pod inspector
- Service abstractions (auth, logger, telemetry stubs)
- Longer term: license system (v0.5), cloud backend (v1.0), marketplace

## Open decisions — read before structural work

Two ADRs are **Proposed, not Accepted**. They change repo layout and the
manifest schema, so resolve them before structural work:

- `docs/adr/0009-repository-topology-and-personal-work-split.md` — m-control
  as a personal + work control center; GitHub org, personal tools as a second
  tools root, secrets handling.
- `docs/adr/0010-tool-kinds-task-app-artifact.md` — optional manifest `kind` /
  `visibility` / `requires.bin`, plus `mctl apply` for config artifacts.

Each has an **Open Questions** section listing exactly what is undecided.
Changing either means the `change-contract` and `write-adr` skills.

## Backlog

GitHub Projects; issues use `.github/ISSUE_TEMPLATE/` (feature, bug).
