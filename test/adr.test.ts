import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** ADR numbering and headers, and the script that creates new ADRs. */

const REPO_ROOT = path.resolve(__dirname, '..');
const ADR_DIR = path.join(REPO_ROOT, 'docs', 'adr');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'new-adr.mjs');
const STATUS =
  /^\*\*Status:\*\* (Proposed|Accepted|Deprecated|Superseded by \[?ADR-\d{4}\b)/m;

const adrs = fs
  .readdirSync(ADR_DIR)
  .filter((f) => /^\d{4}-.+\.md$/.test(f))
  .sort();

describe('docs/adr', () => {
  it('numbers ADRs 0001… without gaps or duplicates', () => {
    const numbers = adrs.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it.each(adrs)('%s has a matching title and a valid status', (file) => {
    const text = fs.readFileSync(path.join(ADR_DIR, file), 'utf-8');
    expect(text.split('\n')[0]).toMatch(
      new RegExp(`^# ADR-${file.slice(0, 4)}: \\S`)
    );
    expect(text).toMatch(STATUS);
  });
});

describe('new:adr', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'new-adr-'));
    fs.mkdirSync(path.join(root, 'docs'));
    fs.cpSync(ADR_DIR, path.join(root, 'docs', 'adr'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function newAdr(...args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], {
      encoding: 'utf8',
    });
  }

  it('creates the next ADR from the template, header filled, guidance removed', () => {
    const r = newAdr('--title=Use Zod for config', '--tags=config,validation');
    expect(r.status, r.stderr).toBe(0);

    const next = String(adrs.length + 1).padStart(4, '0');
    const file = path.join(
      root,
      'docs',
      'adr',
      `${next}-use-zod-for-config.md`
    );
    const text = fs.readFileSync(file, 'utf-8');
    expect(text.split('\n')[0]).toBe(`# ADR-${next}: Use Zod for config`);
    expect(text).toMatch(/^\*\*Status:\*\* Proposed/m);
    expect(text).toMatch(/^\*\*Date:\*\* \d{4}-\d{2}-\d{2}/m);
    expect(text).toMatch(/^\*\*Tags:\*\* config, validation$/m);
    expect(text).not.toContain('Notes for Using This Template');
  });

  it.each([
    [[], 'missing --title'],
    [['--title=X', '--status=Superseded'], '--status must be one of'],
    [['--title=!!!'], 'no letters or digits'],
  ])('refuses %j', (args, message) => {
    const r = newAdr(...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
  });
});
