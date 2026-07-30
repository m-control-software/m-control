# Changelog

All notable changes to m-control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`agent-status` tool** (`tools/agents/agent-status/`) — one dashboard for pending
  AI coding-agent sessions across providers: local Claude Code and Codex CLI session
  logs, Cursor background agents (API), and GitHub Copilot coding-agent PRs (API).
  Reports who is `awaiting-input` vs `working` vs `failed`; providers without config
  or local data are skipped gracefully. Optional config lives under
  `tools.agent-status` (Cursor API key, GitHub token). First real tool in the
  `tools/agents/` category.

- **Multi-runtime execution** — `ProcessRunner` runs all four runtimes (node, python,
  dotnet, powershell); the runtime only changes the spawn command. Interpreters can be
  overridden per machine via `runtimes` in the config. See ADR-0006. `hello-python`
  (`tools/misc/hello-python/`) proves the polyglot pipeline end to end.
- **Config-driven tool discovery** — tools roots resolve from `M_CONTROL_TOOLS_ROOT`
  env var → `paths.toolsRoots` in config → repo `tools/` fallback. Fixes the globally
  installed `mctl` finding no tools (it relied on a repo-relative path). Multiple roots
  are supported; duplicate tool ids are reported. See ADR-0007.
- **`mctl init` and `mctl doctor`** — `init` creates the config (registering the repo's
  `tools/` when run from a checkout); `doctor` diagnoses config validity, tools roots,
  discovery warnings, and runtime availability, exiting non-zero on failure.
- **Tool input from the command line** — `mctl run <id> key=value ...` passes bare
  key=value pairs as the tool's input (values arrive as strings).
- **Linux/macOS installer** (`scripts/install.sh`) — mirrors `install.ps1`: builds,
  copies the bundle to `~/.m-control`, creates `mctl`/`mm` wrappers in `~/.local/bin`,
  and registers the repo tools root in the config.
- **Vitest test suite** for `@m-control/core` (discovery, config, spawn-command
  resolution) wired into `yarn test` and CI. See ADR-0008.
- **AI assistant structure** — `.claude/skills/` for Claude Code project skills,
  `.cursor/rules/m-control.mdc` for Cursor, `.github/copilot-instructions.md` for
  Copilot. Assistant files are thin pointers; `CLAUDE.md` + `docs/` stay canonical.

### Changed

- **Open config schema** — `MControlConfig.tools` is now `Record<string, section>`;
  adding a tool never requires a change to `@m-control/core`. Existing configs remain
  valid (`configVersion` stays 1).
- **`extractToolConfig` resolves `requiredConfig` keys against the `tools` section**
  (previously resolved against the config root, so every key came back undefined).
- **`workspaceRoot` is now the invoking directory** (`process.cwd()`), not the mctl
  install location.
- **Tool templates rewritten** — `templates/node-tool/` and `templates/python-tool/`
  replace the pre-monorepo `templates/tool-boilerplate/`, which produced tools that
  failed manifest validation.

### Removed

- `docs/00-DOCS-STRUCTURE.md` (stale duplicate of root `DOCS-STRUCTURE.md`) and
  `.cursorrules` (described the pre-monorepo architecture).

### Planned
- AZDO PR review tool (Claude-powered)
- Kubernetes pod inspector
- Service abstractions (auth, logger, telemetry stubs)

---

## [0.2.0] - 2026-02-28

### Added

- **GitHub Actions CI pipeline** (`.github/workflows/ci.yml`) — runs typecheck, lint, build,
  and smoke test on every push and PR to `main` and `develop`. This makes breakage visible
  immediately rather than at install time. The smoke test (`node apps/mctl/dist/bundle/index.js --help`)
  catches bundle regressions that type-checking alone would miss.

- **Branching strategy** — `main` (stable, tagged releases) + `develop` (active work, direct
  commits while solo). See `docs/adr/0005-branching-strategy.md` for rationale. The two-branch
  model gives a stable release anchor without the ceremony of full Git Flow for a single
  developer.

- **GitHub issue templates** (`.github/ISSUE_TEMPLATE/feature.md`, `bug.md`) — structured
  templates with labels so issues carry enough context without free-form prompting.

- **`typecheck` script in root `package.json`** — `yarn typecheck` now runs `tsc --noEmit`
  in every workspace. Previously type-checking was only possible per-package.

- **ADR-0005** (`docs/adr/0005-branching-strategy.md`) — records the branching decision,
  the alternatives considered (trunk-based, full Git Flow), and when to revisit.

### Changed

- **`QUICKSTART.md`** — complete rewrite for the current monorepo state. Removed all
  references to the old single-package structure, `npm`, `esbuild`, and Polish-language
  sections. Now covers Yarn workspaces, build order, the ncc bundle path
  (`apps/mctl/dist/bundle/index.js`), and the Windows installer.

- **`README.md`** — updated project structure diagram, build instructions (Yarn not npm),
  dist path, and added branching strategy summary.

- **`docs/ai/PROJECT-CONTEXT.md`** — updated to reflect monorepo structure, CI pipeline,
  branching strategy, GitHub Projects as backlog, and correct build output path.

- **`CONTRIBUTING.md`** — added branching strategy section, CI step-by-step table,
  CI failure diagnosis guide, and updated all commands from npm to Yarn.

---

## [0.1.1] - 2026-02-25

### Added
- Monorepo migration to Yarn workspaces (`apps/mctl`, `packages/core`)
- ncc bundling — single self-contained `apps/mctl/dist/bundle/index.js`
- Tool Protocol v1 — NDJSON stdout / JSON stdin / exit codes (ADR-0003)
- `hello-world` reference tool in `tools/misc/hello-world/`
- Tool discovery via `discoverTools()` — no registration step required

### Changed
- Build output path changed from `dist/mctl.js` to `apps/mctl/dist/bundle/index.js`
- Build command changed from `npm run build` to `yarn build` (run from monorepo root)

---

## [0.1.0] - 2025-02-18

### Added
- Initial project setup with TypeScript orchestrator
- Command registry with grouped commands
- Config manager with automatic initialization
- First test command: `hello-world`
- Interactive TUI mode using prompts library
- Direct command execution support
- Help command (`--help`)
- Aliases: `mctl` and `mm`
- ESLint and Prettier configuration
- VS Code / Cursor workspace configuration
- Build system (TypeScript + esbuild)
- Windows PowerShell installer script
- Documentation structure:
  - Project vision and architecture docs
  - AI-first documentation (PROJECT-CONTEXT, CODING-GUIDELINES, ANTI-PATTERNS)
  - Architecture Decision Records (ADR) system
  - Code templates and boilerplates
  - Custom AI prompts library

---

## Version format

**[MAJOR.MINOR.PATCH]**
- **MAJOR:** Breaking changes
- **MINOR:** New features (backward compatible)
- **PATCH:** Bug fixes (backward compatible)

## Change categories

- **Added:** New features
- **Changed:** Changes in existing functionality
- **Deprecated:** Soon-to-be removed features
- **Removed:** Now removed features
- **Fixed:** Bug fixes
- **Security:** Vulnerability fixes

---

[Unreleased]: https://github.com/your-repo/m-control/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/your-repo/m-control/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/your-repo/m-control/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/your-repo/m-control/releases/tag/v0.1.0
