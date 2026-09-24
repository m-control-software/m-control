# Prompt: Implement a New Tool

Use this when adding a tool to `tools/`. Fill in the brackets and paste it into
a coding-agent session started at the repo root.

---

## Prompt

```
I want to add a new m-control tool.

Tool id: [kebab-case-id]
Category: [folder under tools/, e.g. agents, artifacts, azdo, k8s, misc]
Runtime: [node | python | powershell | dotnet]
What it does: [one paragraph — inputs, outputs, side effects]
Input (from `mctl run <id> key=value`): [keys, meaning, defaults — values arrive as strings]
Config it needs: [dot-paths under tools.*, e.g. azdo.token; say which are required]
External dependencies: [binaries, APIs, installed apps]
Changes live state? [no | yes — what it writes and how to undo it]
Expected run time: [seconds; anything near or above 30 s needs timeoutMs]

Read first: AGENTS.md (contracts, "Adding a tool", code rules),
docs/architecture/execution-model.md (Tool Protocol v1), and
docs/architecture/constraints.md (§4 if it changes live state).

Then:
1. Propose the design before writing code: manifest, input and config keys,
   events you will emit (log messages, result payload shape, error codes with
   their `recoverable` value), and anything unclear.
2. Copy templates/<runtime>-tool (or the closest existing tool for powershell)
   to tools/<category>/<id>/ and fill in the manifest.
3. Implement the entry point following Tool Protocol v1.
4. Add tests in tools/<category>/<id>/test/*.test.ts that spawn the tool with
   a ToolRequest and assert on events and exit code, including missing config
   and bad input. Skip cleanly where the platform or an installed app is missing.
5. Write the tool's README.md (usage, config keys, dependencies, safety notes).
6. Add an [Unreleased] entry to CHANGELOG.md. Document every config key in
   the README; don't add a section to core's config template (it is
   tool-agnostic). If the tool has requiredConfig, give it CI values in the
   smoke-test step of .github/workflows/ci.yml.
7. Run yarn build, yarn typecheck, yarn lint, yarn test, then
   `node apps/mctl/dist/bundle/index.js run <id> …` and `… doctor`.
```

---

## What to check in the result

- [ ] `manifest.json` has every required field (`manifestVersion`, `id`,
      `version`, `name`, `description`, `runtime`, `entry`) and declares every
      config key the tool reads — undeclared keys arrive as `undefined`
- [ ] `started` is the first event; nothing but NDJSON on stdout
- [ ] Every failure path ends in an `error` event with a stable `code`, an
      honest `recoverable`, and exit code 1 (or ≥2 for a crash)
- [ ] Options come from `input`, not argv (`check=true`, not `--check`)
- [ ] Missing config fails with a message naming the key and the config file
- [ ] No personal or client data in the repo — it belongs in config-pointed directories
- [ ] Runtime conventions: node plain `.js` without dependencies; python
      stdlib-only; powershell runs under Windows PowerShell 5.1
- [ ] Tools that change live state: dry run, backup, verify, fits its budget
- [ ] `mctl doctor` is clean on a configured machine

## Variations

**Wraps an API** — add to the prompt: authentication (config key), rate limits,
and how each of 401/403/404/429/5xx/timeout maps to an error `code` and
`recoverable` value.

**Generates or applies a config** (Stream Deck, Options+ style) — add: where the
specs live (config key for pack directories), the target location, how
`check=true` reports drift, and the backup/rollback plan. Read ADR-0010
("Generated artifacts") and ADR-0011 first.

## Related

- `docs/ai/PROMPTS/design-review.md` — review the design before implementing
- `docs/ai/PROMPTS/write-adr.md` — if the tool needs an architectural decision
- `docs/ai/PROMPTS/import-streamdeck.md` — a worked, phase-by-phase import recipe

**Last updated:** 2026-09-24
