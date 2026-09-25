# Coding Guidelines

Style and patterns for m-control code. The hard rules are in
`docs/architecture/constraints.md` and `AGENTS.md`; this file covers how to
write code that fits in. These are guidelines: break one when it makes the
code clearer, and say why in a comment.

## Principles

1. **Clarity over cleverness.**
2. **Fail fast** — validate at the boundary, with a message that says what to do.
3. **Explicit over implicit** — typed signatures, named constants.
4. **Comment why, not what.** Most comments in this repo explain a constraint
   or a past failure; that's the bar.

---

## TypeScript (`packages/`, `apps/`)

### Types

```typescript
// Explicit signatures on exported functions
export function resolveTimeoutMs(
  manifest: ToolManifest,
  config: MControlConfig
): number { … }

// unknown + narrowing, not any
function readTimeout(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : undefined;
}
```

- `any` only with a comment saying why (ESLint warns).
- Contracts live in `packages/core/src/types.ts`. A literal type
  (`manifestVersion: 1`) beats `number` when only one value is valid.
- `async`/`await` for asynchronous work; the runner exposes
  `AsyncIterable<ToolEvent>` so callers can stream.

### Errors

```typescript
import { ConfigError } from '@m-control/core';

// Actionable: what's wrong, where, and how to fix it
throw new ConfigError(
  `configVersion mismatch in ${filePath}: expected 1, got ${String(v)}. ` +
    `Delete the file and run 'mctl init'.`
);

// Adding context when rethrowing
try {
  raw = fs.readFileSync(filePath, 'utf-8');
} catch (err) {
  throw new ConfigError(
    `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`
  );
}
```

- Pick the class by cause (`ConfigError`, `ManifestError`, `DiscoveryError`,
  `RunnerError`, `RunnerGuardrailError`, `NotImplementedError`). Never a raw
  `Error`; never an empty `catch`.
- Collect-and-report beats throw-on-first when one bad item shouldn't block the
  rest — discovery returns `{ tools, errors }` instead of failing on one
  invalid manifest.

### Output

- In core: no `console.*`. Tool events go through an `EventSink`.
- In mctl commands: plain `console.log`/`console.error` for the command's own
  output; `process.stderr.write` for warnings that must not mix with stdout;
  `process.exit(1)` on failure so scripts can rely on the exit code.

### Files, names, exports

- Files and folders: `kebab-case.ts` (`process-runner.ts`, `node-runner.ts`).
- Variables and functions: `camelCase`; booleans read as questions
  (`isWindows`, `hasOptionsPlus`).
- Types, interfaces, classes: `PascalCase`.
- True constants: `UPPER_SNAKE_CASE` (`DEFAULT_TIMEOUT_MS`, `EXIT_CODES`).
  Put a number in a named constant when its meaning isn't obvious at the call
  site.
- Named exports only in libraries. New public API is re-exported from
  `packages/core/src/index.ts`.
- Import order: Node built-ins, external packages, `@m-control/core`, then
  relative imports.

### Structure

- Small functions with one job. Early returns over nested conditionals.
- Keep a function under ~50 lines unless splitting it would scatter one idea.
- Section banners (`// ----- Config -----`) are the house style for long files.

---

## Tools (`tools/`)

- Start with `yarn new:tool`; the reference implementations are
  `tools/misc/hello-world/index.js` and `tools/misc/hello-python/main.py`.
- Keep the protocol plumbing (`emit`, `started`, `log`, `result`, `error`) in
  one small block at the top, or in a `lib/protocol.*` module once the tool
  has several files (as logi-options and stream-deck do).
- Take the tool id and the required config keys from `manifest.json` (the
  templates do), so the manifest stays the only place they are declared.
- Validate `input` and `context.config` first, and fail with a recoverable
  `error` event naming the key and where to set it.
- Error `code`s are `UPPER_SNAKE_CASE` and stable — scripts match on them.
- Larger tools split into `lib/`, keep reverse-engineering notes and formats in
  `docs/`, and document usage, config, and dependencies in `README.md`.

---

## Tests

- Vitest. `describe`/`it`, Arrange–Act–Assert, one behaviour per test.
- Location: `packages/<pkg>/test/*.test.ts`, `apps/<app>/test/*.test.ts`,
  `tools/<category>/<id>/test/*.test.ts`, repo-wide checks in `test/`.
- Tests import `@m-control/core` and `@m-control/test-support`; both resolve
  to sources, so no build is needed first.
- Tool tests spawn the tool with `runTool` and assert with `expectProtocol`.
  Use temp directories and fixtures; never touch real user state or the
  network. Skip, don't fail, when the platform or an installed app is missing.
- A rule worth writing down is usually worth a test: prefer adding a case to
  `test/conformance.test.ts` or `test/docs.test.ts` over adding prose.

---

## Before you commit

`yarn verify`. Then the judgment calls in `REVIEW.md`.

**Last updated:** 2026-09-25
