import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectProtocol,
  readManifest,
  runTool,
  runtimeAvailable,
} from '@m-control/test-support';

/**
 * Protocol tests for chrome-bridge's install/uninstall. The repo-wide
 * conformance suite covers the missing-config path.
 *
 * Every run gets a throwaway HOME (USERPROFILE) and, on Windows, a throwaway
 * registry key (M_CONTROL_CHROME_BRIDGE_REG_KEY under HKCU\Software\m-control-test),
 * so nothing touches Chrome's real NativeMessagingHosts key. Registry tests run
 * only on Windows; input validation and the platform refusal run everywhere.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const { id } = readManifest(TOOL_DIR);
const windows = process.platform === 'win32';

let home: string;
let regKey: string;

function run(
  input: Record<string, string>,
  config: Record<string, unknown> = {}
) {
  return runTool(TOOL_DIR, {
    input,
    config: { 'chrome-bridge.mctlPath': path.join(home, 'mctl.js'), ...config },
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      M_CONTROL_CHROME_BRIDGE_REG_KEY: regKey,
    },
  });
}

function regValue(): string | undefined {
  const r = spawnSync('reg.exe', ['query', regKey, '/ve'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return undefined;
  const line = r.stdout.split(/\r?\n/).find((l) => /\sREG_SZ\s/.test(l));
  return line?.split(/\s+REG_SZ\s+/)[1].trim();
}

describe.skipIf(!runtimeAvailable(TOOL_DIR))(`${id} protocol`, () => {
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-bridge-'));
    fs.writeFileSync(path.join(home, 'mctl.js'), '// fake mctl\n');
    regKey = `HKCU\\Software\\m-control-test\\chrome-bridge-${path.basename(home)}`;
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    if (windows)
      spawnSync('reg.exe', ['delete', regKey, '/f'], { encoding: 'utf8' });
  });

  it.each<[Record<string, string>, string]>([
    [{}, 'no action'],
    [{ action: 'reinstall' }, 'unknown action'],
    [{ action: 'install', check: 'maybe' }, 'bad boolean'],
    [{ action: 'install', force: 'true' }, 'unknown key'],
  ])('rejects %j (%s) as INPUT_INVALID', (input) => {
    const r = run(input);
    expectProtocol(r, id);
    expect(r.error).toMatchObject({ code: 'INPUT_INVALID', recoverable: true });
  });

  it('reports a malformed request as a non-recoverable error', () => {
    const r = runTool(TOOL_DIR, { stdin: 'not json' });
    expectProtocol(r, id);
    expect(r.error?.code).toBe('INVALID_REQUEST');
    expect(r.error?.recoverable).toBe(false);
  });

  it.skipIf(windows)(
    'refuses to install off Windows (v1), writing nothing',
    () => {
      const r = run({ action: 'install' });
      expect(r.error).toMatchObject({
        code: 'UNSUPPORTED_PLATFORM',
        recoverable: true,
      });
      expect(fs.existsSync(path.join(home, '.m-control'))).toBe(false);
    }
  );

  // reg.exe takes a second or more per call, so these outgrow the 5 s default.
  describe.skipIf(!windows)(
    'on Windows, in a sandbox',
    { timeout: 60_000 },
    () => {
      const stateDir = () => path.join(home, '.m-control', 'chrome-bridge');

      it('check=true plans the install and writes nothing', () => {
        const r = run({ action: 'install', check: 'true' });
        expectProtocol(r, id);
        expect(r.status).toBe(0);
        expect(r.result!.changed).toBe(false);
        expect(
          (r.result!.changes as Array<{ action: string }>).map((c) => c.action)
        ).toEqual(['create', 'create', 'create']);
        expect(fs.existsSync(stateDir())).toBe(false);
        expect(regValue()).toBeUndefined();
      });

      it('installs once, is idempotent, and uninstalls everything', () => {
        const first = run({ action: 'install' });
        expectProtocol(first, id);
        expect(first.result!.changed).toBe(true);
        const manifestFile = path.join(
          stateDir(),
          'com.m_control.chrome_bridge.json'
        );
        expect(regValue()).toBe(manifestFile);
        const hostManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        expect(hostManifest.allowed_origins).toEqual([
          `chrome-extension://${first.result!.extensionId}/`,
        ]);
        const cmd = fs.readFileSync(hostManifest.path, 'utf-8');
        expect(cmd).toContain(process.execPath);
        expect(cmd).toContain(path.join(home, 'mctl.js'));

        expect(run({ action: 'install' }).result!.changed).toBe(false);

        const check = run({ action: 'uninstall', check: 'true' });
        expect(check.result!.changed).toBe(false);
        expect(fs.existsSync(manifestFile)).toBe(true);

        const removed = run({ action: 'uninstall' });
        expect(removed.result!.changed).toBe(true);
        expect(fs.existsSync(stateDir())).toBe(false);
        expect(regValue()).toBeUndefined();
        expect(run({ action: 'uninstall' }).result!.changed).toBe(false);
      });

      it('fails recoverably when mctl is not where the config says', () => {
        const r = run(
          { action: 'install' },
          { 'chrome-bridge.mctlPath': path.join(home, 'nope.js') }
        );
        expect(r.error).toMatchObject({
          code: 'MCTL_NOT_FOUND',
          recoverable: true,
        });
        expect(regValue()).toBeUndefined();
      });

      it('rejects a mctlPath that is not a string', () => {
        const r = run({ action: 'install' }, { 'chrome-bridge.mctlPath': 42 });
        expect(r.error).toMatchObject({
          code: 'CONFIG_INVALID',
          recoverable: true,
        });
      });
    }
  );
});
