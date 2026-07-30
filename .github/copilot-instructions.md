# m-control — Copilot instructions

TypeScript monorepo (Yarn workspaces): `packages/core` is the runtime engine
(`@m-control/core`, library only), `apps/mctl` is the CLI, `tools/` holds
standalone tool processes (any language, NOT npm packages).

Canonical docs — prefer these over guessing:

- `docs/architecture/constraints.md` — hard rules
- `docs/architecture/execution-model.md` — Tool Protocol v1
- `docs/ai/CODING-GUIDELINES.md` — patterns and naming
- `CLAUDE.md` — condensed working rules (shared source of truth)

Key rules:

- Build from the repo root: `yarn build` (core builds before mctl).
- Tool stdout is NDJSON ToolEvent lines only; tools read a single JSON
  ToolRequest from stdin to EOF before executing.
- Never `console.log` in `packages/` or `apps/` production code — use EventSink.
- Never throw raw `Error` — use the error hierarchy exported by `@m-control/core`.
- Import core only via the package name `@m-control/core`, never internal paths.
- New tools: copy `templates/node-tool/` or `templates/python-tool/` into
  `tools/<category>/<id>/`; discovery is automatic, no registration.
