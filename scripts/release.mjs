// `yarn release --version=X.Y.Z` — cut a release the same way every time
// (ADR-0012: known-good = a tag on main).
//
//   yarn release --version=0.3.0 --dry-run   show what would change
//   yarn release --version=0.3.0             do it (does not push)
//
// Steps, stopping at the first failure:
//   1. checks: on `main`, clean tree, version is semver and above the last
//      released one, [Unreleased] has entries, tag does not exist
//   2. CHANGELOG.md: [Unreleased] -> [X.Y.Z] - today, fresh [Unreleased];
//      a `### Planned` subsection stays in [Unreleased] (it is not a change)
//   3. version in package.json, packages/*/package.json, apps/*/package.json
//   4. yarn verify
//   5. commit "chore: release vX.Y.Z" and annotated tag vX.Y.Z
// Pushing is left to the person: `git push origin main vX.Y.Z`.
//
// --root=<dir> and --skip-verify exist for the script's own tests.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, skipVerify: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--skip-verify') opts.skipVerify = true;
    else if (/^--(version|root)=/.test(arg)) {
      const [key, value] = arg.slice(2).split(/=(.*)/s);
      opts[key] = value;
    } else {
      fail(
        `unknown argument '${arg}'. Usage: yarn release --version=X.Y.Z [--dry-run]`
      );
    }
  }
  if (!opts.version) fail('missing --version=X.Y.Z.');
  return opts;
}

function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) {
    fail(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  }
  return r;
}

function compareSemver(a, b) {
  const pa = SEMVER.exec(a).slice(1).map(Number);
  const pb = SEMVER.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Splits CHANGELOG.md around its [Unreleased] section. */
function parseChangelog(text) {
  const start = text.indexOf('## [Unreleased]');
  if (start === -1) fail("CHANGELOG.md has no '## [Unreleased]' section.");
  const bodyStart = text.indexOf('\n', start) + 1;
  const next = text.indexOf('\n## [', bodyStart);
  const end = next === -1 ? text.length : next + 1;
  const lastRelease = /^## \[(\d+\.\d+\.\d+)\]/m.exec(text.slice(end));
  return {
    before: text.slice(0, start),
    body: text.slice(bodyStart, end),
    after: text.slice(end),
    lastVersion: lastRelease ? lastRelease[1] : null,
  };
}

/** Separates `### Planned` (stays unreleased) from real change entries. */
function splitPlanned(body) {
  const planned = /^### Planned\n[\s\S]*?(?=^### |^---\s*$|(?![\s\S]))/m.exec(
    body
  );
  if (!planned) return { changes: body, planned: '' };
  return {
    changes:
      body.slice(0, planned.index) +
      body.slice(planned.index + planned[0].length),
    planned: planned[0],
  };
}

function packageJsonPaths(root) {
  const paths = [join(root, 'package.json')];
  for (const group of ['packages', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(p)) paths.push(p);
    }
  }
  return paths;
}

const opts = parseArgs(process.argv.slice(2));
const root = opts.root ?? fileURLToPath(new URL('..', import.meta.url));
const { version } = opts;
const tag = `v${version}`;
const today = new Date().toISOString().slice(0, 10);

// ---- 1. Checks ------------------------------------------------------------
if (!SEMVER.test(version)) fail(`'${version}' is not X.Y.Z.`);
const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (branch !== 'main')
  fail(`releases are tagged on main (ADR-0012); you are on '${branch}'.`);
if (git(root, ['status', '--porcelain']).stdout.trim() !== '') {
  fail('the working tree has uncommitted changes. Commit or stash them first.');
}
if (
  git(root, ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    allowFail: true,
  }).status === 0
) {
  fail(`tag ${tag} already exists.`);
}

const changelogPath = join(root, 'CHANGELOG.md');
const changelog = parseChangelog(readFileSync(changelogPath, 'utf-8'));
if (
  changelog.lastVersion &&
  compareSemver(version, changelog.lastVersion) <= 0
) {
  fail(
    `${version} is not above the last release in CHANGELOG.md (${changelog.lastVersion}).`
  );
}
const { changes, planned } = splitPlanned(changelog.body);
const entries = changes.replace(/^---\s*$/gm, '').trim();
if (!/^\s*[-*] /m.test(entries))
  fail('[Unreleased] has no entries; nothing to release.');

// ---- 2 + 3. Plan the file changes ----------------------------------------
const newChangelog =
  changelog.before +
  '## [Unreleased]\n\n' +
  (planned ? `${planned.trim()}\n\n` : '') +
  `---\n\n## [${version}] - ${today}\n\n${entries}\n\n---\n\n` +
  changelog.after.replace(/^\n+/, '');

const packageFiles = packageJsonPaths(root).map((p) => {
  const text = readFileSync(p, 'utf-8');
  const from = JSON.parse(text).version;
  // Replace only the top-level "version" line, keeping the file's formatting.
  const updated = text.replace(
    /^(\s*"version":\s*")[^"]*(")/m,
    `$1${version}$2`
  );
  return { path: p, from, updated };
});

if (opts.dryRun) {
  console.log(`release (dry run) ${tag}:`);
  console.log(
    `  CHANGELOG.md: [Unreleased] -> [${version}] - ${today}${planned ? ' (### Planned stays)' : ''}`
  );
  for (const f of packageFiles)
    console.log(`  ${f.path.slice(root.length)}: ${f.from} -> ${version}`);
  console.log(`  yarn verify${opts.skipVerify ? ' (skipped)' : ''}`);
  console.log(`  commit "chore: release ${tag}", tag ${tag}`);
  process.exit(0);
}

writeFileSync(changelogPath, newChangelog);
for (const f of packageFiles) writeFileSync(f.path, f.updated);

// ---- 4. Verify ------------------------------------------------------------
if (!opts.skipVerify) {
  const r = spawnSync('node', [join(root, 'scripts', 'verify.mjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  if (r.status !== 0) {
    fail(
      'yarn verify failed; the release files are changed but nothing is committed. ' +
        'Fix the failure and re-run, or discard with: git checkout -- .'
    );
  }
}

// ---- 5. Commit and tag ----------------------------------------------------
git(root, ['add', 'CHANGELOG.md', ...packageFiles.map((f) => f.path)]);
git(root, ['commit', '-m', `chore: release ${tag}`]);
git(root, ['tag', '-a', tag, '-m', `m-control ${tag}`]);
console.log(
  `release: committed and tagged ${tag}. Push with: git push origin main ${tag}`
);
