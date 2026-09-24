import { spawnSync } from 'child_process';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards app resolution, and in particular Store apps.
 *
 * C:\Program Files\WindowsApps denies directory enumeration to everyone, so a
 * glob candidate under it can never match even though Test-Path on the full
 * path of the same file returns true. The Snipping Tool silently fell back to
 * the %LOCALAPPDATA% shim and lost is_bundle/bundle_id, which is what the
 * Stream Deck app needs to launch a packaged app. These tests pin the
 * behaviour that replaced the glob.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

/** Dot-sources the tool's libraries and evaluates a snippet under 5.1 rules. */
function ps(snippet: string): string {
  const script = `
    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'
    foreach ($f in @('Spec.ps1','AppResolver.ps1')) {
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

windowsOnly('stream-deck app resolution', () => {
  it('returns a path and no bundle id for an ordinary app', () => {
    const out = ps(`
      $d = @{ candidates = @('%SYSTEMROOT%\\System32\\notepad.exe') }
      $hit = Resolve-DeckApp -Definition $d
      "$($hit.Path)|$($null -eq $hit.BundleId)"
    `);
    const [resolved, noBundle] = out.split('|');
    expect(resolved.toLowerCase()).toContain('notepad.exe');
    expect(noBundle).toBe('True');
  }, 60_000);

  it('cannot resolve a Store app by globbing WindowsApps', () => {
    // The premise of the appx branch. If this ever starts matching, the extra
    // machinery can go away - so assert the constraint rather than assume it.
    const out = ps(`
      @(Resolve-Path 'C:\\Program Files\\WindowsApps\\Microsoft.*\\*.exe' -ErrorAction SilentlyContinue).Count
    `);
    expect(out).toBe('0');
  }, 60_000);

  it('resolves a Store app through its package family and reports its AUMID', () => {
    const out = ps(`
      $d = @{ appx = @{
        package = 'Microsoft.ScreenSketch'
        exe     = 'SnippingTool\\SnippingTool.exe'
        aumid   = 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App'
      } }
      $hit = Resolve-DeckApp -Definition $d
      if ($null -eq $hit) { 'NOTINSTALLED' } else { "$($hit.Path)|$($hit.BundleId)" }
    `);
    if (out === 'NOTINSTALLED') return; // Snipping Tool is removable.

    const [resolved, bundleId] = out.split('|');
    expect(resolved).toMatch(/WindowsApps/i);
    expect(resolved.toLowerCase().endsWith('snippingtool.exe')).toBe(true);
    expect(bundleId).toBe('Microsoft.ScreenSketch_8wekyb3d8bbwe!App');
  }, 60_000);

  it('falls back to candidates when the package is not installed', () => {
    const out = ps(`
      $d = @{
        appx       = @{ package = 'No.Such.Package.Exists'; exe = 'x.exe'; aumid = 'a!b' }
        candidates = @('%SYSTEMROOT%\\System32\\notepad.exe')
      }
      $hit = Resolve-DeckApp -Definition $d
      "$($hit.Path)|$($null -eq $hit.BundleId)"
    `);
    const [resolved, noBundle] = out.split('|');
    expect(resolved.toLowerCase()).toContain('notepad.exe');
    expect(noBundle).toBe('True');
  }, 60_000);

  it('reports an app as missing rather than guessing', () => {
    const out = ps(`
      $d = @{ candidates = @('C:\\nope\\does-not-exist.exe') }
      $null -eq (Resolve-DeckApp -Definition $d)
    `);
    expect(out).toBe('True');
  }, 60_000);
});
