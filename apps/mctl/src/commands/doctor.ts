import * as fs from 'fs';
import { spawnSync } from 'child_process';
import {
  MControlConfig,
  ToolRuntime,
  configExists,
  discoverTools,
  globalConfigPath,
  loadConfig,
  resolveSpawnCommand,
} from '@m-control/core';
import { getToolsRoots } from '../paths';

/**
 * mctl doctor — diagnose the local setup:
 *   1. Config file present and valid
 *   2. Tools roots resolved and existing
 *   3. Tool discovery results (including manifest warnings)
 *   4. Required runtimes available on this machine
 *
 * Exits 1 if any check fails — usable in scripts/CI.
 */
export function runDoctor(): void {
  let failed = false;
  const fail = (msg: string): void => {
    failed = true;
    console.log(`  [FAIL] ${msg}`);
  };
  const ok = (msg: string): void => console.log(`  [ ok ] ${msg}`);
  const warn = (msg: string): void => console.log(`  [warn] ${msg}`);

  // -------------------------------------------------------------------------
  // 1. Config
  // -------------------------------------------------------------------------
  console.log('\nConfig');
  let config: MControlConfig | undefined;
  if (!configExists()) {
    warn(`no config at ${globalConfigPath()} — run 'mctl init'`);
  } else {
    try {
      config = loadConfig();
      ok(`config valid: ${globalConfigPath()}`);
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  // -------------------------------------------------------------------------
  // 2. Tools roots
  // -------------------------------------------------------------------------
  console.log('\nTools roots');
  const roots = getToolsRoots(config);
  if (roots.length === 0) {
    fail(
      'no tools roots resolved — set paths.toolsRoots in config or M_CONTROL_TOOLS_ROOT'
    );
  }
  for (const root of roots) {
    if (fs.existsSync(root)) {
      ok(root);
    } else {
      warn(`${root} (does not exist — skipped by discovery)`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Discovery
  // -------------------------------------------------------------------------
  console.log('\nTool discovery');
  const { tools, errors } = discoverTools(roots);
  if (tools.length === 0) {
    warn('no tools discovered');
  } else {
    ok(`${tools.length} tool(s) discovered`);
  }
  for (const { file, error } of errors) {
    fail(`invalid manifest ${file}: ${error}`);
  }

  // -------------------------------------------------------------------------
  // 4. Runtimes required by discovered tools
  // -------------------------------------------------------------------------
  console.log('\nRuntimes');
  const runtimes = [...new Set(tools.map((t) => t.manifest.runtime))];
  if (runtimes.length === 0) {
    warn('no runtimes to check (no tools discovered)');
  }
  for (const runtime of runtimes) {
    // 'probe.dll' makes the dotnet runtime resolve to the `dotnet` host
    // command (a bare exe entry would be spawned directly and can't be probed).
    const { command } = resolveSpawnCommand(
      runtime,
      'probe.dll',
      config?.runtimes
    );
    if (runtimeAvailable(runtime, command)) {
      ok(`${runtime} -> ${command}`);
    } else {
      fail(
        `${runtime} -> "${command}" not found on PATH. ` +
          `Install it or override via config.runtimes.${runtime}`
      );
    }
  }

  console.log('');
  if (failed) {
    console.log('Doctor found problems — see [FAIL] lines above.');
    process.exit(1);
  }
  console.log('All checks passed.');
}

/** Probe availability by running the command with a harmless flag. */
function runtimeAvailable(runtime: ToolRuntime, command: string): boolean {
  const args =
    runtime === 'powershell'
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$PSVersionTable.PSVersion.Major',
        ]
      : ['--version'];
  const res = spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 });
  // ENOENT -> res.error set. A non-zero exit still means the binary exists.
  return res.error === undefined;
}
