import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Agents follow the paths the docs give them. A moved file with a stale link
 * sends them to read something that no longer exists, or worse, to recreate
 * it. These checks keep the docs' references pointing at real files.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/** Top-level directories whose paths, when quoted in agent docs, must exist. */
const ROOTED = [
  'packages/',
  'apps/',
  'tools/',
  'templates/',
  'docs/',
  'scripts/',
  'test/',
  'test-support/',
  '.claude/',
  '.github/',
  '.cursor/',
];

/** Personal, git-ignored files the docs mention but the repo never contains. */
const PERSONAL = new Set(['.claude/settings.local.json']);

function markdownFiles(dir = REPO_ROOT): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function withoutCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

describe('markdown links', () => {
  it.each(markdownFiles().map((f) => [path.relative(REPO_ROOT, f), f]))(
    '%s: relative links resolve',
    (_rel, file) => {
      const text = withoutCodeBlocks(fs.readFileSync(file, 'utf-8'));
      const broken: string[] = [];
      for (const [, target] of text.matchAll(
        /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
      )) {
        if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
        const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
        if (!fs.existsSync(resolved)) broken.push(target);
      }
      expect(broken).toEqual([]);
    }
  );
});

describe('paths quoted in agent instructions', () => {
  const agentDocs = [
    'AGENTS.md',
    'CLAUDE.md',
    'REVIEW.md',
    '.cursor/rules/m-control.mdc',
    '.github/copilot-instructions.md',
    ...fs
      .readdirSync(path.join(REPO_ROOT, '.claude/skills'), {
        recursive: true,
        encoding: 'utf-8',
      })
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.join('.claude/skills', f)),
  ].filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));

  it.each(agentDocs)('%s', (doc) => {
    const text = fs.readFileSync(path.join(REPO_ROOT, doc), 'utf-8');
    const missing = [...text.matchAll(/`([^`\s]+)`/g)]
      .map(([, p]) => p)
      .filter(
        (p) =>
          ROOTED.some((r) => p.startsWith(r)) &&
          !/[<>*{}$…]/.test(p) &&
          !PERSONAL.has(p)
      )
      .map((p) => p.replace(/[:.,]+$/, '').replace(/:\d+$/, ''))
      .filter((p) => !fs.existsSync(path.join(REPO_ROOT, p)));
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('project skills', () => {
  const skillsDir = path.join(REPO_ROOT, '.claude/skills');
  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it('exist', () => {
    expect(skills.length).toBeGreaterThan(0);
  });

  it.each(skills)('%s has frontmatter naming it, and a description', (name) => {
    const file = path.join(skillsDir, name, 'SKILL.md');
    expect(fs.existsSync(file), file).toBe(true);
    const text = fs.readFileSync(file, 'utf-8');
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(
      frontmatter,
      'SKILL.md must start with --- frontmatter ---'
    ).not.toBeNull();
    const fields = Object.fromEntries(
      frontmatter![1]
        .split('\n')
        .map((l) => /^(\w+):\s*(.*)$/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1], m[2]])
    );
    expect(fields.name).toBe(name);
    expect((fields.description ?? '').length).toBeGreaterThan(40);
  });

  it('are all indexed in AGENTS.md', () => {
    const agents = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf-8');
    expect(skills.filter((s) => !agents.includes(`\`${s}\``))).toEqual([]);
  });
});

describe('module aliases', () => {
  it('vitest.config.ts and tsconfig.json map the same aliases', () => {
    const vitest = fs.readFileSync(
      path.join(REPO_ROOT, 'vitest.config.ts'),
      'utf-8'
    );
    const tsconfig = fs.readFileSync(
      path.join(REPO_ROOT, 'tsconfig.json'),
      'utf-8'
    );
    const aliasKeys = (text: string) =>
      [...text.matchAll(/'(@m-control\/[a-z-]+)'|"(@m-control\/[a-z-]+)"/g)]
        .map((m) => m[1] ?? m[2])
        .sort();
    expect(aliasKeys(vitest)).toEqual(aliasKeys(tsconfig));
    expect(aliasKeys(vitest).length).toBeGreaterThan(0);
  });
});
