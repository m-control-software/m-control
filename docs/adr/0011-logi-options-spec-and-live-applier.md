# ADR-0011: Logi Options+ Profiles — Spec Packs Applied to a Live Agent

**Status:** Accepted
**Date:** 2026-09-24
**Deciders:** Michał + Claude
**Tags:** tools, devices, generated-artifacts, safety

## Context

ADR-0010 predicted the MX Master 4 configuration would follow the Stream Deck
"spec + generator" pattern. A reverse-engineering proof of concept (2026-09-24,
findings in `tools/artifacts/logi-options/docs/internals.md`) established how
Logi Options+ actually stores it:

- **Store.** Everything lives in one JSON document in one SQLite row
  (`%LOCALAPPDATA%\LogiOptionsPlus\settings.db`). It isn't encrypted, signed,
  or checksummed, and it re-serializes byte-for-byte.
- **Profiles.** Each is a self-contained record. The Global profile and
  built-in apps have Logitech-constant ids, and slots are keyed by device model
  plus HID++ control id. Only custom apps get random ids.
- **Owner.** A running process, `logioptionsplus_agent.exe`, holds the document
  in memory and rewrites all of it on every save. Unlike a Stream Deck profile
  directory, the target is **live state owned by another process**. A write
  only sticks if the agent is stopped first and restarted afterwards.
- **Card format.** The UI's card format can be reproduced exactly from
  Logitech's installed catalogs. The compiler was verified byte-identical to
  UI-written cards, and on the device.

Classification from the POC: **feasible with transformations**. Custom apps need
an id and a path resolved per machine, and applying needs an agent restart.

Constraints from this repo that shaped the design:

- **Runner timeout.** `mctl run` hard-codes `timeoutMs: 30_000`, and on Windows
  the runner's kill is `TerminateProcess`, so no cleanup runs. A kill between
  "stop agent" and "start agent" would leave the mouse on default buttons until
  the next login.
- **Config delivery.** Config reaches a tool only through `requiredConfig`.
- **Personal specs** must not enter this repo (ADR-0009).

## Decision

A `task` tool **`logi-options`** (`tools/artifacts/logi-options/`, `runtime: python`)
that compiles declarative packs and applies them to the live store.

1. **Specs are packs.** `*.logi.json` files with `specVersion`, `pack`,
   `device`, and `profiles[]`, mirroring stream-deck's `*.deck.json`.
   - **Discovery:** the tool's own `specs/` folder (empty by design) plus
     `tools.logi-options.packDirs`, where a pack dir may be a root holding
     several packs. Personal packs live in `C:\MikeM\m-control-personal`.
   - **Merge:** per button; the same button set by two packs is a hard error.
2. **The user-facing format names buttons and actions only:** `shortcut`,
   `preset` (catalog alias), `card`, `nothing`, `raw`, and `gestures`. Card bodies
   are rebuilt from the *installed* Options+ catalogs at apply time, so specs
   survive catalog changes. Nothing from Logitech's catalogs is committed.
3. **Apply is one guarded transaction:**
   - preview, then a consistent backup;
   - force-stop the agent, re-read, patch the targeted records, write, and
     restart the agent (in `finally`);
   - wait for the agent's own re-save;
   - decompile what it kept and compare with the specs;
   - roll back automatically on mismatch.
4. **The decompiler is the verifier and the drift check.** Two cards are equal
   when they decompile to the same portable action, which ignores UI metadata
   that varies by version. `check=true` is therefore a spec-vs-live drift
   report. ADR-0010 listed that as "a possible later addition"; here it costs
   nothing.
5. **Budget inside the 30 s runner timeout, with no core change.**
   - The tool keeps a 26 s deadline and never stops the agent with less than
     12 s left.
   - The stop → write → start window lasts seconds.
   - A kill during the wait-for-re-save phase is harmless.
6. **Custom-app ids are deterministic:** `uuid5(namespace, lower(exe name))`,
   pinned by a test. Existing apps are matched by executable file name, and
   paths are resolved per machine.
7. **One-way sync, spec → device.** A UI change is drift until it's adopted
   with `mode=export`.
