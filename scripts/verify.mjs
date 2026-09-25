// `yarn verify` — the one definition of "green". CI runs exactly this script,
// so a local pass means the same checks CI runs have passed.
//
//   yarn verify                 every step, in CI order
//   yarn verify --from=test     resume at a step after fixing a failure
//   yarn verify --only=lint     a single step
//
// A step that needs an external linter (ruff, pwsh + PSScriptAnalyzer, versions
// pinned in linters.json) is REQUIRED when CI=true and skipped with a loud
// warning otherwise, so a contributor without those tools can still verify
// everything else. The summary lists what was skipped: CI will run it.
// `node scripts/setup-linters.mjs` installs them.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const inCI = process.env.CI === 'true';
const inGitHub = process.env.GITHUB_ACTIONS === 'true';
const isWindows = process.platform === 'win32';

/** True when `command args…` can be spawned and exits 0. */
function probe([command, ...args]) {
  const r = spawnSync(command, args, { stdio: 'ignore', shell: isWindows });
  return !r.error && r.status === 0;
}

const python = isWindows ? 'python' : 'python3';

/**
 * Steps in CI order. `run` is argv. `needs` describes an external tool the step
 * cannot run without: `probe` is argv that exits 0 when it is installed (see
 * the header comment for what happens when it is not).
 */
const steps = [
  { name: 'install', run: ['yarn', 'install', '--frozen-lockfile'] },
  {
    name: 'build-core',
    run: ['yarn', 'workspace', '@m-control/core', 'build'],
  },
  { name: 'typecheck', run: ['yarn', 'typecheck'] },
  { name: 'lint', run: ['yarn', 'lint'] },
  {
    name: 'lint-python',
    run: [python, '-m', 'ruff', 'check', '.'],
    needs: { what: 'ruff', probe: [python, '-m', 'ruff', '--version'] },
  },
  {
    name: 'lint-powershell',
    run: [
      'pwsh',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      'scripts/lint-powershell.ps1',
    ],
    needs: {
      what: 'pwsh with PSScriptAnalyzer',
      probe: [
        'pwsh',
        '-NoProfile',
        '-Command',
        'if (Get-Module -ListAvailable PSScriptAnalyzer) { exit 0 } else { exit 1 }',
      ],
    },
  },
  { name: 'test', run: ['yarn', 'test'] },
  { name: 'build', run: ['yarn', 'build'] },
  { name: 'smoke', run: ['node', 'scripts/smoke.mjs'] },
];

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = /^--(from|only)=(.+)$/.exec(arg);
    if (!m) {
      console.error(
        `verify: unknown argument '${arg}'. Use --from=<step> or --only=<step>.`
      );
      process.exit(2);
    }
    if (!steps.some((s) => s.name === m[2])) {
      console.error(
        `verify: unknown step '${m[2]}'. Steps: ${steps.map((s) => s.name).join(', ')}`
      );
      process.exit(2);
    }
    opts[m[1]] = m[2];
  }
  return opts;
}

function selectSteps({ from, only }) {
  if (only) return steps.filter((s) => s.name === only);
  if (from) return steps.slice(steps.findIndex((s) => s.name === from));
  return steps;
}

const opts = parseArgs(process.argv.slice(2));
const skipped = [];
const started = Date.now();

for (const step of selectSteps(opts)) {
  if (step.needs && !probe(step.needs.probe)) {
    const hint = 'Install it with: node scripts/setup-linters.mjs';
    if (inCI) {
      console.error(
        `verify: step '${step.name}' needs ${step.needs.what}, which is not installed. ${hint}`
      );
      process.exit(1);
    }
    console.warn(
      `\n!! verify: SKIPPING '${step.name}' — ${step.needs.what} is not installed (CI runs it). ${hint}`
    );
    skipped.push(step.name);
    continue;
  }

  const label = `${step.name}: ${step.run.join(' ')}`;
  console.log(inGitHub ? `::group::${label}` : `\n== ${label}`);
  const t0 = Date.now();
  const r = spawnSync(step.run[0], step.run.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWindows,
  });
  if (inGitHub) console.log('::endgroup::');

  if (r.status !== 0) {
    const msg = `step '${step.name}' failed (exit ${r.status ?? r.signal}).`;
    console.error(inGitHub ? `::error::verify: ${msg}` : `\nverify: ${msg}`);
    console.error(`Fix it, then resume with: yarn verify --from=${step.name}`);
    process.exit(1);
  }
  console.log(
    `   ${step.name} ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`
  );
}

const total = ((Date.now() - started) / 1000).toFixed(1);
if (skipped.length > 0) {
  console.warn(
    `\nverify: passed in ${total} s, but SKIPPED: ${skipped.join(', ')}. CI will run them.`
  );
} else {
  console.log(`\nverify: all steps passed in ${total} s`);
}
