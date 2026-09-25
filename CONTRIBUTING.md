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

Trunk-based on `main` (ADR-0012, superseding ADR-0005):

1. `main` is the only long-lived branch. Work on a short-lived branch (coding
   agents create `claude/<topic>`), or commit small changes directly.
2. Run `yarn verify` before anything reaches `main`; CI runs the same script on
   every push and PR to `main`.
3. A red `main` gets fixed before new work lands.
4. The known-good state is the latest release tag `vX.Y.Z`, not the tip of
   `main`. To install a proven version on another machine, check out the tag
   and run the installer.
5. `develop` is retired: don't branch from it or merge it.

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

GitHub Actions runs on every push and pull request targeting `main`. The
workflow (`.github/workflows/ci.yml`) runs `scripts/verify.mjs` and nothing
else, so `yarn verify` locally is the same check. The step list lives in that
script; `AGENTS.md` → "Commands" describes it.

### Reading failures

The failing step prints `yarn verify --from=<step>`; fix and resume there.

**Typecheck fails:** the error names the file and line. Don't reach for `// @ts-ignore` unless the cause is an upstream type bug.

**Lint fails:** `yarn workspace <pkg> lint --fix` fixes what is fixable.

**Test fails:** `yarn vitest run <path>` runs one file. Tool tests spawn the tool, so its stderr is in the output.

**Build fails:** usually a missing import or build order; `packages/core/dist/` must exist before `mctl` builds.

**Smoke fails:** `yarn smoke` reproduces it in the same throwaway HOME. `doctor` exits 1 on any `[FAIL]` line; a tool with `requiredConfig` and no `test/smoke-config.json` fails the second `doctor` run.

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
