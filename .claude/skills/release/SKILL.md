---
name: release
description: Cut an m-control release — move CHANGELOG [Unreleased] to a version, bump package versions, run verify, commit and tag vX.Y.Z on main (ADR-0012: a known-good state is a tag). Use when the user asks to release, cut or tag a version, publish a known-good state, or "make this the version I install on my other machine". Not for pushing arbitrary branches.
---

# Release

Mechanics live in `scripts/release.mjs`; this skill decides the version and
guards the outward-facing step.

## 1. Preconditions

- On `main`, working tree clean, up to date with `origin/main`
  (`git fetch origin main` and compare). The script refuses otherwise.
- `main` is green in CI — ask the user if you can't see CI.

## 2. Choose the version — confirm with the user

Read `CHANGELOG.md` `[Unreleased]` and propose a version from the last one
(`## [X.Y.Z]`), per semver while below 1.0:

- a breaking change to a contract (manifest/config version bump, removed
  command or field) → minor bump (0.**X**.0) and call it out;
- new tools, commands or optional fields → minor bump;
- fixes and docs only → patch bump.

Show the user the proposed version and the entries it will carry. Proceed
only when they agree.

## 3. Cut it

```bash
yarn release --version=X.Y.Z --dry-run
yarn release --version=X.Y.Z
```

It moves `[Unreleased]` (a `### Planned` list stays unreleased), bumps
`package.json` in the root and every workspace, runs `yarn verify`, commits
`chore: release vX.Y.Z` and creates an annotated tag. It does **not** push.
Never pass `--skip-verify`: it exists for the script's own tests.

If verify fails, nothing is committed: fix the cause on a normal branch,
discard the release edits (`git checkout -- .`), and start over.

## 4. Push — ask first

Pushing a tag publishes the known-good state. Ask the user, then:

```bash
git push origin main vX.Y.Z
```

To install on another machine: check out the tag, run
`scripts/install.ps1` (Windows) or `scripts/install.sh`.
