import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MControlConfig, CONFIG_VERSION } from './types';
import { ConfigError } from './errors';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Global config dir: ~/.m-control/ */
function globalConfigDir(): string {
  // On Windows, prefer USERPROFILE over os.homedir() for consistency with
  // existing PowerShell tooling in the project.
  const home =
    process.platform === 'win32'
      ? (process.env['USERPROFILE'] ?? os.homedir())
      : os.homedir();
  return path.join(home, '.m-control');
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.json');
}

/** Project-local config: <cwd>/.m-control/config.json — optional, merged over global. */
export function projectConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.m-control', 'config.json');
}

// ---------------------------------------------------------------------------
// Template written on first init
// ---------------------------------------------------------------------------

const CONFIG_TEMPLATE: MControlConfig = {
  configVersion: CONFIG_VERSION,
  tools: {
    azdo: {
      token: '',
      organization: '',
    },
    k8s: {
      defaultContext: '',
    },
    obsidian: {
      vaultPath: '',
    },
    'agent-status': {
      cursorApiKey: '',
      githubToken: '',
      githubOwners: '',
      claudeProjectsDir: '',
      codexSessionsDir: '',
    },
  },
  paths: {
    toolsRoots: [],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function configExists(): boolean {
  return fs.existsSync(globalConfigPath());
}

/**
 * Write the default config template to the global config path.
 * No-op if the file already exists (preserves user edits).
 *
 * @param options.toolsRoots  Pre-fill paths.toolsRoots (e.g. the repo's
 *                            tools/ dir when initialising from a checkout).
 */
export function initConfig(options?: { toolsRoots?: string[] }): void {
  const dir = globalConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const p = globalConfigPath();
  if (!fs.existsSync(p)) {
    const template: MControlConfig = {
      ...CONFIG_TEMPLATE,
      paths: {
        toolsRoots: options?.toolsRoots ?? [],
      },
    };
    fs.writeFileSync(p, JSON.stringify(template, null, 2), 'utf-8');
  }
}

/**
 * Load and merge config layers:
 *   1. Global:  ~/.m-control/config.json   (required)
 *   2. Project: <cwd>/.m-control/config.json (optional — merged over global)
 *
 * Merge strategy: deep merge of `tools` keys — project values win.
 * Both layers are validated for configVersion before merging.
 *
 * @param cwd  Working directory for project config resolution (default: process.cwd())
 */
export function loadConfig(cwd?: string): MControlConfig {
  const global = loadLayer(globalConfigPath(), 'global');

  const projectPath = projectConfigPath(cwd);
  if (fs.existsSync(projectPath)) {
    const project = loadLayer(projectPath, 'project');
    return mergeConfigs(global, project);
  }

  return global;
}

/**
 * Extract a flat key-value map of config values for a tool.
 * Used to build `RunContext.config` passed to tool processes.
 *
 * Keys are dot-paths resolved against the `tools` section of the config
 * (NOT the config root) — tool authors write "azdo.token", not
 * "tools.azdo.token".
 *
 * @example
 * extractToolConfig(config, ['azdo.token', 'azdo.organization'])
 * // => { 'azdo.token': 'pat-xxx', 'azdo.organization': 'myorg' }
 */
export function extractToolConfig(
  config: MControlConfig,
  keys: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    const parts = key.split('.');
    let value: unknown = config.tools;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[part];
    }
    result[key] = value;
  }

  return result;
}

/**
 * Resolve the list of directories to scan for tool manifests.
 *
 * Priority (first non-empty source wins):
 *   1. M_CONTROL_TOOLS_ROOT env var (multiple paths joined with path.delimiter)
 *   2. config.paths.toolsRoots
 *   3. fallbackRoots (e.g. repo-relative tools/ during development)
 *
 * Missing directories are fine — discovery treats them as empty.
 */
export function resolveToolsRoots(
  config: MControlConfig | undefined,
  fallbackRoots: string[] = []
): string[] {
  const fromEnv = (process.env['M_CONTROL_TOOLS_ROOT'] ?? '')
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (fromEnv.length > 0) {
    return dedupe(fromEnv.map((p) => path.resolve(p)));
  }

  const fromConfig = config?.paths?.toolsRoots ?? [];
  if (fromConfig.length > 0) {
    return dedupe(fromConfig.map((p) => path.resolve(p)));
  }

  return dedupe(fallbackRoots.map((p) => path.resolve(p)));
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)];
}

/**
 * Save config to the global path.
 * Does NOT validate before saving — caller is responsible.
 */
export function saveConfig(config: MControlConfig): void {
  const dir = globalConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    globalConfigPath(),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function loadLayer(
  filePath: string,
  layer: 'global' | 'project'
): MControlConfig {
  if (!fs.existsSync(filePath)) {
    if (layer === 'global') {
      throw new ConfigError(
        `Global config not found at ${filePath}. Run 'mctl init' to create it.`
      );
    }
    throw new ConfigError(`Project config not found at ${filePath}.`);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new ConfigError(
      `Cannot read ${layer} config at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `Invalid JSON in ${layer} config at ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return validateConfig(parsed, filePath, layer);
}

function validateConfig(
  raw: unknown,
  filePath: string,
  layer: string
): MControlConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new ConfigError(
      `${layer} config at ${filePath}: root must be a JSON object`
    );
  }

  const obj = raw as Record<string, unknown>;

  if (obj['configVersion'] !== CONFIG_VERSION) {
    throw new ConfigError(
      `${layer} config at ${filePath}: unsupported configVersion: ${String(obj['configVersion'])}. ` +
        `Expected ${CONFIG_VERSION}. ` +
        `If you upgraded m-control, update your config file manually or delete it and run 'mctl init'.`
    );
  }

  return obj as unknown as MControlConfig;
}

/** Deep merge: project values override global, undefined project values fall back to global. */
function mergeConfigs(
  global: MControlConfig,
  project: MControlConfig
): MControlConfig {
  return {
    configVersion: CONFIG_VERSION,
    tools: {
      ...global.tools,
      // Spread project tools — each tool section is merged at the key level
      ...Object.fromEntries(
        Object.entries(project.tools ?? {}).map(([key, projectValue]) => {
          const globalValue = global.tools?.[key];
          return [
            key,
            typeof projectValue === 'object' && typeof globalValue === 'object'
              ? { ...globalValue, ...projectValue }
              : projectValue,
          ];
        })
      ),
    },
    // Project paths/runtimes win wholesale when present (no partial merge —
    // toolsRoots is an ordered list, mixing layers would be surprising).
    ...((project.paths ?? global.paths)
      ? { paths: project.paths ?? global.paths }
      : {}),
    ...((project.runtimes ?? global.runtimes)
      ? { runtimes: { ...global.runtimes, ...project.runtimes } }
      : {}),
  };
}
