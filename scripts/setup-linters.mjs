// Installs the non-npm linters `yarn verify` uses, at the versions pinned in
// linters.json, so every machine and CI lint with the same rules.
//
//   node scripts/setup-linters.mjs
//
// ruff goes into the user site of the Python that runs the tools (python on
// Windows, python3 elsewhere) and runs as `python -m ruff`, so PATH does not
// matter. PSScriptAnalyzer is installed for the current user from the
// PowerShell Gallery via pwsh.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const versions = JSON.parse(
  readFileSync(new URL('../linters.json', import.meta.url), 'utf-8')
);
const python = process.platform === 'win32' ? 'python' : 'python3';

function run(command, args) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const r = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error(
      `setup-linters: '${command}' failed${r.error ? `: ${r.error.message}` : ` (exit ${r.status})`}.`
    );
    process.exit(1);
  }
}

run(python, [
  '-m',
  'pip',
  'install',
  '--user',
  '--disable-pip-version-check',
  `ruff==${versions.ruff}`,
]);
run('pwsh', [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `$ErrorActionPreference = 'Stop'; ` +
    `if (-not (Get-Module -ListAvailable PSScriptAnalyzer | Where-Object { $_.Version -eq '${versions.PSScriptAnalyzer}' })) { ` +
    `Install-Module PSScriptAnalyzer -RequiredVersion ${versions.PSScriptAnalyzer} -Scope CurrentUser -Force }`,
]);
console.log(
  `setup-linters: ruff ${versions.ruff}, PSScriptAnalyzer ${versions.PSScriptAnalyzer} ready.`
);
