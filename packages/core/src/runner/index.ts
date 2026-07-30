import { ResolvedTool, Runner, ToolManifest } from '../types';
import { ProcessRunner, RuntimeCommandOverrides } from './process-runner';

export { ProcessRunner, resolveSpawnCommand } from './process-runner';
export type { RuntimeCommandOverrides, SpawnCommand } from './process-runner';
export { NodeRunner } from './node-runner';

/**
 * Get the appropriate Runner for a given tool manifest.
 *
 * All supported runtimes are executed by ProcessRunner — the runtime only
 * changes the spawn command. `overrides` (from config.runtimes) lets users
 * point a runtime at a specific interpreter (e.g. { python: 'py' }).
 */
export function getRunner(
  _manifest: ToolManifest,
  overrides?: RuntimeCommandOverrides
): Runner {
  return new ProcessRunner(overrides);
}

// Re-export ResolvedTool for convenience (used in mctl run)
export type { ResolvedTool };
