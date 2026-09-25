# Review guide

What to look for when reviewing a change to m-control — for human reviewers
and review bots alike. Everything mechanical (types, lint, formatting,
PowerShell 5.1 syntax, protocol conformance, manifest validity, docs links,
tool layout) is already enforced by `yarn verify`, which CI runs; don't spend
review on it. Flag these instead:

## Contracts

- A change to `ToolManifest`, `MControlConfig`, Tool Protocol v1 or the CLI
  surface that is breaking but has no `manifestVersion`/`configVersion` bump
  and migration note (`AGENTS.md` → "Contracts").
- A contract change without the matching update to `AGENTS.md`,
  `docs/architecture/execution-model.md` and `CHANGELOG.md`.
- A tool-specific type or key added to core (config is an open schema).
- A tool reading a config key its manifest doesn't declare — it is always
  `undefined` at run time.

## Tools

- Anything that changes live state (files outside the tool's output, device
  configuration, remote systems) without a dry run (`check=true`), a backup,
  verification after writing, and a declared budget it fits
  (`docs/architecture/constraints.md` §4).
- An `error` with the wrong `recoverable`: `true` means the user can fix it
  (config, input, credentials, network), `false` means a bug.
- A new error `code` for something an existing code already names; codes are
  stable and scripts match on them.
- Options read from argv (`--flag`) instead of `input` (`key=value`), or a
  string flag read as truthy (`"false"`).
- Secrets in `input`, `log` events, results or error messages.

## Core and CLI

- `console.*`, `process.exit` or `process.argv` in `packages/core`.
- A raw `Error`, an empty `catch`, or an error message that doesn't say what
  to do next.
- A hard-coded path, or anything that works on Linux only (Windows is the
  primary platform).
- Synchronous I/O on large or unbounded data (small startup reads of config
  and manifests are fine).
- `any` without a comment saying why.

## Data and docs

- Personal or client material (names, packs, paths, profile exports, palette
  or page names) committed to the repo; it belongs in config-pointed
  directories (ADR-0009).
- A rule restated in a second doc instead of linked: restated rules go stale.
- A decision that is hard to reverse, made without an ADR.

## Tests

- A behaviour change without a test that would have failed before it.
- A test that touches real user state, the network, or the machine's real
  config instead of a temp directory.
- A Windows-only test with no platform-independent counterpart for the logic
  that doesn't need Windows.
