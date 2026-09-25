# ADR-0012: Trunk-Based Development on `main`

**Status:** Accepted
**Date:** 2026-09-25
**Deciders:** Michał + Claude
**Tags:** workflow, git, ci

## Context

ADR-0005 set up two long-lived branches: `develop` for day-to-day work and
`main` as the stable baseline, updated from `develop` at milestones. It was
not followed for long:

- `develop` received its last commit on 2026-03-03. Everything since then
  (monorepo refinement, multi-runtime runner, agent-status, stream-deck,
  logi-options, the docs overhaul) went to `main`, usually via short-lived
  agent branches (`claude/*`) merged directly.
- By September `develop` was 33+ commits behind `main` and held three commits
  (`mctl work start/stop`, a manual-testing guide, a banner image) built on
  the pre-refactor codebase, which can no longer be merged as they are.
- Coding-agent sessions branch from, and are told to target, the repository's
  default branch. A second long-lived branch only works if the default branch,
  every agent prompt, and the habit of promoting `develop` → `main` all stay
  in step. For a solo repository the promotion step is the one that slips.
- Rewriting history (as when a client name was scrubbed from `main` in
  September 2026) has to be repeated on every long-lived branch.

What ADR-0005 wanted from `develop` is still needed: a **known-good state**.
It matters more now than in February, because `stream-deck` and
`logi-options` change live device configuration and every machine installs
from a checkout.

## Decision

**`main` is the only long-lived branch.**

1. Work happens on short-lived branches (agent-created `claude/<topic>` or
   your own) and is merged, or fast-forwarded, into `main`. Small changes may
   be committed to `main` directly.
2. Before anything reaches `main`, the CI steps pass locally (`AGENTS.md` →
   Commands). CI runs on every push and PR to `main`.
3. **Known-good = a tag.** A release (`CONTRIBUTING.md` → Release process)
   moves `[Unreleased]` in `CHANGELOG.md` to a version, bumps versions, and
   tags `vX.Y.Z` on `main`. To install something proven on another machine,
   check out the latest tag before running the installer.
4. A red `main` is fixed first, before new work lands.
5. `develop` is retired. It is not merged. Anything worth keeping from it is
   re-implemented on `main` (the `work` command needs its own ADR: it adds a
   top-level config section to core).

## Consequences

### Positive
- ✅ One branch to keep green, one default for agent sessions, no promotion step
- ✅ Docs, prompts and CI describe the workflow that actually happens
- ✅ History rewrites and hotfixes touch one branch
- ✅ Tags make "known-good" explicit and version-numbered, instead of implicit in a branch tip

### Negative
- ❌ `main`'s tip can be broken between a push and CI finishing; the local
  pre-push checks are the guard, and the tag, not the tip, is the stable anchor
- ❌ Stability depends on actually cutting releases; with no tags, there is no
  known-good point
- ❌ No review gate on direct pushes (same as ADR-0005 for solo work)

### Neutral
- ⚪ CI triggers drop `develop`
- ⚪ If a second contributor joins, PRs into `main` are the review point; no
  workflow change beyond branch protection, which on a private repo needs a
  paid GitHub plan (see ADR-0009)

## Alternatives Considered

### Option A: Revive `develop` (ADR-0005 as written)
**Description:** Recreate `develop` from `main`, make it the GitHub default
branch, promote to `main` at milestones.

**Pros:**
- `main`'s tip is always a promoted, dogfooded state
- Agent work lands one step away from what other machines install

**Cons:**
- Already tried; drifted within a week
- Needs the default branch, all docs and prompts, and the promotion habit to stay aligned
- Doubles history rewrites and fixes

**Why rejected:** Tags give the same known-good anchor with one branch and no
promotion step.

### Option B: PR-only `main` with branch protection
**Description:** Every change goes through a PR; merge requires green CI.

**Pros:**
- `main` can never be red

**Cons:**
- Self-PRs for every change add ceremony with no review benefit while solo

**Why rejected (for now):** Not worth it solo, and required status checks
aren't available on a private repo in a free organization (ADR-0009). Revisit
when a second contributor joins.

## Implementation Notes

- `.github/workflows/ci.yml` triggers on `main` only.
- `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/ai/PROJECT-CONTEXT.md`
  describe this workflow.
- The `develop` branch still exists on the remote with its three unmerged
  commits. Deleting it is a separate, deliberate step (tag it first, e.g.
  `archive/develop-2026-03`, if the commits should stay reachable).

## Related Decisions

- **Supersedes:** ADR-0005 (Branching strategy — main + develop)
- **Related to:** ADR-0004 (CLI distribution — installs from a checkout)
