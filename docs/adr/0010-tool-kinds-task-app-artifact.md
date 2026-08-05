# ADR-0010: Tool Kinds — task, app, artifact

**Status:** Proposed
**Date:** 2026-08-05
**Deciders:** Michał + Claude
**Tags:** architecture, plugin, execution-model, manifest

> **Proposed — not decided.** Open questions are listed at the bottom.
> Resolve them, then flip status to Accepted.

## Context

Tool Protocol v1 (ADR-0003) models exactly one execution shape: write a
JSON `ToolRequest` to stdin, read NDJSON `ToolEvent` lines from stdout,
process exits. `ProcessRunner` enforces that shape with guardrails —
`timeoutMs` defaults to 30s and SIGTERMs, output is capped at 10MB and
10,000 events (`packages/core/src/runner/process-runner.ts`).

The tooling inventory in ADR-0009 does not fit one shape. It fits three:

| Kind | Examples | Fits protocol v1? |
|------|----------|-------------------|
| **task** — one-shot, stdin → NDJSON → exit | `agent-status`, yt-dlp downloader, calendar poller, AZDO review | Yes — this is what exists |
| **app** — long-running, owns a window | teleprompter, agent dashboard, notification center UI | No |
| **artifact** — inert files applied to a target | Stream Deck profiles, MX Master 4 config, IDE configs, Claude skills/hooks | No |

The two mismatches are concrete, not hypothetical:

- **`app`:** an Electron teleprompter emits no `result` event and must not
  die after 30 seconds. Registering it as `runtime: node` means either
  lying in the manifest or weakening the guardrails that make the protocol
  trustworthy for every genuine task.
- **`artifact`:** a Stream Deck profile has no `entry` at all. Faking one
  produces "tools" whose only job is to copy a file. Once a meaningful
  share of manifests are copy-file shims, the protocol stops meaning
  anything.

There is also a second, orthogonal need from ADR-0009: filtering the tool
list by personal vs work on a given machine.

## Decision

**Proposed — pending the open questions below.**

Add three **optional** manifest fields. All are additive and ignored by
older readers, so this is **not a breaking change and does not bump
`manifestVersion`** — `validateManifest()` checks required fields and
ignores unknown ones (`packages/core/src/discovery.ts:139`).

```jsonc
{
  "manifestVersion": 1,
  "id": "teleprompter",
  "kind": "app",                    // "task" (default) | "app" | "artifact"
  "visibility": "shared",           // "work" | "personal" | "shared" (default)
  "requires": { "bin": ["yt-dlp"] } // external binaries checked by `mctl doctor`
}
```

Behaviour per kind:

- **`task`** — today's `ProcessRunner`, entirely unchanged. Default when
  `kind` is absent, so every existing manifest keeps working untouched.
- **`app`** — spawned detached via a new `AppLauncher` alongside (never
  inside) `ProcessRunner`: no NDJSON contract, no timeout, no output caps.
  `mctl run` returns once the process is up. Keeping this out of
  `ProcessRunner` is the point — stretching one runner to cover both
  shapes is how the guardrails get diluted.
- **`artifact`** — never executed. The manifest declares targets, and a new
  `mctl apply` walks them:

  ```jsonc
  {
    "kind": "artifact",
    "targets": [
      { "src": "profiles/", "dest": "~/AppData/Roaming/Elgato/StreamDeck/ProfilesV2", "strategy": "symlink" }
    ]
  }
  ```

`visibility` supports `mctl list --profile work|personal` and a default
profile in config. It is a **UX filter only** — the actual personal/work
separation is the repo boundary in ADR-0009.

`requires.bin` feeds the existing `mctl doctor` command
(`apps/mctl/src/commands/doctor.ts`), converting a class of confusing
mid-run failures ("yt-dlp not found") into one clear preflight message.

## Consequences

### Positive
- ✅ Three narrow, separately testable capabilities instead of one
  overloaded runner
- ✅ Fully backward compatible — zero migration, no `manifestVersion` bump
- ✅ `mctl apply` is the feature that actually delivers one-command machine
  migration; a monorepo without it is just a folder you cloned
- ✅ `ProcessRunner` guardrails stay strict because nothing needs them relaxed
- ✅ Config artifacts (Stream Deck, IDE, mouse) become first-class instead
  of being modelled as fake tools

### Negative
- ❌ Three code paths in `mctl run`/`apply` instead of one
- ❌ `mctl list` output now needs to convey kind, or it misleads
- ❌ `app` processes outlive `mctl`, raising lifecycle questions the CLI
  has never had to answer (is it already running? how is it stopped?)
- ❌ `artifact` writes outside `~/.m-control/` — the first feature to do
  so, and it can overwrite user files

