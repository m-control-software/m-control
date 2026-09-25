import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { ToolManifest, discoverTools } from '@m-control/core';
import {
  expectProtocol,
  runTool,
  runtimeAvailable,
} from '@m-control/test-support';

/**
 * Rules every tool in tools/ must meet, checked mechanically instead of being
 * left to a checklist (AGENTS.md -> "Adding a tool"). A new tool is covered the
 * moment its directory exists; there is nothing to register.
 *
 * The runtime probes are safe for tools that change live state: a malformed
 * request and missing required config must both fail before any work starts.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const TOOLS_ROOT = path.join(REPO_ROOT, 'tools');
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A tool may refuse an unsupported platform before anything else (logi-options
 * is Windows-only). That is the one error allowed to pre-empt the checks below.
 */
const UNSUPPORTED_PLATFORM = 'UNSUPPORTED_PLATFORM';

interface ToolDir {
  category: string;
  dir: string;
  manifest: ToolManifest;
}

/** Every tools/<category>/<id>/ directory, read directly (not via discovery). */
function toolDirs(): ToolDir[] {
  const out: ToolDir[] = [];
  for (const category of fs.readdirSync(TOOLS_ROOT, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = path.join(TOOLS_ROOT, category.name);
    for (const tool of fs.readdirSync(categoryDir, { withFileTypes: true })) {
      if (!tool.isDirectory()) continue;
      const dir = path.join(categoryDir, tool.name);
      const manifestPath = path.join(dir, 'manifest.json');
      // A directory without a manifest is caught by the layout test below.
      const manifest = fs.existsSync(manifestPath)
        ? (JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ToolManifest)
        : ({} as ToolManifest);
      out.push({ category: category.name, dir, manifest });
    }
  }
  return out;
}

/** Resolves a dot-path against an object, as core resolves config keys. */
function resolveDotPath(obj: unknown, dotPath: string): unknown {
  return dotPath
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      obj
    );
}

const tools = toolDirs();
const agentsMd = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf-8');

describe('tools/ layout', () => {
  it('holds at least one tool', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('every manifest is valid for discovery', () => {
    expect(discoverTools(TOOLS_ROOT).errors).toEqual([]);
  });

  it('ids are unique', () => {
    const ids = tools.map((t) => t.manifest.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe.each(tools.map((t) => [path.relative(REPO_ROOT, t.dir), t] as const))(
  '%s',
  (_rel, { category, dir, manifest }) => {
    const required = manifest.requiredConfig ?? [];
    const declared = [...required, ...(manifest.optionalConfig ?? [])];

    it('is tools/<kebab-category>/<id>/ with a manifest', () => {
      expect(KEBAB.test(category), `category '${category}'`).toBe(true);
      expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
      expect(path.basename(dir), 'directory name must equal manifest.id').toBe(
        manifest.id
      );
    });

    it('has its entry, a README and at least one test', () => {
      expect(fs.existsSync(path.join(dir, manifest.entry ?? ''))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
      const testDir = path.join(dir, 'test');
      const tests = fs.existsSync(testDir)
        ? fs.readdirSync(testDir).filter((f) => f.endsWith('.test.ts'))
        : [];
      expect(tests.length, `${testDir}/*.test.ts`).toBeGreaterThan(0);
    });

    it('documents every config key it declares in its README', () => {
      const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf-8');
      const undocumented = declared.filter((key) => {
        const leaf = key.split('.').pop()!;
        return (
          !readme.includes(`\`${key}\``) && !readme.includes(`\`${leaf}\``)
        );
      });
      expect(undocumented, 'keys not mentioned in `backticks`').toEqual([]);
    });

    it('is listed in AGENTS.md', () => {
      expect(agentsMd).toContain(`\`${manifest.id}\``);
    });

    it.skipIf(required.length === 0)(
      'ships test/smoke-config.json supplying every required key',
      () => {
        const file = path.join(dir, 'test', 'smoke-config.json');
        expect(fs.existsSync(file), file).toBe(true);
        const { tools: section } = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const unset = required.filter((key) => {
          const v = resolveDotPath(section, key);
          return v === undefined || v === null || v === '';
        });
        expect(unset).toEqual([]);
      }
    );

    describe.skipIf(!runtimeAvailable(dir))('runtime probes', () => {
      it('answers a malformed request with an error, started first', () => {
        const run = runTool(dir, { stdin: 'not json' });
        expectProtocol(run, manifest.id);
        expect(run.error, run.stdout).toBeDefined();
        if (run.error!.code !== UNSUPPORTED_PLATFORM) {
          expect(run.error!.recoverable, 'a malformed request is a bug').toBe(
            false
          );
        }
      }, 60_000);

      it.skipIf(required.length === 0)(
        'fails recoverably, naming the key, when required config is missing',
        () => {
          const run = runTool(dir, { config: {} });
          expectProtocol(run, manifest.id);
          expect(run.error, run.stdout).toBeDefined();
          expect(run.error!.recoverable).toBe(true);
          if (run.error!.code !== UNSUPPORTED_PLATFORM) {
            const message = String(run.error!.message);
            expect(
              required.some((key) => message.includes(key)),
              `error should name a missing key: ${message}`
            ).toBe(true);
          }
        },
        60_000
      );
    });
  }
);
