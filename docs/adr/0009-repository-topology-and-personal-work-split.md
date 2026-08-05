# ADR-0009: Repository Topology — GitHub Org and Multiple Tool Roots

**Status:** Proposed
**Date:** 2026-08-05
**Deciders:** Michał + Claude
**Tags:** architecture, distribution, repo-structure, security

> **Proposed — not decided.** Open questions are listed at the bottom.
> Resolve them, then flip status to Accepted and record the answers in
> the Decision section.

## Context

m-control was scoped as a developer-productivity orchestrator. The actual
intent is broader: a single personal "control center" holding both
personal and work tooling, transferable to a new machine in one step.
The recurring pain is migration — every client or employer change means
manually reassembling a toolset scattered across a dozen places.

Concrete inventory driving this (existing + planned):

| Tool | Shape |
|------|-------|
| `agent-status` (already in `tools/agents/`) | one-shot process |
| yt-dlp / YT-Music downloader + Chrome extension | one-shot + browser artifact |
| Notification center (Google Calendar API) | one-shot poller + desktop UI |
| Teleprompter (Electron) | long-running GUI app |
| AI agent status & cost dashboard (Electron) | long-running GUI app |
| Claude/Cursor skills, hooks, MCP wiring | inert files applied to a target |
| Stream Deck profiles, MX Master 4 config, IDE configs | inert files applied to a target |

Forces at play:

1. **The "one bucket violates SRP" objection is misapplied.** SRP governs
   modules, not repos. A repo is a *distribution and lifecycle* boundary.
   The useful test is: shared release cadence (yes), shared runtime host
   (yes, `mctl`), shared audience (no — personal vs work), shared
   secret/permission boundary (no). Two yes, two no maps to one engine
   with N tool roots — not one bucket, and not twelve unrelated repos.
2. **The split must survive sharing.** The stated requirement is to hand
   someone the work toolset with the personal half removed. Runtime
   filtering cannot deliver that: the files and the git history still
   ship. Sharing is a distribution-time problem, and the only boundary
   git respects is the repository.
3. **`docs/VISION.md` targets a SaaS product.** Personal tools committed
   to this repo's history make the engine un-shippable without rewriting
   history first.
4. **The cost curve is asymmetric.** Splitting now is a directory
   decision. Splitting in a year is `git filter-repo` surgery across two
   years of commits.
5. **ADR-0007 already built the mechanism.** `paths.toolsRoots` is an
   array, `discoverTools()` scans multiple roots with first-root-wins on
   id collisions, and precedence is `M_CONTROL_TOOLS_ROOT` >
   `paths.toolsRoots` > repo fallback. Personal tooling does not need to
   live *in* this repo to be *in* the control center.

## Decision

**Proposed — pending the open questions below.**

Use a **GitHub Free organization** as the umbrella so every repo lives in
one namespace, with this layout:

```
<org>/
├── m-control              engine + shared/work tools  ← the shareable one
├── m-control-personal     (private) second tools root
├── teleprompter           (private) Electron app, ships GitHub Releases
├── agent-dashboard        (private) Electron app, ships GitHub Releases
└── notification-center    (private) Electron app, ships GitHub Releases
```

Three rules follow from it:

1. **The personal/work split is a repo boundary**, assembled at runtime
   via `paths.toolsRoots`. Manifest-level `visibility` (ADR-0010) is a
   UX filter layered on top — it is *not* the sharing mechanism.
2. **Heavyweight apps live in their own repos and ship Releases.** Their
   manifests live in a tools root and point at a release asset. Electron
   build output is never vendored into a tools repo — that would add
   hundreds of MB to every clone and defeat the "transfer to a new
   machine easily" goal that motivates all of this.
3. **`m-control` stays free of anything personal, from the first commit
   onward** — so it can be shared, or open-sourced, with nothing to strip.

## Consequences

### Positive
- ✅ Sharing the work toolset becomes "here's the repo" — no filtering,
  no history laundering, no risk of leaking a personal tool
- ✅ Engine stays shippable for the SaaS path in `docs/VISION.md`
- ✅ Requires no change to `@m-control/core` — ADR-0007 already supports it
- ✅ Personal and work repos get independent access grants
- ✅ Clean handoff if the org ever becomes a business entity

### Negative
- ❌ Multiple repos to clone and keep in sync on a new machine — makes a
  `mctl sync`/bootstrap step necessary rather than optional
- ❌ Cross-repo CI needs a PAT or GitHub App token; Actions' default
  `GITHUB_TOKEN` is scoped to a single repo
- ❌ Changes spanning engine + personal tool need two commits in two repos
- ❌ Free org does not enforce rulesets/branch protection on private repos

### Neutral
- ⚪ Repo transfer preserves history, issues, PRs and leaves URL redirects
- ⚪ Solo today, so per-user pricing is effectively a flat $4/month if
  Team is ever needed
- ⚪ `tools/` in this repo remains the work/shared root — no move required

## Alternatives Considered

### Option A: One repo, runtime filtering only
**Description:** Everything in `m-control`, separated by `visibility` in
the manifest and a profile setting.

