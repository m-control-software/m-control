import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The Claude Code hooks in .claude/hooks must never break an agent's turn. */

const HOOKS = path.resolve(__dirname, '..', '.claude', 'hooks');

function hook(name: string, stdin: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

describe('format-edited-file', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'format-hook-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('formats an edited TypeScript file', () => {
    const file = path.join(dir, 'a.ts');
    fs.writeFileSync(file, 'const  a={b:1}\n');
    const r = hook(
      'format-edited-file.mjs',
      JSON.stringify({ tool_input: { file_path: file } })
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe('const a = { b: 1 };\n');
  });

  it.each([
    ['a non-code file', 'notes.md', '#  keep   as is\n'],
    [
      'a file under node_modules',
      path.join('node_modules', 'x.js'),
      'var  x=1\n',
    ],
  ])('leaves %s untouched', (_label, rel, content) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    const r = hook(
      'format-edited-file.mjs',
      JSON.stringify({ tool_input: { file_path: file } })
    );
    expect(r.status).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
  });

  it('exits 0 on input it does not understand, or a file it cannot parse', () => {
    expect(hook('format-edited-file.mjs', 'not json').status).toBe(0);
    const file = path.join(dir, 'broken.ts');
    fs.writeFileSync(file, 'const = ;\n');
    const r = hook(
      'format-edited-file.mjs',
      JSON.stringify({ tool_input: { file_path: file } })
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('could not format');
    expect(fs.readFileSync(file, 'utf-8')).toBe('const = ;\n');
  });
});

describe('session-start', () => {
  it('does nothing outside a cloud session', () => {
    const r = hook('session-start.mjs', '', { CLAUDE_CODE_REMOTE: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
});
