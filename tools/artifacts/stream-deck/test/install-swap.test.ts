import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Guards the crash safety of the profile swap.
 *
 * Install used to delete the live bundle and then move the staged one in. A
 * kill in that window - and on Windows a kill is TerminateProcess, so no catch
 * and no finally runs - left the user with NO profile installed. Renaming the
 * old bundle aside instead narrows the window to two same-volume renames.
 *
 * It does not close it: Windows has no atomic directory swap. So the recovery
 * path matters too, and is covered here.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'fixtures', 'Invoke-InstallScenario.ps1');

// The tool is Windows-only: it drives %APPDATA%\Elgato and System.Drawing.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

function runScenario(scenario: string, workDir: string): Record<string, unknown> {
  const result = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      HARNESS,
      '-Scenario',
      scenario,
      '-WorkDir',
      workDir,
    ],
    { encoding: 'utf8', cwd: TOOL_DIR, maxBuffer: 32 * 1024 * 1024 }
  );

  if (result.status !== 0) {
    throw new Error(
      `Scenario '${scenario}' failed (exit ${result.status}):\n${result.stderr}`
    );
  }

  const line = result.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .pop();

  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

windowsOnly('stream-deck install swap', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-install-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('installs into an empty profiles root without a backup', () => {
    const r = runScenario('fresh', workDir);
    expect(r.installed).toBe('v1');
    expect(r.asides).toBe(0);
    expect(r.hasBackup).toBe(false);
  }, 60_000);

  it('replaces an existing bundle, backs it up and leaves no aside behind', () => {
    const r = runScenario('replace', workDir);
    expect(r.installed).toBe('v2');
    expect(r.asides).toBe(0);
    expect(r.backupMarker).toBe('v1');
    // Two installs inside one second must not nest one backup in the other.
    expect(r.backupIsFlat).toBe(true);
  }, 60_000);

  it('recovers a bundle orphaned under its aside name by a killed run', () => {
    const r = runScenario('recover-orphan', workDir);
    expect(r.markerWhileCrashed).toBeNull();
    expect(r.asidesWhileCrashed).toBe(1);

    expect(r.installed).toBe('v3');
    expect(r.asides).toBe(0);
    // The orphan was restored and backed up, not silently discarded.
    expect(r.backupMarker).toBe('v2');
  }, 60_000);

  it('restores the previous bundle when the swap fails partway', () => {
    const r = runScenario('rollback', workDir);
    expect(r.threw).toBe(true);
    expect(r.installed).toBe('v1');
    expect(r.asides).toBe(0);
  }, 60_000);
});
