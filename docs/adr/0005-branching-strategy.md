# ADR-0005: Branching Strategy — main + develop, Solo Workflow

**Status:** Superseded by [ADR-0012](0012-trunk-based-on-main.md) (2026-09-25)
**Date:** 2026-02-28
**Deciders:** Michał + Claude
**Tags:** workflow, git, ci

## Context

The project has a CI pipeline (GitHub Actions, ADR-0005 companion) that runs on push/PR. With automation in place, we need a branching convention that:

- Provides a **stable release anchor** (`main`) separate from active development
- Keeps overhead low for a **solo developer** — no bureaucratic PR ceremonies with oneself
- Scales to accept a **first external contributor** without workflow surgery
- Gives CI a clear signal for what to gate (pushes to `main` are never broken)

The project is in MVP/personal-use phase. There is no team, no release manager, no deployment pipeline beyond manual installs.

## Decision

**Two long-lived branches: `main` and `develop`.**

| Branch | Purpose | Who commits |
|--------|---------|-------------|
| `main` | Stable, releasable baseline. Tagged for releases. CI gates all pushes. | Merge from `develop` only |
| `develop` | Active development. Direct commits allowed (solo). CI runs here too. | Direct push by Michał |

**Rules:**

1. Day-to-day work goes directly to `develop` — no feature branches required while solo.
2. `main` is only updated by merging `develop` when a milestone is releasable.
3. CI runs on both branches and on any PR targeting either branch.
4. Version tags (`v0.X.0`) are placed on `main` only.
5. When a first external contributor joins: short-lived feature branches off `develop`, PR into `develop` → review → merge.

## Consequences

### Positive
- ✅ `main` is always a known-good state; easy to point someone at or roll back to
- ✅ Zero overhead for solo work — no self-PRs, no branch cleanup ceremonies
- ✅ CI runs on `develop` catches breakage before it reaches `main`
- ✅ Git Flow vocabulary (main/develop) is familiar to any new contributor
- ✅ Scales gracefully: adding feature branches is additive, not a workflow rewrite

### Negative
- ❌ `develop` can accumulate messy commits — no enforced squash/rebase discipline
- ❌ Merging `develop` → `main` is a manual step (no automation yet)
- ❌ Without PRs, there is no automatic code review record on GitHub for solo work

### Neutral
- ⚪ CI YAML targets both branches — no additional config needed when adopting feature branches

## Alternatives Considered

### Option A: Trunk-based development (single `main` branch)

**Description:** All commits go directly to `main`. Feature flags for incomplete work.

**Pros:**
- Simplest possible workflow
- No merge overhead

**Cons:**
- No stable release anchor — `main` can be broken between commits
- Feature flags are overkill for a solo CLI tool

**Why rejected:** No stable release anchor. When something breaks, `main` is the broken branch. Tags on a broken commit are not useful.

### Option B: Full Git Flow (main, develop, release/*, hotfix/*, feature/*)

**Description:** The canonical Git Flow with all branch types.

**Pros:**
- Extremely explicit process
- Battle-tested for large teams

**Cons:**
- Massive overhead for a solo developer
- Release branches and hotfix branches are meaningless without parallel release tracks
- Self-PRs and branch ceremonies add friction with zero review benefit

**Why rejected:** Engineering overhead proportional to a 10-person team, applied to a 1-person project. Violates the project's "MVP first" philosophy.

## Implementation Notes

- `develop` branch was created alongside this ADR.
- GitHub branch protection on `main`: require CI to pass before merge (configure in Settings → Branches).
- No protection on `develop` — direct push remains allowed for solo work.

## Review Trigger

Revisit when:
- A first external contributor wants to submit a PR
- The project moves to a public release with a user base that expects stability guarantees
- A second long-lived release track is needed (e.g., LTS vs. latest)

## Related Decisions

- **Related to:** ADR-0001 (TypeScript orchestrator — development workflow)
- **Related to:** ADR-0002 (Monorepo workspaces — build order affects CI)
