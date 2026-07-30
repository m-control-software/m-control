import * as fs from 'fs';
import * as path from 'path';
import {
  MControlConfig,
  configExists,
  loadConfig,
  resolveToolsRoots,
} from '@m-control/core';

/**
 * Repo-relative tools/ directory — exists only when mctl runs from a
 * checkout of the monorepo (dev builds or the ncc bundle inside the repo).
 *
 * __dirname at runtime:
 *   - tsc build:   apps/mctl/dist/commands  -> 4 levels up = repo root
 *   - ts-node dev: apps/mctl/src/commands   -> 4 levels up = repo root
 *   - ncc bundle:  apps/mctl/dist/bundle    -> 4 levels up = repo root
 *   - installed:   ~/.m-control             -> no tools/ 4 levels up, returns null
 */
export function repoToolsRoot(): string | null {
  const candidate = path.resolve(__dirname, '../../../../tools');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Load global+project config if it exists; undefined otherwise.
 * Commands that require config (run) handle the missing case themselves.
 */
export function tryLoadConfig(): MControlConfig | undefined {
  if (!configExists()) return undefined;
  return loadConfig();
}

/**
 * The directories scanned for tool manifests, in priority order:
 * env M_CONTROL_TOOLS_ROOT > config.paths.toolsRoots > repo checkout fallback.
 */
export function getToolsRoots(config?: MControlConfig): string[] {
  const repoRoot = repoToolsRoot();
  return resolveToolsRoots(config, repoRoot ? [repoRoot] : []);
}