### Neutral
- ⚪ `ToolManifest` in `packages/core/src/types.ts` grows three optional
  fields; `src/index.ts` exports unchanged in shape
- ⚪ Templates in `templates/` stay valid — they are `kind: "task"` by default

## Alternatives Considered

### Option A: Force everything through protocol v1
**Description:** Model apps and artifacts as `task` tools — the app tool
spawns and detaches internally, the artifact tool copies files.

**Pros:**
- No new concepts, no core changes at all
- Everything remains uniformly `mctl run <id>`

**Cons:**
- Requires per-tool timeout exemptions, eroding the guardrails globally
- Manifests stop describing what a tool actually is
- No way to answer "what would `apply` change on this machine?" without
  running arbitrary code

**Why rejected:** It preserves surface uniformity by making the manifest
dishonest, and the cost lands on every genuine task tool.

### Option B: Separate manifest schema per kind
**Description:** `manifest.json` for tasks, `app.json`, `artifact.json`,
each with its own discovery pass.

**Pros:**
- Strictest possible typing per kind
- No optional fields that are meaningless for two of three kinds

**Cons:**
- Triples discovery logic for a mostly-shared field set
- `id`, `version`, `name`, `description`, `visibility` are common to all three
- Three schemas to version instead of one

**Why rejected:** Disproportionate. A discriminated union on one optional
field gets the same safety at a fraction of the cost.

### Option C: Bump to `manifestVersion: 2`
**Description:** Treat kinds as a protocol revision with `kind` required.

**Pros:**
- Forces every manifest to state its kind explicitly
- Clean break, no implicit defaults

**Cons:**
- Breaks every existing manifest and both templates for zero functional gain
- Contradicts `constraints.md` on migration paths
- The additive change is genuinely non-breaking, so the bump is unearned

**Why rejected:** Version bumps should cost something to earn; this one
buys only explicitness.

## Open Questions

Resolve before flipping to Accepted:

1. **Windows symlinks.** `strategy: "symlink"` requires Developer Mode or
   an elevated shell on Windows, which is the primary platform here
   (`scripts/install.ps1`). Default to `copy` on Windows and `symlink`
   elsewhere? Copy loses the edit-in-place-and-commit workflow that makes
   config-as-artifact worth doing at all. **Undecided.**
2. **`mctl apply` safety.** It writes outside `~/.m-control/` for the first
   time. Needs at minimum a `--dry-run`, and probably a backup of anything
   it overwrites. Is that v1 scope or a follow-up?
3. **The Chrome extension is a genuine misfit** — not a task, app, or
   artifact, but a thing installed into a browser profile. Model it as an
   `artifact` pointing at an unpacked-extension dir, or accept it as a
   pointer plus manual install steps? Do *not* invent a fourth kind for a
   single case.
4. **`app` lifecycle.** Does `kind: "app"` need `mctl stop` / `mctl status`,
   or is launch-and-forget sufficient? Launch-and-forget is the smaller
   v1 and can be revisited once two apps exist.
5. **Sequencing.** `kind` + `visibility` + `requires.bin` are cheap and
   unlock ADR-0009 immediately. `AppLauncher` is only needed when the
   teleprompter lands; `mctl apply` when 2–3 real artifacts exist. Ship
   the manifest fields first and defer the runtimes?

## Implementation Notes

Suggested order, smallest useful increment first:

1. Add optional `kind`, `visibility`, `requires` to `ToolManifest`
   (`packages/core/src/types.ts`) and validate them in `validateManifest()`
   — unknown values must fail with an actionable `ManifestError` per
   `.claude/rules/errors.md`, not be silently ignored.
2. `mctl list --profile work|personal` + a default profile in config.
   Filtering happens in the CLI; `discoverTools()` stays kind-agnostic.
3. Extend `mctl doctor` to check `requires.bin` via `PATH` lookup.
4. `AppLauncher` — when the first `app` tool exists.
5. `mctl apply` + `--dry-run` — when the first artifacts exist.

Steps 1–3 are additive, need no new runtime, and are the ones ADR-0009
depends on.

## Related Decisions

- **Related to:** ADR-0009 (repository topology — consumes `visibility`)
- **Extends:** ADR-0003 (NDJSON protocol — `task` kind is unchanged protocol v1)
- **Related to:** ADR-0006 (multi-runtime process runner — `app` sits beside it)
- **Depends on:** ADR-0007 (config-driven discovery)

## References

- `docs/architecture/execution-model.md` — Tool Protocol v1 spec
- `packages/core/src/discovery.ts:139` — `validateManifest()` ignores unknown fields
- `packages/core/src/runner/process-runner.ts:20` — guardrail defaults
- `.claude/rules/tool-protocol.md` — stdout/stdin rules for `task` tools
