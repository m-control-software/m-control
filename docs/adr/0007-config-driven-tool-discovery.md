# ADR-0007: Config-Driven Tools Roots and Open Config Schema

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** Michał + Claude
**Tags:** config, discovery, distribution

## Context

Two structural problems surfaced while preparing the repo to host many tools:

1. **Installed mctl couldn't find tools.** `findToolsRoot()` resolved
   `tools/` relative to `__dirname`, which only works inside a repo
   checkout. The globally installed bundle (`~/.m-control/mctl.js`, per
   ADR-0004) discovered nothing.
2. **Closed config schema.** `MControlConfig.tools` hardcoded `azdo`/`k8s`/
   `obsidian` interfaces in `@m-control/core` — every new tool would require
   a core type change, coupling the engine to individual tools.

## Decision

**Tools roots come from configuration, resolved in priority order:**

1. `M_CONTROL_TOOLS_ROOT` env var (multiple paths, `path.delimiter`-joined)
2. `paths.toolsRoots` in `~/.m-control/config.json` (array — multiple roots
   supported; duplicate tool ids are reported and the first root wins)
3. Repo-relative `tools/` fallback (only exists when running from a checkout)

The installers register the checkout's `tools/` directory in
`paths.toolsRoots`, so the installed CLI and the repo share one tool set and
`git pull` immediately surfaces new tools.

**The config `tools` section becomes an open schema:**
`Record<string, ToolConfigSection>`. Core never knows individual tools'
config shapes; `manifest.requiredConfig` dot-paths are resolved against the
`tools` section and passed to the tool as a flat map.

## Consequences

### Positive
- ✅ Globally installed mctl works from any directory
- ✅ Adding a tool never touches `@m-control/core` — manifest + entry file only
- ✅ Multiple tools roots: private/experimental tools can live outside this repo
- ✅ Env var override enables CI and ad-hoc testing

### Negative
- ❌ Config carries machine-specific absolute paths (expected for a per-machine file)
- ❌ Tool config sections are no longer compile-time typed; tools must validate their own config (they already had to — they receive JSON over stdin)

### Neutral
- ⚪ `configVersion` stays at 1 — the open schema is a superset of every valid v1 config

## Alternatives Considered

### Option A: Copy tools/ into ~/.m-control at install time
**Why rejected:** Tools would go stale between installs; two sources of
truth. Pointing at the checkout keeps `git pull` as the update mechanism.

### Option B: Keep typed per-tool config in core
**Why rejected:** Guarantees core churn for every tool and merge conflicts
once tools multiply — the exact coupling this refactor removes.

## Related Decisions

- **Fixes gap in:** ADR-0004 (CLI distribution — bundle install)
- **Related to:** ADR-0006 (config `runtimes` overrides)
