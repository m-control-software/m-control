# Prompt: Import an existing Stream Deck setup into m-control

Use this when migrating a hand-built Stream Deck profile (plus its
supporting scripts and icons) into the spec + generator pattern from
ADR-0010.

Run it from the m-control repo root, on the machine that has both the
Stream Deck setup and this checkout.

Replace `<SOURCE_PATH>` before pasting.

---

## The prompt

```
I want to migrate my existing Stream Deck setup into m-control.

Source: <SOURCE_PATH>
It contains the scripts, icons and whatever else builds my current profile.
Some buttons reference scripts that live OUTSIDE that directory.

## Read first, before touching anything

- docs/adr/0010-tool-kinds-task-app-artifact.md — especially "Generated
  artifacts — spec + generator, not a fourth kind". This is the target
  architecture. Note that it is Status: Proposed, so if the import shows
  the design is wrong somewhere, say so instead of forcing my setup into it.
- docs/adr/0009-repository-topology-and-personal-work-split.md — the
  work/personal repo split and what `visibility` means.
- docs/architecture/execution-model.md — the Tool Protocol, if any of my
  scripts should become m-control tools (then use the add-tool procedure).
- AGENTS.md — repo conventions.
- tools/artifacts/stream-deck/docs/spec-format.md — the spec format.

## Work in phases. Do not skip to implementation.

### Phase 1 — Inventory (read-only, change nothing)

Walk the source directory and produce a complete picture:

- What actually builds the profile today, and how
- Every button: what it does, its icon, its action type
- Every icon/asset and where it is used
- Every external reference — resolve it to a real absolute path and say
  what is there. These are the important ones; do not gloss over them.
- Anything that looks like a credential, token, password, API key or
  connection string. Stream Deck plugin settings commonly hide these.
  Report them; do not copy them anywhere.

Show me the inventory before going further.

### Phase 2 — Classify (this is the part I care most about)

For each button and each script, decide three things and justify each:

1. **Visibility.** One of:
   - `shared` — generic dev tooling, useful to anyone
   - `work-client` — specific to the current client: encodes their
     repos, environments, endpoints, internal process
   - `personal` — mine, nothing to do with work

   This matters because ADR-0009 designates the `m-control` repo as the
   shareable one, possibly public one day. Client-specific material must
   not land there.

   Treat "this should not move into any repo I own" as a FIRST-CLASS
   OUTCOME, not a failure of the migration. Whether client work product
   can live in my personal repositories is a contractual question, not an
   architectural one — it may be the client's property, confidential, or
   both. Do not resolve it. Flag it, tell me what specifically looks
   client-owned or client-revealing, and let me decide.

   If you find the ADR's three-way `visibility` split has no correct home
   for client-specific tooling, SAY SO. Note that ADR-0007's multi-root
   discovery means a tools root does NOT have to be a repo I own — see the
   in-place option in Disposition below.

2. **Portability.** What would break on a fresh machine?
   - Hardcoded absolute paths
   - Required installed applications or Stream Deck plugins
   - Client VPN / network / credentials
   - Assumed sibling repos or directory layout

3. **Disposition.** One of:
   - **Stays exactly where it is**, and its directory is registered as a
     tools root in `~/.m-control/config.json`. Nothing is copied, nothing
     changes owner, the client's scripts stay in the client's repo where
     their colleagues can use them, and offboarding is deleting one config
     line. Consider this FIRST for anything client-specific — it is often
     the right answer, not a fallback.
   - Becomes an m-control `task` tool in one of my repos (give it a
     kebab-case id) — good for anything generic that is really "run a thing
     and report a result", since it makes the button `mctl run <id>`
     instead of an absolute path that only exists on this machine. Only
     propose this for material that is clearly mine to move.
   - Stays external, referenced through config rather than a hardcoded path
   - Dropped (dead, superseded, or not worth carrying)

   For each one, say explicitly whose property you think it is and why.

Present this as a table. Do not start writing code yet.

### Phase 3 — Propose

Based on the classification, show me:

- The spec format you propose for my buttons, with 2–3 real examples from
  my actual deck (not invented ones)
- Which scripts become tools, their ids, and which repo/root each lands in
- How external references are addressed so a fresh machine works
- What `mctl doctor` should preflight (external binaries, required Stream
  Deck plugins, etc.)
- Anything about ADR-0010 the real data contradicts

Stop here and wait for my approval.

### Phase 4 — Implement (only after I approve)

Build it per the approved plan, following the conventions and code rules
in AGENTS.md.

## Constraints

- Do not copy secrets into the repo. If a script needs one, it reads from
  config (`tools['stream-deck'].<key>`), per the open config schema.
- Do not vacuum the whole source directory into m-control. Classify first;
  some of it should not come along, and some of it should not move at all.
- Never propose moving client-owned material into my personal repositories
  as a default. "Leave it where it is and register the directory as a tools
  root" is a legitimate and often better answer.
- Do not invent Stream Deck schema details. Read the real files. If
  something is ambiguous, say so rather than guessing.
- Ask me before anything destructive to the existing setup. It currently
  works and I need it to keep working.
- The restore path must stay deterministic and offline — no AI required to
  regenerate a profile on a new machine (see ADR-0010 for why).
```

---

## Notes

**Why phased.** The classification in Phase 2 is the decision that matters;
implementation is mechanical once it is right. A single-shot "migrate my
Stream Deck setup" prompt tends to produce a plausible importer that
quietly drops the external references and copies client-specific scripts
into a repo intended to be shareable.

**Why it may push back on the ADRs.** ADR-0009 and ADR-0010 are both
`Proposed` and were written before anyone looked at a real profile. A
migration that discovers the design is wrong is a useful result — record it
in the ADR's open questions rather than bending the data to fit.

**Why "don't move it" is offered first.** m-control's value is
orchestration, not storage. `paths.toolsRoots` is a list of absolute paths
and nothing requires a root to be a repo you own, so a client's script
directory can be a tools root in place. That keeps the ownership question
from arising at all, keeps the client's tooling in the client's repo, and
makes offboarding a deletion rather than an audit. A migration prompt that
only asks "which of my repos does this go in?" quietly presumes an answer
to a question that is contractual, not architectural.
