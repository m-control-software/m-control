import { ChildProcess, spawn, spawnSync } from 'child_process';

/**
 * Stopping a tool stops everything it started. A guardrail that stopped only
 * the tool process left its children running unsupervised: on Windows the
 * kill is TerminateProcess, which never reaches children (yt-download's yt-dlp
 * kept downloading after RUNNER_TIMEOUT), and on POSIX SIGTERM reaches the
 * children only if the tool forwards it.
 *
 * Consequence for tools (docs/architecture/constraints.md): a process that
 * must outlive the run must not be a descendant of the tool.
 */

/** Every descendant of `root` in a (pid, ppid) table, parents before children. */
export function descendantsOf(
  root: number,
  table: ReadonlyArray<readonly [pid: number, ppid: number]>
): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of table) {
    if (pid === ppid) continue; // pid 0 on some systems; never a real edge
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/** `ps -A -o pid= -o ppid=` output -> (pid, ppid) pairs. */
export function parsePsTable(stdout: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}

/**
 * Stop `proc` and all its descendants. Never throws: a guardrail must always
 * end the run, so every failure falls back to stopping the tool process alone,
 * with a warning on stderr (the runner's only terminal output besides
 * forwarding the tool's own stderr).
 */
export function killProcessTree(proc: ChildProcess, toolId: string): void {
  const pid = proc.pid;
  if (pid === undefined) return; // never started; 'error' reports it
  const fallback = (why: string): void => {
    process.stderr.write(
      `[runner:${toolId}] could not stop the tool's child processes (${why}); stopping the tool only\n`
    );
    proc.kill('SIGTERM');
  };

  if (process.platform === 'win32') {
    // /T walks the tree by parent pid, /F is TerminateProcess for each.
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('error', (err) => fallback(`taskkill: ${err.message}`));
    killer.on('exit', (code) => {
      // Non-zero with the tool still running: e.g. access denied. (128 = the
      // tool had already exited, which needs nothing.)
      if (code !== 0 && proc.exitCode === null && proc.signalCode === null) {
        fallback(`taskkill exited with ${String(code)}`);
      }
    });
    return;
  }

  // Snapshot before killing anything: once the tool dies, its children are
  // re-parented and no longer traceable to it.
  const ps = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
    encoding: 'utf-8',
    timeout: 2_000,
  });
  if (ps.status !== 0) {
    fallback(`ps: ${ps.error?.message ?? `exit ${String(ps.status)}`}`);
    return;
  }
  const descendants = descendantsOf(pid, parsePsTable(ps.stdout));
  proc.kill('SIGTERM');
  for (const child of descendants) {
    try {
      process.kill(child, 'SIGTERM');
    } catch {
      // already gone
    }
  }
}
