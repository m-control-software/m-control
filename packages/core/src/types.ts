/**
 * @m-control/core - Type definitions
 * Tool Protocol v1
 *
 * These types define the full contract between the orchestrator and tools.
 * Breaking changes require a new manifestVersion / configVersion and migration path.
 */

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Supported runtimes for tool execution. */
export type ToolRuntime = 'node' | 'python' | 'dotnet' | 'powershell';

/**
 * Tool manifest - metadata descriptor read from tools/{category}/{tool}/manifest.json.
 *
 * `manifestVersion` is a literal type so TypeScript enforces the version
 * field is always explicitly set to the known constant (not just any number).
 */
export interface ToolManifest {
  /** Schema version. Increment when breaking changes are made to this interface. */
  manifestVersion: 1;
  /** Unique tool identifier. kebab-case. Used in `mctl run <id>`. */
  id: string;
  /** Semver tool version. */
  version: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description shown in `mctl list`. */
  description: string;
  /** Runtime that executes the tool entry point. */
  runtime: ToolRuntime;
  /**
   * Relative path (from manifest dir) to the entry point, or command name.
   * Examples: "index.js", "main.py", "MyTool.exe"
   */
  entry: string;
  /** Config keys this tool requires (dot-notation). Used for preflight checks. */
  requiredConfig?: string[];
  /** Optional tags for filtering / future UI grouping. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Tool Protocol v1 - Event Stream
// ---------------------------------------------------------------------------

/**
 * Every event emitted to stdout (NDJSON) by a tool must include these fields.
 *
 * stdout = ONLY ToolEvent NDJSON lines.
 * Human-readable messages go into `log` events or stderr.
 */
export interface BaseEvent {
  /** Discriminant for the event union. */
  type: ToolEventType;
  /** ISO-8601 timestamp set by the tool at emission time. */
  ts: string;
  /** Tool ID - must match manifest.id. Allows multiplexing in the future. */
  toolId: string;
  payload: unknown;
}

export type ToolEventType = 'started' | 'log' | 'result' | 'error';

/** Emitted immediately after the tool process initialises. */
export interface StartedEvent extends BaseEvent {
  type: 'started';
  payload: {
    /** Optional metadata the tool wants to surface at startup. */
    meta?: Record<string, unknown>;
  };
}

/** Structured log line. All human output must go through this, not raw stdout. */
export interface LogEvent extends BaseEvent {
  type: 'log';
  payload: {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    /** Optional structured context. */
    data?: unknown;
  };
}

/**
 * Final result payload. A tool SHOULD emit exactly one `result` event.
 * Multiple results are allowed for streaming use cases but consumers
 * may treat the last one as authoritative.
 */
export interface ResultEvent extends BaseEvent {
  type: 'result';
  payload: unknown;
}

/**
 * Emitted when the tool encounters an error.
 *
 * `recoverable: true`  -> user can fix (e.g. missing config, bad input)
 * `recoverable: false` -> bug or unrecoverable state; report to developer
 *
 * After an error event the tool should exit with code 1 (expected failure)
 * or 2+ (crash). Emitting an error event and exiting 0 is invalid.
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  payload: {
    message: string;
    /** Machine-readable error code. e.g. "CONFIG_MISSING", "AUTH_FAILED" */
    code?: string;
    recoverable: boolean;
  };
}

/** Discriminated union of all tool events. */
export type ToolEvent = StartedEvent | LogEvent | ResultEvent | ErrorEvent;

// ---------------------------------------------------------------------------
// Tool Protocol v1 - Request (stdin)
// ---------------------------------------------------------------------------

/**
 * Arbitrary input passed by the user / orchestrator to the tool.
 * Tools define their own input schema; the orchestrator passes it through.
 */
export type ToolInput = Record<string, unknown>;

/**
 * Context the orchestrator provides to every tool execution.
 * Written to the tool's stdin as part of ToolRequest.
 */
