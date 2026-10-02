import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Guards how 'script' keys launch.
 *
 * Stream Deck's 'Open Application' action drops its args array on Windows and
 * only focuses an already-running pwsh, so a script key built on it opened a
 * bare shell or did nothing. Script keys are an 'Open' action on a generated
 * .vbs launcher instead; these tests pin that shape.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

function ps(snippet: string): string {
  const script = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    foreach ($f in @('Spec.ps1','Uuid5.ps1','Actions.ps1','Generate.ps1')) {
      . (Join-Path '${TOOL_DIR.replace(/'/g, "''")}' (Join-Path 'lib' $f))
    }
    ${snippet}
  `;
  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`powershell failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

const q = (s: string) => s.replace(/'/g, "''");

windowsOnly('stream-deck script launchers', () => {
  let packDir: string;
  let launchersDir: string;

  beforeEach(() => {
    packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-pack-'));
    launchersDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'sd-launch-')),
      'launchers'
    );
    fs.mkdirSync(path.join(packDir, 'scripts'));
    fs.writeFileSync(path.join(packDir, 'scripts', 'Do-Thing.ps1'), '"hi"');
  });

  afterEach(() => {
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(launchersDir), { recursive: true, force: true });
  });

  const buildAction = `
    $ctx = @{
      ResolvedApps = @{ pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }
      PackDir      = '__PACK__'
      LaunchersDir = '__LAUNCH__'
      Launchers    = [ordered]@{}
    }
    $spec = [pscustomobject]@{ type = 'script'; script = 'scripts/Do-Thing.ps1'; title = 'Do' }
    $a = New-DeckAction -Action $spec -ActionId 'id' -Context $ctx
  `;
  const withDirs = (s: string) =>
    s.replace('__PACK__', q(packDir)).replace('__LAUNCH__', q(launchersDir));

  it('emits an Open action on a .vbs launcher, not Open Application', () => {
    const out = JSON.parse(
      ps(
        withDirs(buildAction) +
          `
        [ordered]@{
          uuid = $a.UUID; path = $a.Settings.path
          keys = @($ctx.Launchers.Keys); content = $ctx.Launchers[$a.Settings.path]
        } | ConvertTo-Json -Compress
      `
      )
    );
    expect(out.uuid).toBe('com.elgato.streamdeck.system.open');
    expect(path.dirname(out.path)).toBe(launchersDir);
    expect(out.path).toMatch(/Do-Thing-[0-9a-f]{8}\.vbs$/);
    expect(out.keys).toEqual([out.path]);

    const script = path.join(packDir, 'scripts', 'Do-Thing.ps1');
    expect(out.content).toContain(
      `""C:\\Program Files\\PowerShell\\7\\pwsh.exe"" -NoLogo -NoProfile -File ""${script}""`
    );
    expect(out.content).toMatch(/\.Run ".*", 1, False/);
  }, 60_000);

  it('names the launcher deterministically', () => {
    const out = ps(
      withDirs(buildAction) +
        `
      $first = $a.Settings.path
      $a = New-DeckAction -Action $spec -ActionId 'id' -Context $ctx
      $first -eq $a.Settings.path
    `
    );
    expect(out).toBe('True');
  }, 60_000);

  it('writes launchers as UTF-16 and prunes only stale ones', () => {
    fs.mkdirSync(launchersDir, { recursive: true });
    const stale = path.join(launchersDir, 'Old-00000000.vbs');
    const other = path.join(launchersDir, 'notes.txt');
    fs.writeFileSync(stale, 'x');
    fs.writeFileSync(other, 'x');

    const out = ps(
      withDirs(buildAction) +
        `
      Write-DeckLaunchers -Dir '__LAUNCH__' -Launchers $ctx.Launchers
      $removed = @(Remove-StaleDeckLaunchers -Dir '__LAUNCH__' -Launchers $ctx.Launchers)
      [ordered]@{ path = $a.Settings.path; removed = $removed } | ConvertTo-Json -Compress
    `.replace(/__LAUNCH__/g, q(launchersDir))
    );
    const { path: launcher, removed } = JSON.parse(out);

    const bytes = fs.readFileSync(launcher);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
    expect(bytes.toString('utf16le')).toContain('WScript.Shell');
    expect([removed].flat().map((p: string) => path.basename(p))).toEqual([
      path.basename(stale),
    ]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
  }, 60_000);
});
