# Archive

Superseded design documents, kept for history. **Nothing here describes the
current system — don't implement from it.** Each file carries a banner pointing
to its replacement.

| File | What it was | Replaced by |
|------|-------------|-------------|
| `OVERVIEW-2025.md` | Single-package design: TUI, plugin registry, service locator | `docs/architecture/OVERVIEW.md` |
| `plugin-contract.md` | In-process TypeScript plugins + external tools over temp files | `docs/architecture/execution-model.md` (Tool Protocol v1) |
| `context-model.md` | Runtime/service context layers for plugins | `RunContext` in `packages/core/src/types.ts`, `AGENTS.md` → Config |
| `plugin-flow.mmd` | Interactive-mode flow diagram | `docs/architecture/OVERVIEW.md` → Run flow |