8. **Knowledge for future authors** lives with the tool (`docs/spec-format.md`,
   `docs/internals.md`, `docs/maintenance.md`), plus a project skill
   `.claude/skills/author-logi-profile/` that points at those docs.

## Consequences

### Positive
- ✅ MX Master 4 profiles become reviewable text that travels between machines;
  a new machine is `mctl run logi-options`
- ✅ An AI agent authors specs in a small, validated vocabulary and never sees
  Logitech internals. Physically impossible requests (a thumb button that is
  both a shortcut and the gesture button) are rejected, not half-applied
- ✅ Surgical, idempotent, backed up, verified, and rolled back. Unlisted
  buttons, other profiles, and device settings stay byte-identical
- ✅ Refuses rather than corrupts when Options+ changes its storage (row
  layout and byte-exact round-trip guards on every read)

### Negative
- ❌ Depends on undocumented internals of an auto-updating app. Verified on one
  Options+ build (853130). Every update needs `test_model.py` re-run, and
  re-deriving (`docs/maintenance.md`) when it fails
- ❌ Applying restarts the agent: the mouse is on default buttons for a few seconds
- ❌ First tool with a device-visible side effect and a hard dependency on the
  runner's timeout value
- ❌ Windows only; needs Python on PATH (checked by `mctl doctor`)

### Neutral
- ⚪ Python rather than PowerShell like stream-deck. Windows PowerShell 5.1 has
  no SQLite; Python's standard library has `sqlite3` with the backup API
- ⚪ Specs are JSON, not the POC's YAML: the stdlib-only rule for Python tools,
  and consistency with `*.deck.json`

## Alternatives Considered

### Drive the agent's IPC pipe (`\\.\pipe\logitech_kiros_agent-*`)
**Pros:** live apply, no restart. **Cons:** undocumented protocol to
reverse-engineer. It's a moving target that's far more fragile than the file
store, and it isn't needed for correctness. **Rejected** for v1. Revisit only
if the restart becomes a real problem.

### Sync `settings.db` between machines (OneDrive/Syncthing)
**Cons:** one document rewritten in full by each machine's agent means lost
updates. It also carries machine-specific state: host names, serials, USB
paths, command lines. **Rejected.** Sync the spec files instead.

### Replace the whole document from a stored copy
**Pros:** trivial. **Cons:** not portable (device and app state of the source
machine) and not surgical. **Rejected.** Only backups/restore do this, on the
same machine.

### Write while the agent runs
**Rejected on principle.** The agent overwrites the document on its next save,
and testing it risks live state.

### Store raw Logitech cards as the spec
**Pros:** no compiler. **Cons:** ties specs to one Options+ version's metadata
and exposes internals to authors. **Rejected.** `raw` remains an escape hatch
that export falls back to.

## Open Questions

1. **Per-tool runner timeout.** An optional manifest `timeoutMs` (additive, in
   the spirit of ADR-0010's optional fields) would remove the budget arithmetic.
   Not needed while applies take ~15 s.
2. **Second machine.** Portability is argued from the data. Run `check=true`
   on the first real cross-machine apply, and record the result in `docs/internals.md`.
3. **Device settings** (pointer speed, SmartShift, haptics). They live only in
   the Global profile. Supporting them means extending the spec format; the
   research method in `docs/maintenance.md` applies.
4. **macOS.** Options+ ships `_osx` catalogs. The store location and agent
   control would differ.

## Related Decisions

- **Refines:** ADR-0010 (generated artifacts): the generator here must also *apply*, to a live process
- **Related to:** ADR-0009 (personal packs live outside this repo)
- **Uses:** ADR-0003 (Tool Protocol v1), ADR-0006 (python runtime), ADR-0007 (config-driven discovery)

## References

- `tools/artifacts/logi-options/docs/internals.md` — storage, model, evidence (experiments E0–E6)
- `tools/artifacts/logi-options/docs/spec-format.md` — the authoring reference
- `tools/artifacts/logi-options/lib/transaction.py` — the budgeted transaction
- `apps/mctl/src/commands/run.ts` — hard-coded runner timeout
