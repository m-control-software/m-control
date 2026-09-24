import { spawnSync } from 'child_process';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Runs the compiler tests (test_model.py, stdlib unittest) under `yarn test`.
 *
 * They pin the generated Logitech cards to what the Options+ UI actually wrote
 * in the controlled experiments. Catalog-dependent cases skip themselves when
 * Options+ is not installed; the Python side reports which.
 */

const TEST_DIR = __dirname;
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

windowsOnly('logi-options compiler (python unittest)', () => {
  it('matches the UI-written evidence', () => {
    const r = spawnSync(
      'python',
      ['-m', 'unittest', 'discover', '-s', TEST_DIR, '-p', 'test_*.py', '-v'],
      { cwd: path.resolve(TEST_DIR, '..'), encoding: 'utf8' }
    );
    // unittest reports on stderr; surface it when something fails.
    expect(r.status, r.stderr + r.stdout).toBe(0);
  }, 60_000);
});
