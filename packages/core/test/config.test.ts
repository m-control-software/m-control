import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractToolConfig,
  declaredConfigKeys,
  resolveToolsRoots,
} from '../src/config';
import { MControlConfig, ToolManifest } from '../src/types';

const config: MControlConfig = {
  configVersion: 1,
  tools: {
    azdo: { token: 'pat-xxx', organization: 'myorg' },
    nested: { deep: { value: 42 } },
  },
  paths: { toolsRoots: ['/configured/tools'] },
};

describe('extractToolConfig', () => {
  it('resolves dot-paths against the tools section', () => {
    expect(
      extractToolConfig(config, ['azdo.token', 'azdo.organization'])
    ).toEqual({
      'azdo.token': 'pat-xxx',
      'azdo.organization': 'myorg',
    });
  });

  it('resolves nested paths and returns undefined for missing keys', () => {
    expect(
      extractToolConfig(config, ['nested.deep.value', 'missing.key'])
    ).toEqual({
      'nested.deep.value': 42,
      'missing.key': undefined,
    });
  });
});

describe('declaredConfigKeys', () => {
  const base: ToolManifest = {
    manifestVersion: 1,
    id: 'demo',
    version: '0.1.0',
    name: 'Demo',
    description: 'demo',
    runtime: 'node',
    entry: 'index.js',
  };

  it('includes optional keys, so a tool actually receives them', () => {
    // The regression this guards: stream-deck read profilesRoot, deviceModel
    // and backupDir but declared none of them, so under mctl they were always
    // undefined and the tool silently used its defaults.
    const manifest: ToolManifest = {
      ...base,
      requiredConfig: ['demo.profileName'],
      optionalConfig: ['demo.profilesRoot', 'demo.backupDir'],
    };

    expect(declaredConfigKeys(manifest).sort()).toEqual([
      'demo.backupDir',
      'demo.profileName',
      'demo.profilesRoot',
    ]);
  });

  it('handles either list being absent', () => {
    expect(declaredConfigKeys(base)).toEqual([]);
    expect(declaredConfigKeys({ ...base, requiredConfig: ['a.b'] })).toEqual([
      'a.b',
    ]);
    expect(declaredConfigKeys({ ...base, optionalConfig: ['c.d'] })).toEqual([
      'c.d',
    ]);
  });

  it('does not pass a key twice when both lists name it', () => {
    const manifest: ToolManifest = {
      ...base,
      requiredConfig: ['a.b'],
      optionalConfig: ['a.b'],
    };
    expect(declaredConfigKeys(manifest)).toEqual(['a.b']);
  });
});

describe('resolveToolsRoots', () => {
  afterEach(() => {
    delete process.env['M_CONTROL_TOOLS_ROOT'];
  });

  it('prefers the env var over config and fallback', () => {
    process.env['M_CONTROL_TOOLS_ROOT'] = ['/env/a', '/env/b'].join(
      path.delimiter
    );
    expect(resolveToolsRoots(config, ['/fallback'])).toEqual([
      path.resolve('/env/a'),
      path.resolve('/env/b'),
    ]);
  });

  it('uses config.paths.toolsRoots when no env var is set', () => {
    expect(resolveToolsRoots(config, ['/fallback'])).toEqual([
      path.resolve('/configured/tools'),
    ]);
  });

  it('falls back when config has no roots', () => {
    const bare: MControlConfig = { configVersion: 1, tools: {} };
    expect(resolveToolsRoots(bare, ['/fallback'])).toEqual([
      path.resolve('/fallback'),
    ]);
    expect(resolveToolsRoots(undefined, ['/fallback'])).toEqual([
      path.resolve('/fallback'),
    ]);
  });

  it('dedupes repeated roots', () => {
    expect(resolveToolsRoots(undefined, ['/a', '/a', '/b'])).toEqual([
      path.resolve('/a'),
      path.resolve('/b'),
    ]);
  });
});
