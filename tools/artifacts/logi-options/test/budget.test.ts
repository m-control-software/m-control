import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The transaction's deadline arithmetic (lib/transaction.py) assumes the runner
 * kills the tool after exactly RUNNER_TIMEOUT_S. That number is only true while
 * the manifest declares the same budget: without a declared timeoutMs a user's
 * config.timeouts.default would apply instead, and a lower one would kill the
 * tool while the Options+ agent is stopped. Platform-independent, so it runs
 * in CI unlike the Windows-only suites.
 */

const TOOL_DIR = path.resolve(__dirname, '..');

describe('logi-options run budget', () => {
  it('declares the timeout the transaction budgets against', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(TOOL_DIR, 'manifest.json'), 'utf-8')
    ) as { timeoutMs?: number };
    const source = fs.readFileSync(
      path.join(TOOL_DIR, 'lib', 'transaction.py'),
      'utf-8'
    );
    const match = /^RUNNER_TIMEOUT_S = ([\d.]+)/m.exec(source);

    expect(
      match,
      'RUNNER_TIMEOUT_S not found in transaction.py'
    ).not.toBeNull();
    expect(manifest.timeoutMs).toBe(Number(match![1]) * 1000);
  });
});