**Pros:**
- Simplest possible clone story — one repo, one command
- No cross-repo CI tokens, no sync step

**Cons:**
- Does not satisfy the sharing requirement at all — files and history ship regardless
- Blocks open-sourcing or shipping the engine
- Secrets and personal data accumulate in a history that cannot be un-shipped

**Why rejected:** It solves the convenience half of the problem and none
of the sharing half, which is the half with the asymmetric cost curve.

### Option B: Separate repos, no organization
**Description:** Keep repos under the personal account with a naming
convention (`m-control`, `m-control-personal`, …).

**Pros:**
- Zero setup; works today
- Same isolation properties as the org layout

**Cons:**
- No shared namespace or single landing page
- Access grants are per-repo on a personal account — clumsier to give a
  colleague the work repo only
- Awkward to hand off if this becomes a product

**Why rejected:** The org is free and removes these frictions. Keeping
this as the fallback if org setup proves annoying — the *repo split* is
the load-bearing decision, the org is packaging.

### Option C: Monorepo now, `git filter-repo` when sharing is needed
**Description:** Defer the split; extract the work subset if the day comes.

**Pros:**
- Fastest path today
- Avoids the split if sharing never actually happens

**Cons:**
- History rewrite across years of commits, with high odds of leaking
  something on the first attempt
- Secrets committed before the split stay in the extracted history unless
  every one is found
- Blocks the SaaS path until performed

**Why rejected:** This is precisely the asymmetric cost the split exists
to avoid.

## Open Questions

Resolve before flipping to Accepted:

1. **Secrets handling.** A private repo is an access-control boundary, not
   a secrets boundary: every collaborator gets full history, rotation does
   not erase the old value from `git log`, and it contradicts
   `docs/architecture/constraints.md` ("NEVER commit secrets to git").
   Options: (a) **SOPS + age** — encrypts JSON *values*, keeps structure
   diffable, one age key carried per machine; (b) plaintext in a private
   repo, accepting the above; (c) no secrets repo — `~/.m-control/config.json`
   stays manual per machine. Preference: (a). **Undecided.**
2. **Org name.** `m-control` collides with the repo name (`m-control/m-control`).
   Acceptable, or pick something distinct?
3. **Is `m-control` public or private at the start?** Public unlocks free
   rulesets; private defers the open-source decision.
4. **Transfer timing.** Move `michalmig/m-control` into the org now, or
   after the personal split is done? Check whether the personal account is
   on Pro first — moving a private repo into a *Free* org can lose
   Pro-only private-repo features (wikis, Pages, the larger Actions allowance).
5. **How are sibling roots assembled?** Git submodule inside `m-control`,
   vs. independent clones + a `mctl sync` command reading `paths.toolsRoots`.
   Preference: independent clones — submodules couple the repos back
   together, which is what this ADR is trying to avoid.

## Implementation Notes

Verified plan facts (2026-08-05):

- **GitHub Free for organizations:** unlimited public and private repos,
  unlimited collaborators, 2,000 Actions minutes/month for private repos,
  500MB Packages storage.
- **Rulesets and branch protection are not enforced on private repos on a
  Free org** — public repos only until GitHub Team ($4/user/month). Team
  also adds multiple PR reviewers, CODEOWNERS, draft PRs, Pages and wikis
  on private repos, 3,000 Actions minutes, 2GB Packages.
- **This costs nothing today.** Per ADR-0005 the workflow is direct commits
  to `develop` while solo, no self-PRs — CI runs on both branches but
  nothing depends on *required* status checks or required reviewers. That
  changes the day someone else is onboarded onto the work toolset.
- **Actions minutes are the thing to watch**, not repo count: Electron
  build matrices burn the 2,000-minute allowance fast (Windows runners
  bill at 2x, macOS at 10x). Another reason app builds belong in their own
  repos with their own budgets.
- **CI must be path-filtered** before the third heterogeneous tool lands.
  One workflow running `typecheck`/`lint`/`build` across TypeScript, Python
  tools, an Electron app, and a browser extension gets slow and noisy.

Migration path is additive — no code change is required for the split
itself. Adding a personal root is a one-line edit to `paths.toolsRoots`.

## Related Decisions

- **Depends on:** ADR-0007 (config-driven tools roots — supplies the multi-root mechanism)
- **Related to:** ADR-0010 (tool kinds and `visibility` filtering)
- **Related to:** ADR-0005 (branching strategy — why Free-plan rulesets don't bite yet)
- **Related to:** ADR-0004 (CLI distribution strategy)

## References

- [GitHub Pricing](https://github.com/pricing)
- [About rulesets — GitHub Docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
- [Rulesets not enforced on Free private repos (community discussion)](https://github.com/orgs/community/discussions/184363)
- [Private repositories with unlimited collaborators (changelog)](https://github.blog/changelog/2020-04-14-private-repositories-with-unlimited-collaborators-available-to-all-github-accounts-and-changes-to-github-paid-plans/)
- [GitHub's plans — GitHub Docs](https://docs.github.com/get-started/learning-about-github/githubs-products)
- `docs/architecture/constraints.md` — "NEVER commit secrets to git"
