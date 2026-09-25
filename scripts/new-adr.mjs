// `yarn new:adr --title="…"` — create docs/adr/NNNN-<slug>.md from TEMPLATE.md
// with the next free number, today's date and the header filled in.
//
//   yarn new:adr --title="Tool kinds: task, app, artifact" [--status=Accepted]
//     [--tags=architecture,manifest] [--dry-run]
//
// Numbering is the error-prone part of writing an ADR by hand (two branches
// picking the same number, a skipped one). The content is the author's job;
// see .claude/skills/write-adr/SKILL.md.
//
// --root=<dir> points at another repo root (used by the script's own test).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATUSES = ['Proposed', 'Accepted'];

function fail(message) {
  console.error(`new:adr: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, status: 'Proposed', tags: '' };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    const m = /^--(title|status|tags|root)=(.*)$/s.exec(arg);
    if (!m) {
      fail(
        `unknown argument '${arg}'. Usage: yarn new:adr --title="<decision>" ` +
          `[--status=Proposed|Accepted] [--tags=a,b] [--dry-run]`
      );
    }
    opts[m[1]] = m[2].trim();
  }
  if (!opts.title) fail('missing --title.');
  if (/[\r\n]/.test(opts.title)) fail('--title must be one line.');
  if (!STATUSES.includes(opts.status)) {
    fail(
      `--status must be one of ${STATUSES.join(', ')} (a new ADR is never Deprecated or Superseded).`
    );
  }
  return opts;
}

function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

const opts = parseArgs(process.argv.slice(2));
const root = opts.root ?? fileURLToPath(new URL('..', import.meta.url));
const adrDir = join(root, 'docs', 'adr');
const templatePath = join(adrDir, 'TEMPLATE.md');
if (!existsSync(templatePath)) fail(`${templatePath} not found.`);

const numbers = readdirSync(adrDir)
  .map((f) => /^(\d{4})-.+\.md$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const number = String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(
  4,
  '0'
);
const slug = slugify(opts.title);
if (!slug) fail('--title has no letters or digits to build a file name from.');
const file = join(adrDir, `${number}-${slug}.md`);
const today = new Date().toISOString().slice(0, 10);

let text = readFileSync(templatePath, 'utf-8');
// Everything from the template's own usage notes on is guidance, not content.
const notes = text.indexOf('\n## Notes for Using This Template');
if (notes !== -1) text = text.slice(0, notes).replace(/\n---\s*$/, '\n');
text = text
  .replace(/^# ADR-XXXX: \[Decision Title\]/m, `# ADR-${number}: ${opts.title}`)
  .replace(/^\*\*Status:\*\* .*$/m, `**Status:** ${opts.status}  `)
  .replace(/^\*\*Date:\*\* .*$/m, `**Date:** ${today}  `)
  .replace(/^\*\*Deciders:\*\* .*$/m, '**Deciders:** Michał + Claude  ')
  .replace(
    /^\*\*Tags:\*\* .*$/m,
    `**Tags:** ${opts.tags.split(',').filter(Boolean).join(', ') || 'TODO'}`
  );

if (opts.dryRun) {
  console.log(
    `new:adr (dry run) would create ${relative(root, file)} (${opts.status}, ${today}).`
  );
  process.exit(0);
}
writeFileSync(file, text.trimEnd() + '\n');
console.log(
  `Created ${relative(root, file).split('\\').join('/')}. Fill in every section; delete the ones that do not apply.`
);
