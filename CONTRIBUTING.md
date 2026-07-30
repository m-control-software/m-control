# Contributing to m-control

This document describes how to work with the m-control project. It's primarily for Michał (project owner) but also serves as a guide for future contributors and AI assistants.

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

### Setup

```bash
git clone <repo>
cd m-control
yarn install
yarn build
```

### Development workflow

```bash
yarn typecheck             # type-check all packages (fast)
yarn lint                  # lint all packages
yarn build                 # full build (core then mctl)
yarn workspace @m-control/core dev   # watch mode for core
```

To run without installing:

```bash
node apps/mctl/dist/bundle/index.js --help
node apps/mctl/dist/bundle/index.js list
node apps/mctl/dist/bundle/index.js run hello-world
```

## Branching strategy

Two long-lived branches:

| Branch | Purpose | Who commits |
|--------|---------|-------------|
| `main` | Stable, releasable. Version tags here only. | Merge from `develop` only |
| `develop` | Active development. | Direct push while solo |

**Rules:**
1. Day-to-day work goes to `develop` directly — no feature branches while solo.
2. `main` is only updated by merging `develop` at a releasable milestone.
3. Version tags (`v0.X.0`) go on `main` only.
4. When the first external contributor joins: short-lived feature branches off `develop`, PR into `develop` for review.

See `docs/adr/0005-branching-strategy.md` for the full rationale.

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
| Typecheck | `yarn typecheck` | No TypeScript errors in any package |
| Lint | `yarn lint` | No ESLint violations |
| Build | `yarn build` | Both packages compile and bundle successfully |
| Smoke test | `node apps/mctl/dist/bundle/index.js --help` | Built binary actually runs |

### Reading CI failures

**Typecheck fails:** TypeScript error in `packages/core/src/` or `apps/mctl/src/`. The error message includes the file and line number. Fix the type error — do not use `// @ts-ignore` unless the cause is an upstream type bug.

**Lint fails:** ESLint violation. Run `yarn lint` locally to reproduce, then `yarn workspace <pkg> lint -- --fix` to auto-fix what's fixable.

**Build fails:** Usually a missing import or a core/mctl build-order issue. Check that `packages/core/dist/` exists before `mctl` builds.

**Smoke test fails:** The bundle was produced but crashes on startup. Run `node apps/mctl/dist/bundle/index.js --help` locally to debug.

## Adding a new tool

1. Copy the boilerplate:
   ```bash
   cp -r templates/node-tool tools/<category>/<tool-id>   # or templates/python-tool
   ```

2. Edit `manifest.json` — set `manifestVersion: 1`, `id`, `runtime`, `entry`.

3. Implement the entry file following Tool Protocol v1:
   - Read all of `stdin` before executing (JSON `ToolRequest`)
   - Emit NDJSON `ToolEvent` lines to `stdout` only
   - Never use `console.log` to stdout — it breaks the NDJSON parser
   - Event sequence: `started` → `log*` → `result` or `error`

4. No registration needed — `discoverTools()` finds tools automatically.

5. Test:
   ```bash
   node apps/mctl/dist/bundle/index.js run <tool-id>
   ```

See `docs/architecture/execution-model.md` for the full protocol spec.

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

Key rules:
- Use the error class hierarchy — never `throw new Error(...)` raw
- No `console.log` in `packages/` or `apps/` (use EventSink)
- Actionable error messages: tell the user what to do, not just what went wrong

## Documentation

### When to update docs

- **Always:** Architectural changes → ADR + update relevant architecture docs
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

1. Merge `develop` → `main`
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

```
Read docs/ai/PROJECT-CONTEXT.md first.
Constraints are in docs/architecture/constraints.md.
```

Use prompt templates in `docs/ai/PROMPTS/`.

**Remember:** Update `docs/ai/ANTI-PATTERNS.md` when AI generates something wrong. It prevents the same mistake next session.
