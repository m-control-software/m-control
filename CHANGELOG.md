# Changelog

All notable changes to m-control will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`yarn verify`** — one script with every check CI runs, in CI order; CI
  runs it verbatim (`scripts/verify.mjs`), so "passes locally" and "passes
  CI" mean the same thing. `--from=<step>` resumes after a fix. The smoke test
  moved to `scripts/smoke.mjs` and runs in a throwaway HOME: it used to write
  to the real `~/.m-control/config.json`. Required config for it now comes
  from each tool's `test/smoke-config.json` instead of the workflow file.

- **`yarn new:tool`** — scaffolds a tool from a template (id filled in
  everywhere, protocol test, CHANGELOG entry). The node and python templates
  now read their id and `requiredConfig` from `manifest.json` and fail with a
  recoverable `CONFIG_MISSING` on their own.

- **`yarn new:adr`** (next number, header filled) and **`yarn release`**
  (moves `[Unreleased]`, bumps every `package.json`, runs verify, commits and
  tags; never pushes).

- **Mechanical checks for what used to be checklists:** a per-tool
  conformance suite (layout, README documents every config key, smoke config,
  malformed request and missing config both end in a well-formed error),
  docs checks (links, quoted paths, skills indexed), ADR numbering, and a
  JSON Schema for manifests (`packages/core/schemas/manifest.v1.schema.json`)
  held in parity with `validateManifest`. Shared tool-test helpers in
  `test-support/` (`runTool`, `expectProtocol`).

- **Linting for everything:** tool and script JS (ESLint + Prettier), Python
  (ruff), PowerShell (PSScriptAnalyzer against the Windows PowerShell 5.1
  profile, so PS7-only syntax fails on Linux CI too). Tests are type-checked.
  Versions pinned in `linters.json`; `yarn setup:linters` installs them. CI
  runs Python 3.10, the minimum tools support.

- **Skills** `add-tool`, `change-contract`, `write-adr`, `release` and
  `author-deck-profile`, indexed in `AGENTS.md` → "Procedures (skills)" so
  every agent can follow them. `REVIEW.md` lists what reviewers check beyond
  `yarn verify`. `tools/artifacts/stream-deck/docs/spec-format.md` documents
  the `*.deck.json` format.

- **Claude Code hooks** (`.claude/hooks/`): set up cloud sessions, format
  edited TS/JS.

- **`stream-deck` tool** (`tools/artifacts/stream-deck/`, ADR-0010 "Generated
  artifacts"): builds an Elgato Stream Deck profile from declarative
  `*.deck.json` packs and installs it in place of the previous version. Packs
  can live outside the repo (`tools.stream-deck.packDirs`); an absent pack is a
  no-op. `check=true` validates and builds without writing. Install refuses
  while the Stream Deck app runs, backs up the old profile, swaps by rename,
  and recovers from a run killed mid-swap. Runs under Windows PowerShell 5.1.

- **Per-tool run budgets** — a manifest may declare `timeoutMs`, and config
  gains `timeouts` (`default`, and `tools` keyed by id). Precedence:
  `timeouts.tools[id]` > `manifest.timeoutMs` > `timeouts.default` > 30 s.
  Previously the 30 s was hard-coded, so a tool that needed longer (a full
  Stream Deck install measured ~21 s and sometimes overran) could not run
  reliably. Invalid values are rejected at discovery.

- **`optionalConfig` in manifests** — keys a tool reads when present. A tool
  receives the union of `requiredConfig` and `optionalConfig`; before this,
  optional keys were never delivered.

- **`mctl doctor` checks required config** — reports every tool whose
  `requiredConfig` keys are unset or empty, naming the keys and the file.

- **`AGENTS.md`** — one canonical guide for AI coding agents (layout,
  commands, contracts, adding a tool, code rules). `CLAUDE.md` imports it; the
  Cursor and Copilot files point at it.

- **`logi-options` tool** (`tools/artifacts/logi-options/`, ADR-0011): Logitech MX Master 4
  button, gesture, and per-app profiles from declarative `*.logi.json` packs. Options+
  keeps its configuration in one JSON document owned by a running agent, so applying
  is a guarded transaction: backup, stop agent, surgical patch, restart, decompile
  what the agent kept, and roll back on mismatch. It is budgeted inside mctl's 30 s
  kill timeout. `check=true` doubles as a spec-vs-live drift report, and
  `mode=export` adopts changes made in the UI. The compiler reproduces UI-written
  cards byte-for-byte from Logitech's installed catalogs (none are vendored).
  Personal packs live outside the repo via `tools.logi-options.packDirs`. Includes
  the reverse-engineering notes (`docs/internals.md`), a maintenance method for
  Options+ updates, and the `author-logi-profile` Claude skill.

- **`agent-status` v0.3: `cursor-ide` provider** — sessions inside the Cursor
  desktop app now show up. The Cursor API only lists cloud Background Agents, so
  IDE chats are read from Cursor's local SQLite state (`workspaceStorage` +
  `globalStorage` `state.vscdb`, via dependency-free `node:sqlite` with a
  `--experimental-sqlite` re-exec fallback): last speaker determines
  awaiting-input vs idle, and a process scan demotes everything to closed when
  Cursor isn't running. The cloud `cursor` provider now explains itself when it
  returns 0 agents.

