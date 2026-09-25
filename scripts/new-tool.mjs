// `yarn new:tool` — scaffold a tool from templates/<runtime>-tool.
//
//   yarn new:tool --id=jira-sprint --category=work --runtime=node \
//     --description="Summarises the active Jira sprint" [--name="Jira Sprint"] [--dry-run]
//
// Does the mechanical part of "Adding a tool" (AGENTS.md) the same way every
// time: copies the template to tools/<category>/<id>/, fills id, name and
// description into manifest.json, README.md and the entry file, and adds a
// CHANGELOG [Unreleased] entry. Design decisions (config keys, error codes,
// budget) stay with the author — see .claude/skills/add-tool/SKILL.md.
//
// --root=<dir> points at another repo root (used by the scaffolder's own test).

import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNTIMES_WITH_TEMPLATE = ['node', 'python'];
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENTRY = { node: 'index.js', python: 'main.py' };

function fail(message) {
  console.error(`new:tool: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    const m = /^--(id|category|runtime|name|description|root)=(.*)$/s.exec(arg);
    if (!m) {
      fail(
        `unknown argument '${arg}'. Usage: yarn new:tool --id=<kebab-id> ` +
          `--category=<kebab-category> --runtime=<node|python> ` +
          `--description="<one line>" [--name="<display name>"] [--dry-run]`
      );
    }
    opts[m[1]] = m[2].trim();
  }
  return opts;
}

function titleCase(id) {
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** id -> manifest path, for every tool under <root>/tools. */
function existingToolIds(toolsRoot) {
  const ids = new Map();
  if (!existsSync(toolsRoot)) return ids;
  for (const category of readdirSync(toolsRoot, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(toolsRoot, category.name);
    for (const tool of readdirSync(categoryDir, { withFileTypes: true })) {
      const manifestPath = join(categoryDir, tool.name, 'manifest.json');
      if (!tool.isDirectory() || !existsSync(manifestPath)) continue;
      try {
        ids.set(JSON.parse(readFileSync(manifestPath, 'utf-8')).id, manifestPath);
      } catch {
        // An unreadable manifest is reported by the conformance tests; here it
        // just cannot collide.
      }
    }
  }
  return ids;
}

function validate(opts, root) {
  const missing = ['id', 'category', 'runtime', 'description'].filter((k) => !opts[k]);
  if (missing.length > 0) fail(`missing --${missing.join(', --')}.`);
  if (!KEBAB.test(opts.id)) fail(`--id '${opts.id}' must be kebab-case (e.g. jira-sprint).`);
  if (!KEBAB.test(opts.category)) {
    fail(`--category '${opts.category}' must be kebab-case (e.g. work, artifacts, misc).`);
  }
  if (!RUNTIMES_WITH_TEMPLATE.includes(opts.runtime)) {
    fail(
      `no template for runtime '${opts.runtime}'. Templates exist for ` +
        `${RUNTIMES_WITH_TEMPLATE.join(', ')}. For powershell, copy the closest ` +
        `existing tool (tools/artifacts/stream-deck) by hand and follow AGENTS.md.`
    );
  }
  if (/[\r\n]/.test(opts.description)) fail('--description must be one line.');

  const taken = existingToolIds(join(root, 'tools')).get(opts.id);
  if (taken) fail(`tool id '${opts.id}' is already used by ${relative(root, taken)}.`);
  const target = join(root, 'tools', opts.category, opts.id);
  if (existsSync(target)) fail(`${relative(root, target)} already exists.`);
  return target;
}

function replaceInFile(file, replacements) {
  let text = readFileSync(file, 'utf-8');
  for (const [from, to] of replacements) text = text.split(from).join(to);
  writeFileSync(file, text);
}

function addChangelogEntry(changelogPath, line) {
  const text = readFileSync(changelogPath, 'utf-8');
  const unreleased = text.indexOf('## [Unreleased]');
  if (unreleased === -1) {
    fail(`${changelogPath} has no '## [Unreleased]' section; add one, then re-run.`);
  }
  const nextRelease = text.indexOf('\n## [', unreleased + 1);
  const sectionEnd = nextRelease === -1 ? text.length : nextRelease;
  const added = text.indexOf('### Added', unreleased);

  let updated;
  if (added !== -1 && added < sectionEnd) {
    const insertAt = text.indexOf('\n', added) + 1;
    updated = `${text.slice(0, insertAt)}\n${line}\n${text.slice(insertAt)}`;
  } else {
    const insertAt = text.indexOf('\n', unreleased) + 1;
    updated = `${text.slice(0, insertAt)}\n### Added\n\n${line}\n${text.slice(insertAt)}`;
  }
  writeFileSync(changelogPath, updated.replace(/\n{3,}/g, '\n\n'));
}

const opts = parseArgs(process.argv.slice(2));
const root = opts.root ?? fileURLToPath(new URL('..', import.meta.url));
const target = validate(opts, root);
const name = opts.name || titleCase(opts.id);
const description = opts.description.replace(/\.$/, '');
const rel = relative(root, target).split('\\').join('/');
const template = join(root, 'templates', `${opts.runtime}-tool`);
const changelogLine = `- **\`${opts.id}\` tool** (\`${rel}/\`): ${description}.`;

if (opts.dryRun) {
  console.log(`new:tool (dry run) would:`);
  console.log(`  copy    ${relative(root, template)}/ -> ${rel}/`);
  console.log(`  set     manifest id=${opts.id}, name="${name}", description="${description}"`);
  console.log(`  add     CHANGELOG.md [Unreleased] ${changelogLine}`);
  process.exit(0);
}

cpSync(template, target, {
  recursive: true,
  filter: (src) => !/(__pycache__|node_modules)/.test(src),
});

const manifestPath = join(target, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
Object.assign(manifest, { id: opts.id, name, description });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

replaceInFile(join(target, 'README.md'), [
  ['> One-line description of what this tool does.', `> ${description}.`],
  ['tool-id', opts.id],
]);
replaceInFile(join(target, ENTRY[opts.runtime]), [['tool-id', opts.id]]);
addChangelogEntry(join(root, 'CHANGELOG.md'), changelogLine);

console.log(`Created ${rel}/ from ${relative(root, template)}/:`);
for (const f of readdirSync(target, { recursive: true })) console.log(`  ${rel}/${String(f).split('\\').join('/')}`);
console.log(`Added to CHANGELOG.md [Unreleased]: ${changelogLine}`);
console.log(`
Next (the add-tool skill walks through these):
  1. manifest.json: requiredConfig / optionalConfig / timeoutMs / tags
  2. ${ENTRY[opts.runtime]}: implement; fail with ToolFailure for expected errors
  3. test/protocol.test.ts: VALID_CONFIG plus a test per input rule and error code
  4. test/smoke-config.json if the tool has requiredConfig
  5. README.md: usage, every config key, external dependencies
  6. yarn verify`);
