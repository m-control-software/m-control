import {
  discoverTools,
  loadConfig,
  configExists,
  extractToolConfig,
  createEventSink,
  getRunner,
  RunContext,
  ToolInput,
  RunnerOptions,
} from '@m-control/core';
import { getToolsRoots } from '../paths';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseArgs(args: string[]): {
  toolId: string;
  jsonMode: boolean;
  input: ToolInput;
} {
  // args = everything after 'run', e.g. ['hello-world', 'name=Michal', '--json']
  const toolId = args[0];
  const jsonMode = args.includes('--json');

  // Bare key=value pairs after the tool id become the tool input.
  // Values are passed as strings — tools coerce as needed.
  const input: ToolInput = {};
  for (const arg of args.slice(1)) {
    if (arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      input[arg.slice(0, eq)] = arg.slice(eq + 1);
    }
  }

  return { toolId, jsonMode, input };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export async function runRun(args: string[]): Promise<void> {
  if (!args[0]) {
    console.error('Usage: mctl run <tool-id> [key=value ...] [--json]');
    process.exit(1);
  }

  const { toolId, jsonMode, input } = parseArgs(args);

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------
  if (!configExists()) {
    console.error(
      `No config found. Run 'mctl init' to create ~/.m-control/config.json,\n` +
        `then run 'mctl run ${toolId}' again.`
    );
    process.exit(1);
  }

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(
      `Config error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Discovery — find the tool by id
  // -------------------------------------------------------------------------
  const toolsRoots = getToolsRoots(config);
  const { tools, errors: discoveryErrors } = discoverTools(toolsRoots);

  for (const { file, error } of discoveryErrors) {
    process.stderr.write(
      `[warn] skipping invalid manifest: ${file}\n       ${error}\n`
    );
  }

  const tool = tools.find((t) => t.manifest.id === toolId);
  if (!tool) {
    const known = tools.map((t) => t.manifest.id).join(', ') || '(none)';
    console.error(`Unknown tool: "${toolId}"`);
    console.error(`Available: ${known}`);
    console.error(`Run 'mctl list' to see all tools.`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Build RunContext
  // -------------------------------------------------------------------------
  const toolConfig = extractToolConfig(
    config,
    tool.manifest.requiredConfig ?? []
  );

  const context: RunContext = {
    toolId,
    config: toolConfig,
    // The directory the user invoked mctl from — tools resolve relative
    // paths against this, not against the mctl install location.
    workspaceRoot: process.cwd(),
  };

  // -------------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------------
  const runner = getRunner(tool.manifest, config.runtimes);
  const sink = createEventSink(jsonMode);

  const runnerOptions: RunnerOptions = {
    timeoutMs: 30_000,
    maxOutputBytes: 10 * 1024 * 1024,
    maxEvents: 10_000,
  };

  try {
    for await (const event of runner.run(tool, context, input, runnerOptions)) {
      sink.emit(event);
    }
    sink.flush?.();
  } catch (err) {
    console.error(
      `Runner error: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
