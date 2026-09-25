import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** scripts/release.mjs against a throwaway git repository. */

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'release.mjs');

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- a thing

### Planned
- a future thing

---

## [0.2.0] - 2026-02-28

### Added

- older
`;

let root: string;

function git(...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

function release(...args: string[]) {
  return spawnSync(
    process.execPath,
    [SCRIPT, `--root=${root}`, '--skip-verify', ...args],
    { encoding: 'utf8' }
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG);
  for (const dir of ['.', 'packages/core', 'apps/mctl']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(
      path.join(root, dir, 'package.json'),
      '{\n  "name": "x",\n  "version": "0.1.0"\n}\n'
    );
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('release', () => {
  it('moves [Unreleased], bumps every package, commits and tags', () => {
    const r = release('--version=0.3.0');
    expect(r.status, r.stderr).toBe(0);

    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');
    const unreleased = changelog.slice(
      changelog.indexOf('## [Unreleased]'),
      changelog.indexOf('## [0.3.0]')
    );
    expect(unreleased).toContain('### Planned');
    expect(unreleased).not.toContain('a thing\n');
    expect(changelog).toMatch(
      /## \[0\.3\.0\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- a thing/
    );
    expect(changelog.indexOf('## [0.3.0]')).toBeLessThan(
      changelog.indexOf('## [0.2.0]')
    );

    for (const dir of ['.', 'packages/core', 'apps/mctl']) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(root, dir, 'package.json'), 'utf-8')
      );
      expect(pkg.version, dir).toBe('0.3.0');
    }
    expect(git('log', '-1', '--format=%s')).toBe('chore: release v0.3.0');
    expect(git('tag')).toBe('v0.3.0');
    expect(git('status', '--porcelain')).toBe('');
  });

  it('changes nothing on --dry-run', () => {
    const r = release('--version=0.3.0', '--dry-run');
    expect(r.status, r.stderr).toBe(0);
    expect(git('status', '--porcelain')).toBe('');
    expect(git('tag')).toBe('');
  });

  it.each([
    [['--version=0.2.0'], 'not above the last release'],
    [['--version=1.0'], 'is not X.Y.Z'],
    [[], 'missing --version'],
  ])('refuses %j', (args, message) => {
    const r = release(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  });

  it('refuses a dirty tree and a branch other than main', () => {
    fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
    expect(release('--version=0.3.0').stderr).toContain('uncommitted changes');
    fs.rmSync(path.join(root, 'stray.txt'));

    git('checkout', '-q', '-b', 'feature');
    expect(release('--version=0.3.0').stderr).toContain("you are on 'feature'");
  });

  it('refuses when [Unreleased] holds only Planned items', () => {
    expect(release('--version=0.3.0').status).toBe(0);
    const r = release('--version=0.3.1');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no entries');
  });
});
