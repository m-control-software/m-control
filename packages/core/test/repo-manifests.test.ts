import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { discoverTools } from '../src/discovery';

/**
 * Every manifest shipped in this repo must pass the validation users hit.
 *
 * Discovery skips an invalid manifest with a warning instead of failing, so a
 * broken tool or template would otherwise only show up as "missing" from
 * `mctl list` - and a broken template is copied into every new tool.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('manifests shipped in the repo', () => {
  it('every tool under tools/ is valid and its entry exists', () => {
    const { tools, errors } = discoverTools(path.join(REPO_ROOT, 'tools'));

    expect(errors).toEqual([]);
    expect(tools.length).toBeGreaterThan(0);
    for (const { manifest, entryPath } of tools) {
      expect(fs.existsSync(entryPath), `${manifest.id} entry`).toBe(true);
    }
  });

  it('every template under templates/ is valid and its entry exists', () => {
    const templatesRoot = path.join(REPO_ROOT, 'templates');
    const templateDirs = fs
      .readdirSync(templatesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const d of templateDirs) {
      const { tools, errors } = discoverTools(path.join(templatesRoot, d.name));

      expect(errors, d.name).toEqual([]);
      expect(tools, d.name).toHaveLength(1);
      expect(fs.existsSync(tools[0].entryPath), d.name).toBe(true);
    }
  });
});
