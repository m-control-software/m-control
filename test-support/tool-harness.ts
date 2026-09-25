/**
 * Shared helpers for tool tests (tools/<category>/<id>/test/*.test.ts).
 *
 * Tools are spawned as real processes, with the same interpreter mctl would
 * use (resolveSpawnCommand), so a test exercises the tool the way a user runs
 * it. Import as `@m-control/test-support` — a Vitest/tsconfig alias to this
 * directory, not a workspace package.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'vitest';
import {
  RuntimeCommandOverrides,
  ToolManifest,
  resolveSpawnCommand,
} from '@m-control/core';

export interface HarnessEvent {
  type: string;
  ts: string;
  toolId: string;
  payload: Record<string, unknown>;
}

export interface ToolRun {
  status: number | null;
  events: HarnessEvent[];
  /** Non-empty stdout lines, raw. */
  lines: string[];
  stdout: string;
  stderr: string;
  /** Payload of the first `result` event, if any. */
  result?: Record<string, unknown>;
  /** Payload of the first `error` event, if any. */
  error?: Record<string, unknown>;
}

export interface RunToolOptions {
  /** Flat config map, keyed by dot-path, exactly as mctl delivers it. */
  config?: Record<string, unknown>;
  /** ToolInput. mctl delivers `key=value` pairs as strings. */
  input?: Record<string, unknown>;
  /** Defaults to the tool directory. */
  workspaceRoot?: string;
  /** Interpreter overrides, as config.runtimes. */
  runtimes?: RuntimeCommandOverrides;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Override the raw stdin (e.g. to send malformed JSON). */
  stdin?: string;
}

/** Reads and parses <toolDir>/manifest.json. */
export function readManifest(toolDir: string): ToolManifest {
  return JSON.parse(
    fs.readFileSync(path.join(toolDir, 'manifest.json'), 'utf-8')
  ) as ToolManifest;
}

/**
 * Spawns the tool in `toolDir` with one ToolRequest on stdin and collects its
 * events. Stdout lines are parsed strictly: a line that is not JSON throws,
 * because mctl would drop it and the tool would be broken for users.
 */
export function runTool(toolDir: string, opts: RunToolOptions = {}): ToolRun {
  const manifest = readManifest(toolDir);
  const entry = path.join(toolDir, manifest.entry);
  const { command, args } = resolveSpawnCommand(
    manifest.runtime,
    entry,
    opts.runtimes
  );
  const request =
    opts.stdin ??
    JSON.stringify({
      context: {
        toolId: manifest.id,
        config: opts.config ?? {},
        workspaceRoot: opts.workspaceRoot ?? toolDir,
      },
      input: opts.input ?? {},
    });

  const r = spawnSync(command, args, {
    input: request,
    encoding: 'utf8',
    env: opts.env ?? process.env,
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) {
    throw r.error;
  }

  const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const events = lines.map((line, i) => {
    try {
      return JSON.parse(line) as HarnessEvent;
    } catch {
      throw new Error(
        `stdout line ${i + 1} of ${manifest.id} is not JSON — tools may only ` +
          `write NDJSON ToolEvents to stdout (use a log event or stderr): ${line}`
      );
    }
  });

  return {
    status: r.status,
    events,
    lines,
    stdout: r.stdout,
    stderr: r.stderr,
    result: events.find((e) => e.type === 'result')?.payload,
    error: events.find((e) => e.type === 'error')?.payload,
  };
}

const EVENT_TYPES = ['started', 'log', 'result', 'error'];

/**
 * Asserts Tool Protocol v1 on a finished run: every event well-formed and
 * attributed to `toolId`, `started` first, exactly one terminal event and it is
 * last, and the exit code agrees with it: 0 after `result`, non-zero after
 * `error`, and exactly 1 after a recoverable one.
 */
export function expectProtocol(run: ToolRun, toolId: string): void {
  const context = `stderr:\n${run.stderr}\nstdout:\n${run.stdout}`;
  expect(run.events.length, context).toBeGreaterThan(0);

  for (const e of run.events) {
    expect(EVENT_TYPES, context).toContain(e.type);
    expect(e.toolId, context).toBe(toolId);
    expect(typeof e.ts, context).toBe('string');
    expect(Number.isNaN(Date.parse(e.ts)), `unparseable ts: ${e.ts}`).toBe(
      false
    );
    expect(typeof e.payload, context).toBe('object');
    expect(e.payload, context).not.toBeNull();
  }

  expect(run.events[0].type, context).toBe('started');

  const terminal = run.events.filter(
    (e) => e.type === 'result' || e.type === 'error'
  );
  expect(terminal.length, context).toBe(1);
  expect(run.events[run.events.length - 1], context).toBe(terminal[0]);

  if (terminal[0].type === 'result') {
    expect(run.status, context).toBe(0);
  } else {
    const p = terminal[0].payload;
    expect(typeof p.message, context).toBe('string');
    expect(typeof p.recoverable, context).toBe('boolean');
    // 1 = expected failure; >= 2 = crash, which is never recoverable.
    expect(run.status, context).not.toBe(0);
    if (p.recoverable) expect(run.status, context).toBe(1);
  }
}

/** Asserts a well-formed run that ended in a recoverable `error` event. */
export function expectRecoverableError(run: ToolRun, toolId: string): void {
  expectProtocol(run, toolId);
  expect(run.error, run.stdout).toBeDefined();
  expect(run.error!.recoverable, run.stdout).toBe(true);
}

/** True when `command` can be spawned on this machine. */
export function commandAvailable(command: string, args: string[]): boolean {
  const r = spawnSync(command, args, { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

/**
 * True when the interpreter for the tool's runtime exists here. Lets a suite
 * skip cleanly (describe.skipIf) instead of failing on a machine without it.
 */
export function runtimeAvailable(toolDir: string): boolean {
  const { runtime } = readManifest(toolDir);
  const { command } = resolveSpawnCommand(runtime, 'probe.dll');
  switch (runtime) {
    case 'node':
      return true;
    case 'python':
      return commandAvailable(command, ['--version']);
    case 'powershell':
      return commandAvailable(command, ['-NoProfile', '-Command', 'exit 0']);
    case 'dotnet':
      return commandAvailable(command, ['--info']);
  }
}
