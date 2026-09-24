import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractToolConfig,
  declaredConfigKeys,
  resolveToolsRoots,
  resolveTimeoutMs,
  missingRequiredConfig,
  DEFAULT_TIMEOUT_MS,
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

describe('missingRequiredConfig', () => {
  const base: ToolManifest = {
    manifestVersion: 1,
    id: 'azdo',
    version: '0.1.0',
    name: 'AZDO',
    description: 'azdo',
    runtime: 'node',
    entry: 'index.js',
  };

  it('is empty when the tool declares nothing', () => {
    expect(missingRequiredConfig(base, config)).toEqual([]);
  });

  it('is empty when every declared key is supplied', () => {
    const m = { ...base, requiredConfig: ['azdo.token', 'azdo.organization'] };
    expect(missingRequiredConfig(m, config)).toEqual([]);
  });

  it('names the keys this machine does not supply', () => {
    // Nothing enforces requiredConfig at run time, so the tool would just see
    // undefined and fall back to an assumption. doctor has to say it instead.
    const m = { ...base, requiredConfig: ['azdo.token', 'azdo.project'] };
    expect(missingRequiredConfig(m, config)).toEqual(['azdo.project']);
  });

  it('treats an empty string as missing, not as a deliberate value', () => {
    const cfg: MControlConfig = {
      configVersion: 1,
      tools: { azdo: { token: '' } },
    };
    expect(missingRequiredConfig({ ...base, requiredConfig: ['azdo.token'] }, cfg)).toEqual([
      'azdo.token',
    ]);
  });

  it('ignores optional keys', () => {
    const m = {
      ...base,
      requiredConfig: ['azdo.token'],
      optionalConfig: ['azdo.nowhere'],
    };
    expect(missingRequiredConfig(m, config)).toEqual([]);
  });
});

describe('resolveTimeoutMs', () => {
  const manifest: ToolManifest = {
    manifestVersion: 1,
    id: 'slow-tool',
    version: '0.1.0',
    name: 'Slow',
    description: 'slow',
    runtime: 'powershell',
    entry: 'main.ps1',
  };
  const bare: MControlConfig = { configVersion: 1 };

  it('falls back to the built-in when nothing declares a budget', () => {
    expect(resolveTimeoutMs(manifest, bare)).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('uses the manifest budget over the built-in', () => {
    // The regression this guards: stream-deck's full 93-key render plus install
    // took 20.6s locally and exceeded the hardcoded 30s under mctl.
    expect(resolveTimeoutMs({ ...manifest, timeoutMs: 120_000 }, bare)).toBe(
      120_000
    );
  });

  it('lets a per-tool config entry override the manifest', () => {
    const cfg: MControlConfig = {
      configVersion: 1,
      timeouts: { default: 45_000, tools: { 'slow-tool': 200_000 } },
    };
    expect(resolveTimeoutMs({ ...manifest, timeoutMs: 120_000 }, cfg)).toBe(
      200_000
    );
  });

  it('prefers a manifest budget over the configured default', () => {
    // The tool knows its own cost; the default only covers tools that are silent.
    const cfg: MControlConfig = { configVersion: 1, timeouts: { default: 5_000 } };
    expect(resolveTimeoutMs({ ...manifest, timeoutMs: 120_000 }, cfg)).toBe(
      120_000
    );
    expect(resolveTimeoutMs(manifest, cfg)).toBe(5_000);
  });

  it('ignores values that would make every run fail instantly', () => {
    const cfg: MControlConfig = {
      configVersion: 1,
      timeouts: { tools: { 'slow-tool': 0 } },
    };
    expect(resolveTimeoutMs(manifest, cfg)).toBe(DEFAULT_TIMEOUT_MS);
    expect(resolveTimeoutMs({ ...manifest, timeoutMs: -1 }, bare)).toBe(
      DEFAULT_TIMEOUT_MS
    );
    expect(resolveTimeoutMs({ ...manifest, timeoutMs: NaN }, bare)).toBe(
      DEFAULT_TIMEOUT_MS
    );
  });

  it('only applies a per-tool entry to that tool', () => {
    const cfg: MControlConfig = {
      configVersion: 1,
      timeouts: { tools: { 'other-tool': 200_000 } },
    };
    expect(resolveTimeoutMs(manifest, cfg)).toBe(DEFAULT_TIMEOUT_MS);
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
