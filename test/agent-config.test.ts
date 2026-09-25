import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Agent configuration that no agent validates for us: a hook pointing at a
 * moved script fails silently on every edit, and a Copilot environment on a
 * different Node or Python than CI makes "works for the agent" mean something
 * else than "passes CI".
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (rel: string) =>
  fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');

/** Every `node <script>` in a hook command, as a repo-relative path. */
function nodeScripts(commands: string[]): string[] {
  return commands.flatMap((c) =>
    [...c.matchAll(/node\s+"?(?:\$CLAUDE_PROJECT_DIR\/)?([^"\s]+)"?/g)].map(
      (m) => m[1]
    )
  );
}

describe('Claude Code hooks (.claude/settings.json)', () => {
  const settings = JSON.parse(read('.claude/settings.json'));
  const commands: string[] = Object.values(settings.hooks ?? {}).flatMap(
    (groups) =>
      (groups as Array<{ hooks: Array<{ command: string }> }>).flatMap((g) =>
        g.hooks.map((h) => h.command)
      )
  );

  it('registers the session-start and format hooks', () => {
    expect(nodeScripts(commands).sort()).toEqual([
      '.claude/hooks/format-edited-file.mjs',
      '.claude/hooks/session-start.mjs',
    ]);
  });

  it.each(nodeScripts(commands))('%s exists', (script) => {
    expect(fs.existsSync(path.join(REPO_ROOT, script))).toBe(true);
  });
});

describe('Cursor hooks (.cursor/hooks.json)', () => {
  const config = JSON.parse(read('.cursor/hooks.json'));
  const commands: string[] = Object.values(config.hooks ?? {}).flatMap(
    (entries) => (entries as Array<{ command: string }>).map((e) => e.command)
  );

  it('uses schema version 1 and formats after edits', () => {
    expect(config.version).toBe(1);
    expect(
      nodeScripts(
        config.hooks.afterFileEdit.map((e: { command: string }) => e.command)
      )
    ).toEqual(['.claude/hooks/format-edited-file.mjs']);
  });

  it.each(nodeScripts(commands))('%s exists', (script) => {
    // Project hooks run from the project root, so paths are repo-relative.
    expect(fs.existsSync(path.join(REPO_ROOT, script))).toBe(true);
  });
});

describe('Copilot setup steps', () => {
  const workflow = read('.github/workflows/copilot-setup-steps.yml');
  const ci = read('.github/workflows/ci.yml');

  it('defines the job name Copilot looks for', () => {
    expect(workflow).toMatch(/^ {2}copilot-setup-steps:\s*$/m);
  });

  it.each([
    'node-version-file: .nvmrc',
    'python-version-file: .python-version',
    'node scripts/setup-linters.mjs',
  ])('pins the toolchain the same way CI does: %s', (line) => {
    expect(ci).toContain(line);
    expect(workflow).toContain(line);
  });
});
