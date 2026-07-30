import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractToolConfig, resolveToolsRoots } from '../src/config';
import { MControlConfig } from '../src/types';

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
