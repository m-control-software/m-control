# Contributing to m-control

This document describes how to work with the m-control project: branching, CI, commits, releases. Coding rules and contracts live in `AGENTS.md`.

## Project philosophy

**This is an evolving product, not a finished library.**
- MVP first, optimize later
- Ship fast, iterate based on real usage
- Document decisions (ADRs), not just code
- AI-assisted development is the default

## Getting started

### Prerequisites

- Node.js 18+
- Yarn 1.22+
- Git
- Python 3.10+ (for Python tools and their tests)

### Setup

```bash
git clone <repo>
cd m-control
yarn install
yarn build
```

### Development workflow

```bash
yarn typecheck             # type-check all packages (build core first)
yarn lint                  # lint all packages
yarn test                  # Vitest
yarn build                 # full build (core then mctl)
yarn workspace @m-control/core dev   # watch mode for core
```

To run without installing:

```bash
node apps/mctl/dist/bundle/index.js --help
node apps/mctl/dist/bundle/index.js init
node apps/mctl/dist/bundle/index.js list
node apps/mctl/dist/bundle/index.js run hello-world
node apps/mctl/dist/bundle/index.js doctor
```

## Branching strategy

**Current practice:** work is done on short-lived branches (often created by a
coding agent, e.g. `claude/<topic>`) and merged into `main`. CI gates pushes
and PRs to `main`. Version tags (`v0.X.0`) go on `main`.

**Documented model (ADR-0005):** `main` (stable, tags) + `develop` (direct
commits while solo), with `main` updated from `develop` at milestones. This is
not what happens today: `develop` is behind `main` and carries a few commits
that were never merged. ADR-0005 needs revisiting — either retire `develop`
(supersede the ADR) or return to it. Until then, target `main`.

## Commit conventions

No strict format enforced yet, but aim for:

```
<type>: <short description>

<body — why, not what>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

Example:
```
feat: add AZDO PR review tool

Implements the first real tool using the Claude API.
Reads PR diff from stdin, calls Claude, emits review as result event.
```

## CI pipeline

GitHub Actions runs on every push and pull request targeting `main` or `develop`.

Pipeline: `.github/workflows/ci.yml`

Steps (in order):

| Step | Command | What it checks |
|------|---------|---------------|
| Install | `yarn install --frozen-lockfile` | Lockfile is consistent |
| Build core | `yarn workspace @m-control/core build` | Core compiles; mctl's typecheck needs its `dist/` |
| Typecheck | `yarn typecheck` | No TypeScript errors in any package |
| Lint | `yarn lint` | No ESLint violations in `src/` of each workspace |
| Test | `yarn test` | Vitest suites for core and tools (Windows-only suites skip) |
| Build | `yarn build` | Both packages compile and bundle successfully |
| Smoke test | `--help`, `init`, `list`, `doctor` (must fail on the fresh config, then pass once required keys are set), `run hello-world`, `run hello-python` | The bundle runs end to end, node and python runtimes included |

### Reading CI failures

**Typecheck fails:** TypeScript error in `packages/core/src/` or `apps/mctl/src/`. The error message includes the file and line number. Fix the type error — do not use `// @ts-ignore` unless the cause is an upstream type bug.

**Lint fails:** ESLint violation. Run `yarn lint` locally to reproduce, then `yarn workspace <pkg> lint -- --fix` to auto-fix what's fixable.

**Test fails:** Run `yarn test` locally; `yarn vitest run <path>` runs one file. Tool tests spawn the tool, so check its stderr in the output.

**Build fails:** Usually a missing import or a core/mctl build-order issue. Check that `packages/core/dist/` exists before `mctl` builds.

**Smoke test fails:** The bundle was produced but a command fails. Re-run the failing command from the workflow locally; `doctor` exits 1 on any `[FAIL]` line. A new tool with `requiredConfig` must also get CI values in the workflow's config step, or the second `doctor` run fails.

## Adding a new tool

1. Copy the boilerplate:
   ```bash
   cp -r templates/node-tool tools/<category>/<tool-id>   # or templates/python-tool
   ```

2. Fill in `manifest.json` and implement the entry file following Tool Protocol v1.

3. Add tests, a `README.md`, and a `CHANGELOG.md` entry.

The full checklist is in `AGENTS.md` → "Adding a tool"; the protocol spec is
`docs/architecture/execution-model.md`.

## Architecture decisions

### When to create an ADR

Create an Architecture Decision Record when:
- Choosing technology or framework
- Defining architecture patterns
- Making trade-offs with long-term impact
- Changing existing architectural decisions

### How to create an ADR

```bash
cp docs/adr/TEMPLATE.md docs/adr/XXXX-short-title.md
# Fill in all sections, then commit
```

Next ADR number: check `docs/adr/` and increment.

See `docs/ai/PROMPTS/write-adr.md` for an AI-assisted ADR writing guide.

## Code style

**Enforced by tools:**
- ESLint + Prettier (`yarn format` to auto-fix)
- TypeScript strict mode

**Manual guidelines:** `docs/ai/CODING-GUIDELINES.md`

Rules: `AGENTS.md` → "Code rules" and `docs/architecture/constraints.md`.

## Documentation

### When to update docs

- **Always:** Architectural changes → ADR + update relevant architecture docs
- **Always:** Contract changes (manifest, protocol, config, CLI) → `AGENTS.md` + `docs/architecture/execution-model.md`
- **Always:** New constraints → `docs/architecture/constraints.md`
- **Always:** Releases → `CHANGELOG.md` + version bump
- **Often:** New tools → `QUICKSTART.md` if it affects first-run flow
- **When you learn something:** Anti-patterns → `docs/ai/ANTI-PATTERNS.md`

### Key files

| File | When to update |
|------|---------------|
| `CHANGELOG.md` | Every releasable change |
| `docs/adr/` | Every architectural decision |
| `docs/ai/ANTI-PATTERNS.md` | When AI or you makes a mistake worth remembering |
| `docs/architecture/*.md` | When architecture changes |
| `QUICKSTART.md` | When the first-run experience changes |

## Release process

1. Make sure `main` is green
2. Update `CHANGELOG.md` — move `[Unreleased]` to `[vX.Y.Z] - YYYY-MM-DD`
3. Bump version in root `package.json` and workspace `package.json` files
4. Run `yarn build` and smoke test
5. Commit: `git commit -m "chore: release vX.Y.Z"`
6. Tag: `git tag vX.Y.Z`
7. Push: `git push && git push --tags`

## Troubleshooting

### Build issues

```bash
# Clean rebuild
rm -rf packages/core/dist apps/mctl/dist
yarn install
yarn build
```

### Type errors

```bash
# Type-check a single package
yarn workspace @m-control/core typecheck
yarn workspace @m-control/mctl typecheck
```

### ESLint issues

```bash
yarn lint
# Auto-fix what's possible
yarn workspace @m-control/core format
yarn workspace @m-control/mctl format
```

## Working with AI assistants

Start sessions with context:

Agents that read `AGENTS.md` (Codex, Cursor, Copilot) or `CLAUDE.md`
(Claude Code, which imports it) pick up the rules automatically. For others:

```
Read AGENTS.md first, then docs/ai/PROJECT-CONTEXT.md.
```

Use prompt templates in `docs/ai/PROMPTS/`.

**Remember:** Update `docs/ai/ANTI-PATTERNS.md` when AI generates something wrong. It prevents the same mistake next session.