- **`agent-status` v0.2: verified liveness** — statuses are no longer log-file
  guesses. `mctl run agent-status setup=claude-hooks` installs Claude Code
  lifecycle hooks (SessionStart/UserPromptSubmit/Stop/Notification/SessionEnd)
  that maintain a live-session registry (`~/.m-control/state/claude-sessions.json`)
  with PIDs; the tool verifies each PID on every run, so closed/killed terminals
  report as closed instead of `awaiting-input`, and stale registry entries are
  pruned. Without hooks, a process scan guarantees nothing is reported as
  `awaiting-input` when no `claude`/`codex` process is running. Agents now carry
  a `verified` flag; unverified statuses are marked in the output.

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

- **`stream-deck` enforces its required config.** With `profileName` or
  `packDirs` unset it used to carry on (on Windows, toward installing the
  shared pack under the spec's name) and fail later with a null-path error.
  It now fails first with `CONFIG_MISSING`, naming the keys. It also emits
  `started` before an error about an unreadable request.

- **Manifests with non-string-array `tags` are rejected** at discovery; they
  were silently accepted.

- **Toolchain pinned:** Yarn via `packageManager`, Node via `.nvmrc` (22),
  Python via `.python-version` (3.10). `engines.node` is `>=20` (Vitest 4
  already required it).

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

- **`logi-options` declares `timeoutMs: 30000`** — its transaction budgets
  against exactly 30 s; without a declaration a lower `timeouts.default`
  could kill it while the Options+ agent is stopped. A test keeps the two
  numbers equal.
- **CI smoke test** — `doctor` must fail on a fresh config, then pass once
  the workflow supplies each tool's required keys. CI was red since `doctor`
  started checking required config.
- **Docs brought in line with the code** — `constraints.md` and
  `CODING-GUIDELINES.md` rewritten to rules the code follows; QUICKSTART
  (missing `mctl init`, invalid manifest example), ONBOARDING,
  PROJECT-CONTEXT, README, CONTRIBUTING, execution-model, and the
  implement-tool / design-review / write-adr prompts updated.
- **Claude Code settings** — shared permissions moved to
  `.claude/settings.json`; `.claude/settings.local.json` and
  `CLAUDE.local.md` are no longer tracked.

- **`mctl init` writes a tool-agnostic config** — the embedded template no
  longer contains sections for `azdo`, `k8s`, `obsidian` (never tools) or
  `agent-status`. Core held tool-specific keys, contradicting the open schema,
  and they went stale. Tools document their keys in their README; `mctl doctor`
  names missing required ones. Existing configs are unaffected.

- **Branching: trunk-based on `main`** (ADR-0012, supersedes ADR-0005). The
  `main` + `develop` model hadn't been followed since March; `develop` is
  retired and CI no longer triggers on it. Known-good versions are release
  tags.

### Removed

- `package-lock.json` (the repo uses Yarn), `.claude/rules/` (restated
  `AGENTS.md`), `docs/ai/ANTI-PATTERNS.md` (partly hypothetical and partly
  wrong — its real lessons moved to `LESSONS-LEARNED.md`), `DOCS-STRUCTURE.md`
  (merged into `docs/README.md`), and `docs/ai/PROMPTS/` (replaced by skills;
  the Stream Deck import recipe moved to
  `tools/artifacts/stream-deck/docs/import-existing-setup.md`).

- `config/config.template.json` — copied into `~/.m-control/` by the
  installers but read by nothing; the installers now delete the leftover copy.
- Pre-monorepo design docs (`architecture/OVERVIEW.md` old version,
  `plugin-contract.md`, `context-model.md`, `diagrams/plugin-flow.mmd`) moved
  to `docs/archive/` with a superseded banner; a new `OVERVIEW.md` describes
  the current system.
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
