import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectProtocol,
  runTool as runToolProcess,
} from '@m-control/test-support';

/**
 * Guards the tool's protocol behaviour and its safety valves.
 *
 * Every test aims the tool at a FIXTURE store (logi-options.dataDir). The tool
 * only ever stops/starts the Options+ agent for the live per-user store, so
 * nothing here can touch a real mouse configuration. Asserted, not assumed:
 * results must report agentRestarted=false.
 *
 * Validation compiles against Logitech's catalogs, so these tests need Logi
 * Options+ installed and skip otherwise.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const hasOptionsPlus =
  process.platform === 'win32' &&
  fs.existsSync(
    path.join(
      process.env.PROGRAMDATA ?? 'C:\\ProgramData',
      'LogiOptionsPlus',
      'depots'
    )
  );
const suite = hasOptionsPlus ? describe : describe.skip;

let root: string;
let dataDir: string;
let packDir: string;
let backupDir: string;

function runTool(
  input: Record<string, string>,
  extraConfig: Record<string, unknown> = {}
) {
  return runToolProcess(TOOL_DIR, {
    config: {
      'logi-options.dataDir': dataDir,
      'logi-options.packDirs': [packDir],
      'logi-options.backupDir': backupDir,
      ...extraConfig,
    },
    workspaceRoot: root,
    input,
  });
}

function writePack(
  name: string,
  profiles: unknown[],
  dir = packDir,
  pack = 'test'
): string {
  const file = path.join(dir, `${name}.logi.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      { specVersion: 1, pack, device: 'mx-master-4', profiles },
      null,
      2
    )
  );
  return file;
}

function hash(file: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
}

const globalBack = {
  application: { global: true },
  buttons: { back: { shortcut: 'ALT+LEFT' } },
};

suite('logi-options protocol', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'logi-options-'));
    dataDir = path.join(root, 'data');
    packDir = path.join(root, 'packs');
    backupDir = path.join(root, 'backups');
    const r = spawnSync(
      'python',
      [
        path.join(FIXTURES, 'make_store.py'),
        path.join(FIXTURES, 'store.json'),
        dataDir,
      ],
      {
        encoding: 'utf8',
      }
    );
    expect(r.status, r.stderr).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('check=true reports drift and writes nothing', () => {
    writePack('p', [globalBack]);
    const before = hash(path.join(dataDir, 'settings.db'));
    const { status, result } = runTool({ check: 'true' });
    expect(status).toBe(0);
    expect(result!.mode).toBe('check');
    expect(result!.inSync).toBe(false);
    expect(result!.written).toBe(false);
    expect((result!.planned as string[]).length).toBeGreaterThan(0);
    expect(hash(path.join(dataDir, 'settings.db'))).toBe(before);
    expect(fs.existsSync(backupDir)).toBe(false);
  }, 30_000);

  it('applies to a fixture store without touching the agent, then is idempotent', () => {
    writePack('p', [globalBack]);
    const first = runTool({});
    expect(first.status, JSON.stringify(first.error)).toBe(0);
    expect(first.result!.changed).toBe(true);
    expect(first.result!.verified).toBe(true);
    expect(first.result!.agentRestarted).toBe(false);
    expect(fs.readdirSync(backupDir).length).toBe(1);

    const second = runTool({});
    expect(second.result!.changed).toBe(false);
    expect(runTool({ check: 'true' }).result!.inSync).toBe(true);
  }, 30_000);

  it('export writes a pack that re-imports as in sync', () => {
    const out = path.join(root, 'exported', 'all.logi.json');
    const exp = runTool({ mode: 'export', app: 'all', out, pack: 'exported' });
    expect(exp.status, JSON.stringify(exp.error)).toBe(0);
    expect(exp.result!.written).toBe(out);
    const check = runTool(
      { check: 'true' },
      { 'logi-options.packDirs': [path.dirname(out)] }
    );
    expect(check.result!.inSync).toBe(true);
    // refuses to overwrite without force=true
    expect(runTool({ mode: 'export', app: 'all', out }).status).toBe(1);
  }, 30_000);

  it('rejects an uninterpretable flag instead of guessing', () => {
    writePack('p', [globalBack]);
    const before = hash(path.join(dataDir, 'settings.db'));
    const { status, error } = runTool({ check: 'banana' });
    expect(status).toBe(1);
    expect(String(error!.message)).toContain('banana');
    expect(hash(path.join(dataDir, 'settings.db'))).toBe(before);
  }, 30_000);

  it('rejects a misspelled key instead of running a real apply', () => {
    writePack('p', [globalBack]);
    const before = hash(path.join(dataDir, 'settings.db'));
    const { status, error } = runTool({ chek: 'true' });
    expect(status).toBe(1);
    expect(String(error!.message)).toContain('chek');
    expect(hash(path.join(dataDir, 'settings.db'))).toBe(before);
  }, 30_000);

  it('refuses two packs setting the same button, naming both files', () => {
    writePack('a', [globalBack], path.join(packDir, 'one'));
    writePack('b', [globalBack], path.join(packDir, 'two'));
    const { status, error } = runTool({ check: 'true' });
    expect(status).toBe(1);
    // Paths are reported resolved (long form), the temp dir may be 8.3 - compare the tails.
    expect(String(error!.message)).toContain(path.join('one', 'a.logi.json'));
    expect(String(error!.message)).toContain(path.join('two', 'b.logi.json'));
  }, 30_000);

  it('explains where to put specs when none are found', () => {
    const { status, error } = runTool({ check: 'true' });
    expect(status).toBe(1);
    expect(String(error!.message)).toContain('packDirs');
  }, 30_000);

  it('emits only NDJSON ToolEvent lines on stdout', () => {
    writePack('p', [globalBack]);
    // Strict parse plus event order, attribution and exit-code agreement.
    expectProtocol(runTool({ check: 'true' }), 'logi-options');
  }, 30_000);
});
