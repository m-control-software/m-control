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

- Node.js 20+ (22 recommended, `.nvmrc`)
- Yarn 1.22 (pinned by `packageManager`)
- Git
- Python 3.10+ (for Python tools and their tests)
- Optional, for the full `yarn verify`: PowerShell 7 (`pwsh`); then
  `yarn setup:linters` installs ruff and PSScriptAnalyzer at the pinned versions

### Setup

```bash
git clone <repo>
cd m-control
yarn install
yarn build
```

### Development workflow

The commands, and what `yarn verify` runs, are in `AGENTS.md` → "Commands".
`yarn verify` passing is the bar before anything reaches `main`.

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

`yarn new:tool --id=<id> --category=<category> --runtime=<node|python> --description="…"`,
then follow `AGENTS.md` → "Adding a tool" (the `add-tool` skill runs it with a
design gate).

## Architecture decisions

### When to create an ADR

Create an Architecture Decision Record when:
- Choosing technology or framework
- Defining architecture patterns
- Making trade-offs with long-term impact
- Changing existing architectural decisions

### How to create an ADR

`yarn new:adr --title="…"` takes the next number and fills the header; the
`write-adr` skill covers the content and superseding.

## Code style

Enforced by `yarn verify` (ESLint + Prettier, TypeScript strict, ruff,
PSScriptAnalyzer); `yarn format` fixes formatting. Rules: `AGENTS.md` →
"Code rules" and `docs/architecture/constraints.md`; style beyond the rules:
`docs/ai/CODING-GUIDELINES.md`; what reviewers look for: `REVIEW.md`.

## Documentation

Which doc to update for which change: `AGENTS.md` → "Decisions and docs".
How docs are kept honest: `docs/README.md`. When you learn something the hard
way, add it to `LESSONS-LEARNED.md` — and if it can be checked, add the check.

## Release process

```bash
yarn release --version=X.Y.Z --dry-run
yarn release --version=X.Y.Z        # changelog, versions, verify, commit, tag
git push origin main vX.Y.Z
```

The `release` skill covers choosing the version. The script refuses to run off
`main`, on a dirty tree, or with an empty `[Unreleased]`.

## Troubleshooting

- **Stale build:** `yarn clean && yarn build`.
- **Type errors in one package:** `yarn workspace @m-control/core typecheck`.
- **Formatting:** `yarn format`.
- **A verify step failed:** fix it, then `yarn verify --from=<step>`.

## Working with AI assistants

Agents that read `AGENTS.md` (Codex, Cursor, Copilot) or `CLAUDE.md` (Claude
Code, which imports it) pick up the rules and the procedures automatically.
For anything else: "Read AGENTS.md first, then docs/ai/PROJECT-CONTEXT.md."
When an agent gets something wrong, prefer a test or lint that catches it next
time over a new paragraph of instructions.
