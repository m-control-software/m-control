import { spawnSync } from 'child_process';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Runs the Actions Ring tests (test_ring.py, stdlib unittest) under `yarn test`
 * on every platform: lib/ring.py has no Windows imports, and the tests work on a
 * fixture LogiPluginService tree in a temp directory. They pin the encoder,
 * compiler and patcher to what the Options+ UI wrote (fixtures/ring-ui-written.json).
 */

const TEST_DIR = __dirname;
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

describe('logi-options Actions Ring (python unittest)', () => {
  it('matches the UI-written evidence', () => {
    const r = spawnSync(
      PYTHON,
      [
        '-m',
        'unittest',
        'discover',
        '-s',
        TEST_DIR,
        '-p',
        'test_ring.py',
        '-v',
      ],
      { cwd: path.resolve(TEST_DIR, '..'), encoding: 'utf8' }
    );
    // unittest reports on stderr; surface it when something fails.
    expect(r.status, r.stderr + r.stdout).toBe(0);
  }, 60_000);
});
