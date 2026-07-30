#!/usr/bin/env node
/**
 * @m-control/mctl - CLI entry point
 */

import { runList } from './commands/list';
import { runRun } from './commands/run';
import { runInit } from './commands/init';
import { runDoctor } from './commands/doctor';

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(
    `
m-control — Michał's personal command center

Usage:
  mctl init                   Create ~/.m-control/config.json
  mctl list                   List available tools
  mctl run <tool-id> [k=v...] Run a tool (key=value pairs become tool input)
  mctl run <tool-id> --json   Passthrough raw NDJSON output
  mctl doctor                 Diagnose config, tool discovery, and runtimes

  mctl --help                 Show this help

Configuration:
  ~/.m-control/config.json          (global)
  <project>/.m-control/config.json  (optional overrides)

Tools are discovered from (first match wins):
  M_CONTROL_TOOLS_ROOT env var, config paths.toolsRoots, or the repo's tools/
  `.trim()
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  const [command, ...rest] = args;

  switch (command) {
    case 'init':
      runInit();
      break;

    case 'list':
      runList();
      break;

    case 'run':
      await runRun(rest);
      break;

    case 'doctor':
      runDoctor();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error(`Run 'mctl --help' for usage.`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exit(1);
});
