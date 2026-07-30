import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTools } from '../src/discovery';

function writeManifest(dir: string, manifest: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2)
  );
}

function validManifest(id: string): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id,
    version: '0.1.0',
    name: id,
    description: `${id} description`,
    runtime: 'node',
    entry: 'index.js',
  };
}

describe('discoverTools', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mctl-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns empty result for a missing root', () => {
    const result = discoverTools(path.join(root, 'does-not-exist'));
    expect(result.tools).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('discovers valid manifests recursively and sorts by id', () => {
    writeManifest(path.join(root, 'cat-a', 'tool-b'), validManifest('tool-b'));
    writeManifest(path.join(root, 'cat-b', 'tool-a'), validManifest('tool-a'));

    const result = discoverTools(root);
    expect(result.tools.map((t) => t.manifest.id)).toEqual([
      'tool-a',
      'tool-b',
    ]);
    expect(result.errors).toEqual([]);
    expect(result.tools[0].entryPath).toBe(
      path.join(root, 'cat-b', 'tool-a', 'index.js')
    );
  });

  it('collects invalid manifests as non-fatal errors', () => {
    writeManifest(path.join(root, 'ok'), validManifest('ok-tool'));
    writeManifest(path.join(root, 'bad-json'), '{ not json');
    writeManifest(path.join(root, 'bad-version'), {
      ...validManifest('bad-version-tool'),
      manifestVersion: 99,
    });
    writeManifest(path.join(root, 'bad-runtime'), {
      ...validManifest('bad-runtime-tool'),
      runtime: 'cobol',
    });
    writeManifest(path.join(root, 'bad-id'), validManifest('Not_Kebab'));

    const result = discoverTools(root);
    expect(result.tools.map((t) => t.manifest.id)).toEqual(['ok-tool']);
    expect(result.errors).toHaveLength(4);
  });

  it('scans multiple roots and reports duplicate ids (first root wins)', () => {
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'mctl-discovery-b-'));
    try {
      writeManifest(path.join(root, 'misc', 'dup'), validManifest('dup'));
      writeManifest(path.join(root, 'misc', 'only-a'), validManifest('only-a'));
      writeManifest(path.join(rootB, 'misc', 'dup'), validManifest('dup'));
      writeManifest(
        path.join(rootB, 'misc', 'only-b'),
        validManifest('only-b')
      );

      const result = discoverTools([root, rootB]);
      expect(result.tools.map((t) => t.manifest.id)).toEqual([
        'dup',
        'only-a',
        'only-b',
      ]);
      // The winning 'dup' comes from the first root
      const dup = result.tools.find((t) => t.manifest.id === 'dup')!;
      expect(dup.dir.startsWith(root)).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('duplicate tool id "dup"');
    } finally {
      fs.rmSync(rootB, { recursive: true, force: true });
    }
  });
});