export interface RunContext {
  /** Tool ID being invoked. */
  toolId: string;
  /**
   * Relevant config slice for this tool.
   * Orchestrator extracts only what the tool's manifest.requiredConfig lists.
   * Tools receive a flat key-value map, not the raw config structure.
   */
  config: Record<string, unknown>;
  /**
   * Absolute path to the workspace/project root.
   * Tools may use this to resolve relative paths.
   */
  workspaceRoot: string;
}

/**
 * The full request payload written to stdin.
 * Tools must read stdin to EOF and parse as JSON before executing.
 */
export interface ToolRequest {
  context: RunContext;
  input: ToolInput;
}

// ---------------------------------------------------------------------------
// Runner Interface
// ---------------------------------------------------------------------------

/** Options for runner execution guardrails. */
export interface RunnerOptions {
  /**
   * Maximum execution time in milliseconds.
   * @default 30_000
   */
  timeoutMs?: number;
  /**
   * Maximum stdout bytes the runner will consume.
   * Excess triggers an `error` event + SIGTERM.
   * @default 10_485_760 (10 MB)
   */
  maxOutputBytes?: number;
  /**
   * Maximum number of events the runner will relay.
   * Excess triggers an `error` event + SIGTERM.
   * @default 10_000
   */
  maxEvents?: number;
}

/**
 * A discovered tool ready for execution - manifest + resolved filesystem paths.
 * Defined here (not in discovery.ts) to avoid circular dependency:
 * Runner interface lives in types.ts, and discovery.ts imports from types.ts.
 */
export interface ResolvedTool {
  manifest: ToolManifest;
  /** Absolute path to the directory containing manifest.json. */
  dir: string;
  /** Absolute path to the entry point (manifest.entry resolved from dir). */
  entryPath: string;
}

/**
 * Runner - the interface every runtime implementation must satisfy.
 *
 * Returns an AsyncIterable so consumers can stream events as they arrive,
 * enabling live output, early abort, and future parallel execution.
 *
 * Implementations:
 *   - NodeRunner (Chunk E) - spawns a child process, pipes stdin/stdout
 *   - Others (python, dotnet...) - throw NotImplementedError until needed
 */
export interface Runner {
  run(
    tool: ResolvedTool,
    context: RunContext,
    input: ToolInput,
    options?: RunnerOptions
  ): AsyncIterable<ToolEvent>;
}

// ---------------------------------------------------------------------------
// Exit Codes (documented here as constants, enforced by runners)
// ---------------------------------------------------------------------------

export const EXIT_CODES = {
  /** Tool completed successfully. */
  SUCCESS: 0,
  /** Expected failure - tool emitted an error event and exited cleanly. */
  EXPECTED_FAILURE: 1,
  /** Crash - unhandled exception, OOM, signal, etc. Exit code >= this value. */
  CRASH_MIN: 2,
} as const;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * A single tool's config section. Tools define their own keys —
 * the orchestrator treats sections as opaque.
 */
export type ToolConfigSection = Record<string, unknown>;

/**
 * Global user config stored at ~/.m-control/config.json.
 * `configVersion` is a literal type for the same reason as manifestVersion.
 *
 * `tools` is an OPEN schema on purpose: adding a new tool must never require
 * a change to @m-control/core. Sections are keyed by tool section name
 * (usually the manifest id or a shared service name like "azdo").
 */
export interface MControlConfig {
  /** Schema version. Fail fast if this doesn't match expected version. */
  configVersion: 1;
  /** Per-tool config sections. Keys referenced by manifest.requiredConfig. */
  tools: Record<string, ToolConfigSection | undefined>;
  /** Orchestrator path configuration. */
  paths?: {
    /**
     * Absolute paths to directories scanned for tool manifests.
     * Required for a globally installed mctl (which has no repo-relative
     * fallback). Multiple roots supported — later roots are lower priority
     * when tool ids collide.
     */
    toolsRoots?: string[];
  };
  /**
   * Per-runtime command overrides, e.g. { "python": "py" } on Windows.
   * Defaults are chosen per platform by the runner.
   */
  runtimes?: Partial<Record<ToolRuntime, string>>;
}

export const CONFIG_VERSION = 1 as const;
export const MANIFEST_VERSION = 1 as const;
