---
name: add-tool
description: Add a new m-control tool (a standalone process under tools/<category>/<id>/ that `mctl run <id>` executes) — from design through scaffold, implementation, tests and `yarn verify`. Use when the user asks to add, create, build or scaffold a tool, command, integration or automation that mctl should run (e.g. "add a tool that lists my open Jira tickets", "make an mctl command for X", "wrap the az CLI as a tool"). Not for changing an existing tool's internals, and not for changing the manifest, protocol or config contracts themselves (use change-contract).
---

# Add a tool

The contracts are in `AGENTS.md` ("Contracts", "Adding a tool") and
`docs/architecture/execution-model.md` (Tool Protocol v1). Read both before
designing; don't restate them from memory. `docs/architecture/constraints.md`
§4 applies if the tool changes live state.

## 1. Design — then stop for approval

Settle these with the user and present them as one short proposal. **Do not
scaffold until the user approves it.**

- **id** (kebab-case, unique — `yarn new:tool` checks) and **category**
  (existing folder under `tools/` if one fits).
- **runtime**: `node` (default for glue and HTTP APIs), `python` (data work,
  stdlib-only), `powershell` (Windows automation; must run under Windows
  PowerShell 5.1). Templates exist for node and python only.
- **input** (`mctl run <id> key=value`): every key, its meaning and default.
  Values arrive as **strings**; booleans are parsed from `true/false` and a
  bad value is an error, never a guess. Options are never `--flags`.
- **config**: dot-paths under `tools.<id>.*` (or a shared section such as
  `azdo.*`), each marked required or optional. Secrets live in config, never
  in input, logs or results.
- **result payload**: its shape, and what each `log` event says.
- **error codes**: one per expected failure, each with `recoverable`
  (`true` = the user can fix it: config, input, credentials, network;
  `false` = a bug). Wrapping an API? Map 401/403/404/429/5xx/timeout.
- **live state**: does it change anything outside its own output? Then it
  needs `check=true` (dry run), a backup, verification after writing, and a
  budget it finishes within — see constraints §4 and how `stream-deck` and
  `logi-options` do it.
- **budget**: expected run time; anything near 30 s declares `timeoutMs`.
- **data**: personal or client material (names, packs, paths) never enters
  this repo. It lives in directories config points at.

## 2. Scaffold

```bash
yarn new:tool --id=<id> --category=<category> --runtime=<node|python> --description="<one line>" --dry-run
yarn new:tool --id=<id> --category=<category> --runtime=<node|python> --description="<one line>"
```

Never copy a template by hand. PowerShell has no template: copy the closest
existing tool (`tools/artifacts/stream-deck`) and adapt it, including its
required-config check in `main.ps1`.

## 3. Implement

- `manifest.json`: add `requiredConfig`, `optionalConfig`, `timeoutMs`,
  `tags`. The node/python templates read `requiredConfig` from the manifest
  and fail with `CONFIG_MISSING` on their own — don't duplicate that check.
- Entry file: replace the TODO. Throw `ToolFailure(message, code,
  recoverable)` for expected failures; messages say what the user should do.
- Runtime rules (AGENTS.md): node = plain `.js`, no dependencies; python =
  stdlib, 3.10+; powershell = 5.1 syntax. Linters enforce these in
  `yarn verify`.

## 4. Test

- `<tool>/test/protocol.test.ts` (scaffolded): fill `VALID_CONFIG`, then one test per
  input rule and per error code, asserting `code` and `recoverable`. Use
  `runTool` / `expectProtocol` from `@m-control/test-support`.
- Point every path the tool reads or writes at a temp dir in tests (see
  `tools/agents/agent-status/test/protocol.test.ts`). Nothing may touch real
  user state or the network.
- Tests needing Windows or an installed app use `describe.skipIf`; keep a
  platform-independent test for everything else (CI is Ubuntu).
- `requiredConfig` non-empty → add `<tool>/test/smoke-config.json` supplying each key
  (`${toolDir}` expands to the tool directory).
- Missing-config and malformed-request behaviour is already covered for every
  tool by `test/conformance.test.ts`.

## 5. Document

- `README.md`: usage, **every** config key in a table (the conformance test
  checks each is mentioned), external dependencies, safety notes.
- Add the tool to the "Tools today" line in `AGENTS.md` (checked by a test).
- The scaffold already added a `CHANGELOG.md` entry; make it say what the tool
  does for the user.

## 6. Verify and report

Run `yarn verify` and report its actual summary line. Then run the tool once
for real (`node apps/mctl/dist/bundle/index.js run <id> …`) if it is safe to
do so — ask first if it changes live state — and show the user the result.
