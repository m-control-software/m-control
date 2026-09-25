import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  expectProtocol,
  readManifest,
  runTool,
  runtimeAvailable,
} from '@m-control/test-support';

/**
 * Protocol tests for this tool. The repo-wide conformance suite
 * (test/conformance.test.ts) already covers the missing-required-config path
 * for every tool; this file covers behaviour specific to this tool.
 *
 * Add a test per input rule and per error code the tool can emit, asserting
 * the `code` and `recoverable` value. A tool that needs Windows or an
 * installed app gates those tests with describe.skipIf and keeps the rest
 * platform-independent (CI is Ubuntu).
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const { id } = readManifest(TOOL_DIR);

/** Every requiredConfig key, with a value that makes a run succeed. */
const VALID_CONFIG: Record<string, unknown> = {};

describe.skipIf(!runtimeAvailable(TOOL_DIR))(`${id} protocol`, () => {
  it('succeeds and follows Tool Protocol v1', () => {
    const run = runTool(TOOL_DIR, { config: VALID_CONFIG });
    expectProtocol(run, id);
    expect(run.status).toBe(0);
    expect(run.result).toBeDefined();
  });

  it('reports a malformed request as a non-recoverable error', () => {
    const run = runTool(TOOL_DIR, { stdin: 'not json' });
    expectProtocol(run, id);
    expect(run.error?.code).toBe('INVALID_REQUEST');
    expect(run.error?.recoverable).toBe(false);
  });
});
