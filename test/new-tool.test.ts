import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTools } from '@m-control/core';
import {
  expectProtocol,
  expectRecoverableError,
  runTool,
  runtimeAvailable,
} from '@m-control/test-support';

/**
 * The scaffolder (scripts/new-tool.mjs) and the templates it copies. A tool
 * generated from a template must be valid and protocol-conformant before
 * anyone edits it: whatever is wrong here is copied into every new tool.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'new-tool.mjs');

let root: string;

function scaffold(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], {
    encoding: 'utf8',
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-tool-'));
  fs.cpSync(path.join(REPO_ROOT, 'templates'), path.join(root, 'templates'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- something\n\n## [0.1.0]\n'
  );
  const existing = path.join(root, 'tools', 'misc', 'taken');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(
    path.join(existing, 'manifest.json'),
    JSON.stringify({
      manifestVersion: 1,
      id: 'taken-id',
      version: '0.1.0',
      name: 'Taken',
      description: 'Occupies an id',
      runtime: 'node',
      entry: 'index.js',
    })
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe.each(['node', 'python'])('new:tool --runtime=%s', (runtime) => {
  const id = `demo-${runtime}`;
  const toolDir = () => path.join(root, 'tools', 'work', id);

  it('creates a valid tool with the id filled in everywhere', () => {
    const r = scaffold(
      `--id=${id}`,
      '--category=work',
      `--runtime=${runtime}`,
      '--description=Does the demo thing.'
    );
    expect(r.status, r.stderr).toBe(0);

    const { tools, errors } = discoverTools(path.join(root, 'tools'));
    expect(errors).toEqual([]);
    const tool = tools.find((t) => t.manifest.id === id);
    expect(tool).toBeDefined();
    expect(tool!.manifest.name).toBe(
      `Demo ${runtime[0].toUpperCase()}${runtime.slice(1)}`
    );
    expect(tool!.manifest.description).toBe('Does the demo thing');

    for (const f of fs.readdirSync(toolDir(), { recursive: true })) {
      const file = path.join(toolDir(), String(f));
      if (fs.statSync(file).isFile()) {
        expect(fs.readFileSync(file, 'utf-8'), String(f)).not.toContain(
          'tool-id'
        );
      }
    }
    expect(
      fs.existsSync(path.join(toolDir(), 'test', 'protocol.test.ts'))
    ).toBe(true);

    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');
    const unreleased = changelog.slice(0, changelog.indexOf('## [0.1.0]'));
    expect(unreleased).toContain('### Added');
    expect(unreleased).toContain(
      `**\`${id}\` tool** (\`tools/work/${id}/\`): Does the demo thing.`
    );
  });

  it.skipIf(
    !runtimeAvailable(path.join(REPO_ROOT, 'templates', `${runtime}-tool`))
  )('generates a tool that runs and enforces its requiredConfig', () => {
    expect(
      scaffold(
        `--id=${id}`,
        '--category=work',
        `--runtime=${runtime}`,
        '--description=Demo'
      ).status
    ).toBe(0);

    const ok = runTool(toolDir(), { input: { name: 'x' } });
    expectProtocol(ok, id);
    expect(ok.status).toBe(0);

    const malformed = runTool(toolDir(), { stdin: 'not json' });
    expectProtocol(malformed, id);
    expect(malformed.error?.code).toBe('INVALID_REQUEST');
    expect(malformed.error?.recoverable).toBe(false);

    // Declaring a key is all it takes for the template to enforce it.
    const manifestPath = path.join(toolDir(), 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    manifest.requiredConfig = [`${id}.token`];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const missing = runTool(toolDir(), { config: { [`${id}.token`]: '' } });
    expectRecoverableError(missing, id);
    expect(missing.error?.code).toBe('CONFIG_MISSING');
    expect(String(missing.error?.message)).toContain(`tools.${id}.token`);

    const supplied = runTool(toolDir(), { config: { [`${id}.token`]: 't' } });
    expectProtocol(supplied, id);
    expect(supplied.status).toBe(0);
  });
});

describe('new:tool refuses', () => {
  it.each([
    [
      ['--id=Bad_Id', '--category=work', '--runtime=node', '--description=x'],
      'kebab-case',
    ],
    [
      ['--id=taken-id', '--category=work', '--runtime=node', '--description=x'],
      'already used',
    ],
    [
      [
        '--id=ps-tool',
        '--category=work',
        '--runtime=powershell',
        '--description=x',
      ],
      'no template',
    ],
    [
      ['--id=no-desc', '--category=work', '--runtime=node'],
      'missing --description',
    ],
    [['--bogus'], 'unknown argument'],
  ])('%j', (args, message) => {
    const r = scaffold(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  });

  it('writes nothing on --dry-run', () => {
    const r = scaffold(
      '--id=dry',
      '--category=work',
      '--runtime=node',
      '--description=x',
      '--dry-run'
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(root, 'tools', 'work'))).toBe(false);
    expect(
      fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8')
    ).not.toContain('dry');
  });
});
