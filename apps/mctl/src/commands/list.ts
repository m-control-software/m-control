import { discoverTools, DiscoveryResult } from '@m-control/core';
import { getToolsRoots, tryLoadConfig } from '../paths';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function renderList(result: DiscoveryResult, roots: string[]): void {
  if (result.errors.length > 0) {
    for (const { file, error } of result.errors) {
      process.stderr.write(
        `[warn] Skipping invalid manifest: ${file}\n       ${error}\n`
      );
    }
  }

  if (result.tools.length === 0) {
    console.log('No tools found.\n');
    console.log('Searched tools roots:');
    for (const root of roots) {
      console.log(`  ${root}`);
    }
    if (roots.length === 0) {
      console.log('  (none — run mctl init or set paths.toolsRoots in config)');
    }
    return;
  }

  // Calculate column widths for alignment
  const idWidth = Math.max(4, ...result.tools.map((t) => t.manifest.id.length));
  const versionWidth = Math.max(
    7,
    ...result.tools.map((t) => t.manifest.version.length)
  );
  const runtimeWidth = Math.max(
    7,
    ...result.tools.map((t) => t.manifest.runtime.length)
  );

  const header =
    'ID'.padEnd(idWidth) +
    '  ' +
    'VERSION'.padEnd(versionWidth) +
    '  ' +
    'RUNTIME'.padEnd(runtimeWidth) +
    '  ' +
    'DESCRIPTION';

  const divider = '-'.repeat(header.length + 4);

  console.log('');
  console.log(header);
  console.log(divider);

  for (const { manifest } of result.tools) {
    const row =
      manifest.id.padEnd(idWidth) +
      '  ' +
      manifest.version.padEnd(versionWidth) +
      '  ' +
      manifest.runtime.padEnd(runtimeWidth) +
      '  ' +
      manifest.description;
    console.log(row);
  }

  console.log('');
  console.log(
    `${result.tools.length} tool${result.tools.length === 1 ? '' : 's'} found.`
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function runList(): void {
  // Config is optional for list — without it we fall back to the repo tools/
  let config;
  try {
    config = tryLoadConfig();
  } catch (err) {
    process.stderr.write(
      `[warn] ignoring invalid config: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  const roots = getToolsRoots(config);
  const result = discoverTools(roots);
  renderList(result, roots);
}
