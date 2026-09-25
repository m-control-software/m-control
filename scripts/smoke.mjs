// End-to-end smoke test of the built mctl bundle. CI and `yarn verify` both run
// this file, so what passes locally is what CI checks.
//
// Isolation: HOME/USERPROFILE point at a throwaway directory and mctl runs from
// a throwaway cwd, so the smoke test can never read or overwrite the real
// ~/.m-control/config.json or a project config. M_CONTROL_TOOLS_ROOT is unset,
// so discovery falls back to this checkout's tools/.
//
// Sequence:
//   1. --help, init, list
//   2. doctor must FAIL on the fresh config (a tool declares requiredConfig
//      that nothing has set yet) — proves the required-config check works
//   3. merge every tool's test/smoke-config.json into the config
//   4. doctor must PASS
//   5. run the protocol reference tools
//
// A tool with requiredConfig must ship test/smoke-config.json that supplies
// every required key (tools/conformance.test.ts enforces it). The file holds a
// partial `tools` section; the string `${toolDir}` is replaced by the tool's
// absolute directory, so values can point at the tool's own examples.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const bundle = join(repoRoot, 'apps', 'mctl', 'dist', 'bundle', 'index.js');

/** Tools that `mctl run` must execute end to end. Pure, side-effect free. */
const SMOKE_RUN = [
  ['hello-world', 'name=CI'],
  ['hello-python', 'name=CI'],
];

if (!existsSync(bundle)) {
  console.error(`smoke: ${bundle} not found. Run 'yarn build' first.`);
  process.exit(2);
}

const sandbox = mkdtempSync(join(tmpdir(), 'mctl-smoke-'));
const home = join(sandbox, 'home');
const cwd = join(sandbox, 'work');
for (const dir of [home, cwd]) mkdirSync(dir, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home };
delete env.M_CONTROL_TOOLS_ROOT;
const configPath = join(home, '.m-control', 'config.json');

function mctl(args, { expectFail = false } = {}) {
  console.log(`\n$ mctl ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [bundle, ...args], {
    cwd,
    env,
    stdio: 'inherit',
  });
  const failed = r.status !== 0;
  if (failed !== expectFail) {
    const why = expectFail
      ? 'expected a non-zero exit, got 0'
      : `exited ${r.status ?? r.signal}`;
    throw new Error(`mctl ${args.join(' ')}: ${why}`);
  }
}

/** Every tools/<category>/<id>/ directory that holds a manifest.json. */
function toolDirs() {
  const root = join(repoRoot, 'tools');
  const dirs = [];
  for (const category of readdirSync(root, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const tool of readdirSync(join(root, category.name), {
      withFileTypes: true,
    })) {
      const dir = join(root, category.name, tool.name);
      if (tool.isDirectory() && existsSync(join(dir, 'manifest.json')))
        dirs.push(dir);
    }
  }
  return dirs;
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] ?? {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function applySmokeConfig() {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.tools ??= {};
  for (const dir of toolDirs()) {
    const file = join(dir, 'test', 'smoke-config.json');
    if (!existsSync(file)) continue;
    // JSON.stringify escapes backslashes in Windows paths.
    const toolDir = JSON.stringify(dir).slice(1, -1);
    const raw = readFileSync(file, 'utf-8').replaceAll('${toolDir}', toolDir);
    const { tools } = JSON.parse(raw);
    deepMerge(config.tools, tools ?? {});
    console.log(`smoke: merged ${file.slice(repoRoot.length)}`);
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

let exitCode = 0;
try {
  mctl(['--help']);
  mctl(['init']);
  mctl(['list']);
  mctl(['doctor'], { expectFail: true });
  applySmokeConfig();
  mctl(['doctor']);
  for (const [id, ...args] of SMOKE_RUN) mctl(['run', id, ...args]);
  console.log('\nsmoke: all checks passed');
} catch (err) {
  console.error(
    `\nsmoke: FAILED — ${err instanceof Error ? err.message : String(err)}`
  );
  exitCode = 1;
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
process.exit(exitCode);
