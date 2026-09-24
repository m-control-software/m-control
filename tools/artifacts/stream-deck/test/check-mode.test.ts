import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Guards the check-mode safety valve.
 *
 * The flag arrives as ToolInput (mctl's parseArgs discards anything starting
 * with '--'), and its value is a STRING, so "false" must not be read as truthy.
 * If either of those regresses, `mctl run stream-deck check=true` silently
 * performs a real install over the user's live profile - which is why this is
 * a test rather than a note in the README.
 */

const TOOL_DIR = path.resolve(__dirname, '..');
const ENTRY = path.join(TOOL_DIR, 'main.ps1');

// The tool is Windows-only: it drives %APPDATA%\Elgato and System.Drawing.
const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

interface ToolEvent {
  type: string;
  toolId: string;
  payload: Record<string, unknown>;
}

function runTool(
  config: Record<string, string>,
  input: Record<string, string>
): { events: ToolEvent[]; status: number | null; stdout: string } {
  const request = JSON.stringify({
    context: { config, workspaceRoot: TOOL_DIR },
    input,
  });

  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-File', ENTRY],
    { input: request, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );

  const events = result.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ToolEvent);

  return { events, status: result.status, stdout: result.stdout };
}

/** Content hash of every file under dir, keyed by relative path. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out[path.relative(dir, full)] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(full))
          .digest('hex');
      }
    }
  };
  walk(dir);
  return out;
}

windowsOnly('stream-deck check mode', () => {
  let profilesRoot: string;

  beforeEach(() => {
    profilesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-profiles-'));
    // One existing bundle, purely so the device serial is discoverable.
    const bundle = path.join(
      profilesRoot,
      'FIXTURE0-0000-0000-0000-000000000000.sdProfile'
    );
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(
      path.join(bundle, 'manifest.json'),
      JSON.stringify({
        Device: { Model: '20GBL9901', UUID: '@(1)[0000/000/FIXTURE]' },
        Name: 'Fixture',
        Pages: {
          Current: '00000000-0000-0000-0000-0000000000aa',
          Default: '00000000-0000-0000-0000-0000000000aa',
          Pages: ['00000000-0000-0000-0000-0000000000aa'],
        },
        Version: '3.0',
      })
    );
  });

  afterEach(() => {
    fs.rmSync(profilesRoot, { recursive: true, force: true });
  });

  it('writes nothing to the profiles root', () => {
    const before = snapshot(profilesRoot);

    const { events, status } = runTool(
      {
        'stream-deck.profileName': 'MCtl Test',
        'stream-deck.profilesRoot': profilesRoot,
      },
      { check: 'true' }
    );

    expect(status).toBe(0);

    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    expect(result!.payload.mode).toBe('check');
    expect(result!.payload.installed).toBe(false);

    expect(snapshot(profilesRoot)).toEqual(before);
  });

  it('treats check=false as a real run, not as truthy', () => {
    const { events } = runTool(
      {
        'stream-deck.profileName': 'MCtl Test',
        'stream-deck.profilesRoot': profilesRoot,
      },
      { check: 'false' }
    );

    // It must NOT report check mode. Whether it then installs or is blocked by
    // a running Stream Deck app is environment-dependent and not asserted here.
    expect(
      events.some((e) => e.type === 'result' && e.payload.mode === 'check')
    ).toBe(false);
  });

  it('rejects an uninterpretable flag value instead of guessing', () => {
    const { events, status } = runTool(
      {
        'stream-deck.profileName': 'MCtl Test',
        'stream-deck.profilesRoot': profilesRoot,
      },
      { check: 'banana' }
    );

    expect(status).toBe(1);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(String(err!.payload.message)).toContain('banana');
  });

  it('emits only NDJSON ToolEvent lines on stdout', () => {
    const { stdout } = runTool(
      {
        'stream-deck.profileName': 'MCtl Test',
        'stream-deck.profilesRoot': profilesRoot,
      },
      { check: 'true' }
    );

    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const evt = JSON.parse(line) as ToolEvent;
      expect(['started', 'log', 'result', 'error']).toContain(evt.type);
      expect(evt.toolId).toBe('stream-deck');
    }
  });
});
