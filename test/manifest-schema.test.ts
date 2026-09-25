import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverTools } from '@m-control/core';

/**
 * packages/core/schemas/manifest.v1.schema.json must accept exactly what
 * discovery (validateManifest) accepts. Editors and agents validate against the
 * schema; mctl validates with core. If they disagree, a manifest that looks
 * valid in the editor silently disappears from `mctl list`, or the reverse.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const schema = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, 'packages/core/schemas/manifest.v1.schema.json'),
    'utf-8'
  )
);
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

const base = {
  manifestVersion: 1,
  id: 'demo-tool',
  version: '0.1.0',
  name: 'Demo',
  description: 'Demo tool',
  runtime: 'node',
  entry: 'index.js',
};

/** [label, manifest] — every rule validateManifest applies, both ways. */
const cases: Array<[string, unknown]> = [
  ['minimal', base],
  [
    'every optional field',
    {
      ...base,
      requiredConfig: ['demo-tool.token'],
      optionalConfig: [],
      timeoutMs: 1500,
      tags: ['a'],
    },
  ],
  ['unknown extra field', { ...base, $schema: 'x', extra: true }],
  ['not an object', ['x']],
  ['manifestVersion 2', { ...base, manifestVersion: 2 }],
  ['manifestVersion as string', { ...base, manifestVersion: '1' }],
  ...(
    ['id', 'version', 'name', 'description', 'runtime', 'entry'] as const
  ).map((field): [string, unknown] => {
    const m: Record<string, unknown> = { ...base };
    delete m[field];
    return [`missing ${field}`, m];
  }),
  ['numeric version', { ...base, version: 1 }],
  ['unknown runtime', { ...base, runtime: 'ruby' }],
  ['every runtime: python', { ...base, runtime: 'python' }],
  ['every runtime: powershell', { ...base, runtime: 'powershell' }],
  ['every runtime: dotnet', { ...base, runtime: 'dotnet' }],
  ['id with capitals', { ...base, id: 'Demo' }],
  ['id with underscore', { ...base, id: 'demo_tool' }],
  ['id with trailing dash', { ...base, id: 'demo-' }],
  ['requiredConfig as string', { ...base, requiredConfig: 'a.b' }],
  ['optionalConfig with number', { ...base, optionalConfig: [1] }],
  ['timeoutMs zero', { ...base, timeoutMs: 0 }],
  ['timeoutMs negative', { ...base, timeoutMs: -5 }],
  ['timeoutMs as string', { ...base, timeoutMs: '1000' }],
  ['tags as string', { ...base, tags: 'a' }],
  ['tags with number', { ...base, tags: [1] }],
];

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-schema-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function coreAccepts(manifest: unknown): boolean {
  const dir = path.join(root, 'tool');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return discoverTools(root).errors.length === 0;
}

describe('manifest schema agrees with validateManifest', () => {
  it.each(cases)('%s', (_label, manifest) => {
    const core = coreAccepts(manifest);
    const schemaOk = validateSchema(manifest);
    expect(
      schemaOk,
      `core ${core ? 'accepts' : 'rejects'} it, schema ${schemaOk ? 'accepts' : 'rejects'} it: ` +
        JSON.stringify(validateSchema.errors)
    ).toBe(core);
  });

  it('accepts every manifest shipped in tools/ and templates/', () => {
    const manifests = fs
      .readdirSync(REPO_ROOT, { recursive: true, encoding: 'utf-8' })
      .filter(
        (f) =>
          /^(tools|templates)[\\/]/.test(f) &&
          path.basename(f) === 'manifest.json' &&
          !f.includes('node_modules')
      );
    expect(manifests.length).toBeGreaterThan(0);
    for (const f of manifests) {
      const m = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, f), 'utf-8'));
      expect(
        validateSchema(m),
        `${f}: ${JSON.stringify(validateSchema.errors)}`
      ).toBe(true);
    }
  });
});
