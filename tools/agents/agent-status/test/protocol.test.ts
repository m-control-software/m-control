import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectProtocol,
  expectRecoverableError,
  runTool,
} from '@m-control/test-support';

/**
 * Runs agent-status against a sandbox: HOME and every provider directory point
 * into a temp dir, and no API tokens are configured, so the test never reads
 * the machine's real sessions or calls a network API.
 */

const TOOL_DIR = path.resolve(__dirname, '..');

let sandbox: string;

function run(input: Record<string, string>) {
  return runTool(TOOL_DIR, {
    config: {
      'agent-status.claudeProjectsDir': path.join(sandbox, 'claude'),
      'agent-status.codexSessionsDir': path.join(sandbox, 'codex'),
      'agent-status.cursorIdeDir': path.join(sandbox, 'cursor'),
    },
    input,
    workspaceRoot: sandbox,
    env: { ...process.env, HOME: sandbox, USERPROFILE: sandbox },
  });
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('agent-status', () => {
  it('reports an empty dashboard when no provider has sessions', () => {
    const r = run({});
    expectProtocol(r, 'agent-status');
    expect(r.result?.summary).toEqual({
      total: 0,
      awaitingInput: 0,
      working: 0,
      failed: 0,
    });
  });

  it('reports a Claude Code session being written right now as working', () => {
    const project = path.join(sandbox, 'claude', 'proj');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'abcdef1234.jsonl'),
      JSON.stringify({ cwd: '/work/demo', type: 'user' }) + '\n'
    );

    const r = run({ providers: 'claude-code' });
    expectProtocol(r, 'agent-status');
    const agents = r.result?.agents as Array<Record<string, unknown>>;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      provider: 'claude-code',
      id: 'abcdef12',
      title: '/work/demo',
      status: 'working',
    });
  });

  it('rejects an unknown provider as a recoverable input error', () => {
    const r = run({ providers: 'nope' });
    expectRecoverableError(r, 'agent-status');
    expect(r.error?.code).toBe('BAD_INPUT');
    expect(String(r.error?.message)).toContain('nope');
  });
});
