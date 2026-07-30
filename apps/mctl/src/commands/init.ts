import { configExists, initConfig, globalConfigPath } from '@m-control/core';
import { repoToolsRoot } from '../paths';

/**
 * mctl init — create ~/.m-control/config.json if it doesn't exist.
 *
 * When running from a repo checkout, paths.toolsRoots is pre-filled with the
 * repo's tools/ directory so a globally installed mctl keeps discovering the
 * same tools.
 */
export function runInit(): void {
  const configPath = globalConfigPath();

  if (configExists()) {
    console.log(`Config already exists: ${configPath}`);
    console.log('Nothing to do. Edit the file directly to change settings.');
    return;
  }

  const toolsRoot = repoToolsRoot();
  initConfig({ toolsRoots: toolsRoot ? [toolsRoot] : [] });

  console.log(`Config created: ${configPath}`);
  if (toolsRoot) {
    console.log(`Tools root registered: ${toolsRoot}`);
  } else {
    console.log(
      'No repo checkout detected — set paths.toolsRoots in the config ' +
        'to the absolute path(s) of your tools directories.'
    );
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Fill in credentials under "tools" in the config file');
  console.log("  2. Run 'mctl list' to verify tool discovery");
}
