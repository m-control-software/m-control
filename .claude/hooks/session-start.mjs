// SessionStart hook (Claude Code). Registered in .claude/settings.json.
//
// Cloud sessions (Claude Code on the web) start from a fresh clone: without
// this, `yarn typecheck` fails until someone remembers to install and build
// core. Local sessions are left alone — a developer's checkout is already set
// up, and a hook must not reinstall dependencies on every start.
//
// Whatever this prints on stdout is added to the session's context, so it
// stays to one line.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.env.CLAUDE_CODE_REMOTE !== 'true') process.exit(0);

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const shell = process.platform === 'win32';

for (const args of [
  ['install', '--frozen-lockfile'],
  ['workspace', '@m-control/core', 'build'],
]) {
  const r = spawnSync('yarn', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell,
  });
  if (r.status !== 0) {
    // Non-zero would not stop the session; say what broke instead.
    console.log(
      `m-control session setup failed at 'yarn ${args.join(' ')}'. Run it manually.`
    );
    process.exit(0);
  }
}
console.log(
  'm-control: dependencies installed and core built. `yarn verify` is the bar before pushing.'
);
