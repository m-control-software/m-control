# Architectural Constraints

The hard rules of m-control. Each one is followed by the current code; if the
code and this document disagree, one of them is a bug — fix it or amend the
rule in an ADR. `AGENTS.md` carries the condensed version for day-to-day work.

---

## 1. Boundaries

- **Core is a library.** `packages/core` has no CLI concerns: no
  `process.argv`, no `process.exit`, no `console.*`. It reports through return
  values and the error hierarchy. It writes to the terminal in exactly two
  places: the `EventSink` implementations (`events.ts`), and the runner
  forwarding a tool's stderr plus its own `[runner:<id>]` diagnostics to
  stderr. Keep it that way. Its public API is exactly what `src/index.ts`
  exports.
- **The CLI owns the terminal.** `apps/mctl` renders tool events only through
  an `EventSink` (`createEventSink`). Its own command output (`list`, `doctor`,
  `init`, usage errors) is plain console output — that is the CLI's UI, not
  logging.
- **Import core by package name.** `@m-control/core`, never
  `packages/core/src/…`.
- **Tools are processes, not modules.** A tool depends only on Tool Protocol v1
  (`execution-model.md`) — never on core internals, never on another tool.
  Crashes stay in the tool's process.
- **Tools are not workspaces.** Nothing under `tools/` is an npm package or
  has a build step. Node tools are plain `.js`; Python tools are stdlib-only.

## 2. Contracts

- **stdout is protocol.** A tool writes only NDJSON `ToolEvent` lines to
  stdout. Human text goes into `log` events or stderr. One stray `print`
  corrupts the stream.
- **stdin is read to EOF** and parsed as one `ToolRequest` before any work.
- **Exit codes mean something.** `0` success, `1` expected failure after an
  `error` event, `≥2` crash. An `error` event followed by exit 0 is invalid.
- **Options come from `input`.** mctl passes `key=value` arguments as input
  strings and consumes `--flags` itself; a tool must never parse argv.
- **Versioned schemas.** A breaking change to `ToolManifest` or
  `MControlConfig` needs a new `manifestVersion`/`configVersion` and a
  migration. Adding an optional field is not breaking. Validation fails fast
  with the file path and the fix in the message.
- **Open config schema.** Tool settings live under `tools.<section>.*`. Core
  never gains a tool-specific type or key; a tool only receives the keys its
  manifest declares (`requiredConfig` + `optionalConfig`).

## 3. Security and data

- **No secrets in output.** Tokens and keys never appear in `log`/`result`
  events, stderr, error messages, or files under version control.
- **No credentials or endpoints in code.** They come from config.
- **Never commit `config.json`** or other personal state. `.gitignore` covers
  `config.json` and `.env`.
- **Personal and client data stays out of the repo.** Specs, packs, names and
  machine paths live in directories the user points a tool at through config
  (e.g. `tools.logi-options.packDirs`, `tools.stream-deck.packDirs`). See
  ADR-0009.
- **Credentials are plaintext in `~/.m-control/config.json` today.** OS
  keychain storage is future work; don't build features that make the
  plaintext file more exposed (e.g. syncing it).

## 4. Tools that change live state

Established by stream-deck and logi-options (ADR-0010, ADR-0011):

- **Offer a dry run** (`check=true`) that validates and reports what would
  change without touching anything.
- **Back up before writing**, and keep the backup location configurable.
- **Never leave a half-written target.** Either verify what the target kept
  and roll back on mismatch (logi-options decompiles the live store), or swap
  atomically with a restore path (stream-deck renames bundles aside).
- **Fit the run budget.** Declare `timeoutMs` in the manifest when the tool
  needs anything other than the 30 s default, and never leave external state
  broken if the runner kills the tool mid-way.
- **Be idempotent.** Applying the same spec twice is a no-op the second time.

## 5. Errors and messages

- **Use the error hierarchy** in `packages/` and `apps/`: `ConfigError`,
  `ManifestError`, `DiscoveryError`, `RunnerError`, `RunnerGuardrailError`,
  `NotImplementedError` — never a raw `Error` (see `.claude/rules/errors.md`).
  Inside a tool, any failure ends as an `error` event with a `code` and an
  honest `recoverable` flag.
- **Messages say what to do next**, not just what went wrong:
  `configVersion mismatch: expected 1, got 2. Delete ~/.m-control/config.json and run mctl init.`
- **Never swallow an error.** Rethrow with context, or surface it as a warning
  (as discovery does for an invalid manifest). An empty `catch {}` is a bug.

## 6. Portability

- **Windows is primary, Linux is supported, macOS should not break.** Build
  paths with `path.join`/`path.resolve`, find the home directory through
  `os.homedir()` (or `USERPROFILE` on Windows, as core does), and never
  hardcode a user's path.
- **PowerShell tools must run under Windows PowerShell 5.1**, because that is
  what the `powershell` runtime spawns on Windows.
- **Interpreters are overridable** per machine via `config.runtimes`; don't
  assume a specific install location.

## 7. Performance

- Synchronous filesystem reads are fine for small, startup-time files (config,
  manifests) — the CLI is short-lived. Use streams or async I/O for anything
  large or unbounded, and never make blocking network calls.
- Tools stream progress as `log` events during long operations; they don't go
  silent until the end.

## 8. Testing

- Vitest, from the repo root (`yarn test`). Core is tested from TypeScript
  sources; tools are tested by spawning them as processes.
- Critical paths need tests: manifest validation, config loading and
  extraction, tools-root resolution, the runner's protocol handling and
  guardrails, and every tool's protocol behaviour.
- Test missing, empty and invalid config.
- Tests that need Windows or an installed app skip themselves elsewhere; CI is
  Ubuntu, so keep a platform-independent test for anything that can be checked
  without them (see `tools/artifacts/logi-options/test/budget.test.ts`).

---

## Enforcement

What is actually enforced, so nobody relies on a check that doesn't exist:

| Where | What |
|-------|------|
| TypeScript | `strict` mode for `packages/` and `apps/` |
| ESLint | `eslint:recommended`, `@typescript-eslint/recommended`, Prettier; `no-explicit-any` is a warning; `no-console` is **off** (see §1) |
| Discovery | Manifest schema, runtime, kebab-case id, config-key shape, `timeoutMs` |
| Runner | Timeout, output size, and event-count guardrails |
| CI | Install (frozen lockfile), build, typecheck, lint, test, smoke test |
| Review | Everything else in this document |

Tools under `tools/` are not linted or type-checked; their tests are the guard.

## Changing this document

Add a rule when a real failure shows it's needed, and write it so it matches
the code. A rule that the codebase can't or won't follow is worse than no
rule: agents will either obey it and break things, or learn to ignore the
whole document.

**Last updated:** 2026-09-24
