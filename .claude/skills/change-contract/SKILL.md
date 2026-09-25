---
name: change-contract
description: Change one of m-control's contracts — the tool manifest (ToolManifest, manifest.json fields), Tool Protocol v1 (ToolRequest, ToolEvent, exit codes), the config file (MControlConfig, ~/.m-control/config.json), discovery rules, or the mctl CLI surface (commands, flags, output). Use when a task adds, removes, renames or re-interprets a field, event, exit code, config key, command or flag in packages/core or apps/mctl (e.g. "add a `kind` field to the manifest", "let tools emit progress events", "add `mctl validate`", "support env vars in config"). Not for adding a tool that merely uses the contracts (use add-tool).
---

# Change a contract

A contract change touches several files that must agree, and every tool —
including tools in other roots this repo never sees — depends on it. The
rules are in `AGENTS.md` ("Contracts", "Decisions and docs") and
`docs/architecture/constraints.md` §2.

## 1. Classify — then stop for approval

Answer these and present them to the user **before editing anything**:

- **What changes, exactly?** Field/event/key/command, old → new behaviour.
- **Additive or breaking?** Additive = an optional field, a new event type
  consumers may ignore, a new command. Breaking = anything an existing
  manifest, config, tool or script would now fail on or read differently.
  Breaking needs a new `manifestVersion` / `configVersion` **and** a migration
  path (what users run, what mctl does with the old version).
- **Who is affected?** Every tool in `tools/`, both templates, tools in
  other roots (ADR-0007: client repos in place), existing user configs.
- **Does it need an ADR?** Yes if it is hard to reverse, changes the protocol,
  or trades something off. Check first whether a Proposed ADR (0009, 0010)
  already covers it — read its Open Questions. Use the `write-adr` skill.
- **Tool-specific?** Core never gains a tool-specific type or key (open config
  schema). If only one tool needs it, it belongs in that tool.

## 2. Change, in this order

1. `packages/core/src/types.ts` — the source of truth. Doc comments say what
   the field means and its default.
2. Validation — `validateManifest` in `packages/core/src/discovery.ts`, or
   `packages/core/src/config.ts`. Errors are `ManifestError` / `ConfigError`
   with the file path and the fix in the message.
3. Manifest changes: `packages/core/schemas/manifest.v1.schema.json` and the
   parity cases in `test/manifest-schema.test.ts` (add a valid and an invalid
   case for the new rule — the test fails if schema and core disagree).
4. Behaviour — runner, discovery, config merge, or `apps/mctl/src/commands/*`.
   Export anything new through `packages/core/src/index.ts`.
5. Tests next to the change (`packages/core/test/`), including the error path.
6. Templates (`templates/*`) and `test-support/` if tools must now do
   something differently; then every tool in `tools/`.
7. `mctl doctor`, if the change adds something a user can misconfigure.

## 3. Documentation — all of it, in the same change

- `AGENTS.md` → "Contracts" (and "Adding a tool" if tool authors are affected)
- `docs/architecture/execution-model.md` for anything in the protocol or run flow
- `docs/architecture/constraints.md` if a hard rule changes
- `CHANGELOG.md` `[Unreleased]`: under Added/Changed, and for a breaking
  change a **Migration** note saying exactly what users do
- `QUICKSTART.md` if first-run steps change

Other docs link to these; don't restate the rule elsewhere.

## 4. Verify and report

`yarn verify`, and report its summary line. For a CLI change, also run the
changed command from the built bundle and show the output. State whether the
change was additive or breaking and, if breaking, the migration.
