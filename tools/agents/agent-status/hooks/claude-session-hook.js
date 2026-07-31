#!/usr/bin/env node
/**
 * claude-session-hook — Claude Code lifecycle hook for agent-status.
 *
 * Installed into ~/.claude/settings.json by `mctl run agent-status setup=claude-hooks`.
 * Claude Code invokes it on session lifecycle events and pipes a JSON payload
 * (session_id, cwd, hook_event_name, ...) on stdin. It maintains a registry of
 * LIVE sessions at ~/.m-control/state/claude-sessions.json so agent-status can
 * KNOW a session is active instead of guessing from log-file heuristics:
 *
 *   SessionStart      -> register session as working (records the claude PID)
 *   UserPromptSubmit  -> state = working
 *   Stop              -> state = awaiting-input (agent replied)
 *   Notification      -> state = awaiting-input (permission / attention prompt)
 *   SessionEnd        -> remove session from the registry
 *
 * Hard rules: never block Claude Code (8s self-kill timer), never write to
 * stdout (UserPromptSubmit stdout is injected into the model context), never
 * exit non-zero — a broken status dashboard must not break the user's session.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const STATE_DIR =
  process.env.M_CONTROL_STATE_DIR || path.join(os.homedir(), '.m-control', 'state');
const REGISTRY_FILE = path.join(STATE_DIR, 'claude-sessions.json');

// Matches "claude" as a standalone token in a command line (claude, claude.exe,
// node .../claude.js) without matching mere path fragments like C:\.claude\.
const CLAUDE_CMD_RE = /(?:^|[\\/\s"'=])claude(?:\.exe|\.cmd|\.js|\.mjs)?(?:["'\s]|$)/i;

// Give up quietly if anything hangs — never stall the user's session.
setTimeout(() => process.exit(0), 8000).unref();

/** Return { ppid, cmd } for a PID, or null. Platform-specific, best-effort. */
function parentOf(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
      // Fields after the last ')' are: state ppid ...
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      let cmd = '';
      try {
        cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ').trim();
      } catch {
        /* kernel threads have no cmdline */
      }
      return { ppid: Number(rest[1]), cmd };
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}' | ` +
            'Select-Object ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress',
        ],
        { timeout: 5000, windowsHide: true, encoding: 'utf-8' }
      );
      const p = JSON.parse(out);
      return { ppid: Number(p.ParentProcessId), cmd: String(p.CommandLine || p.Name || '') };
    }
    // darwin and other unixes
    const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], {
      timeout: 5000,
      encoding: 'utf-8',
    });
    const m = out.trim().match(/^(\d+)\s+(.*)$/);
    return m ? { ppid: Number(m[1]), cmd: m[2] } : null;
  } catch {
    return null;
  }
}

/**
 * Walk up the parent chain (hook <- shell <- claude <- terminal) and return
 * the PID of the claude process that spawned us, or null.
 */
function findClaudeAncestorPid() {
  let pid = process.ppid;
  for (let hop = 0; hop < 6 && pid > 1; hop++) {
    const info = parentOf(pid);
    if (!info) return null;
    if (CLAUDE_CMD_RE.test(info.cmd)) return pid;
    pid = info.ppid;
  }
  return null;
}

function readRegistry() {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') {
      return raw;
    }
  } catch {
    /* missing or corrupt — start fresh */
  }
  return { version: 1, sessions: {} };
}

function writeRegistry(registry) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${REGISTRY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
  fs.renameSync(tmp, REGISTRY_FILE); // atomic on the same filesystem
}

function handle(event) {
  const sessionId = event.session_id;
  if (!sessionId) return;

  const registry = readRegistry();
  const name = event.hook_event_name;

  if (name === 'SessionEnd') {
    if (registry.sessions[sessionId]) {
      delete registry.sessions[sessionId];
      writeRegistry(registry);
    }
    return;
  }

  const existing = registry.sessions[sessionId];
  const entry = existing || {
    // PID discovery costs a few subprocess calls, so only do it when the
    // session is first seen (SessionStart, or first event after hook install).
    pid: findClaudeAncestorPid(),
    startedAt: new Date().toISOString(),
  };

  if (name === 'SessionStart') {
    entry.pid = findClaudeAncestorPid() ?? entry.pid ?? null; // resume = new PID
    entry.state = 'working';
    entry.note = null;
  } else if (name === 'UserPromptSubmit') {
    entry.state = 'working';
    entry.note = null;
  } else if (name === 'Stop') {
    entry.state = 'awaiting-input';
    entry.note = 'agent replied — response waiting for you';
  } else if (name === 'Notification') {
    entry.state = 'awaiting-input';
    entry.note = event.message
      ? `needs attention: ${String(event.message).slice(0, 120)}`
      : 'needs attention (permission or idle prompt)';
  } else {
    return; // unknown event — leave the registry untouched
  }

  entry.cwd = event.cwd || entry.cwd || null;
  entry.transcript = event.transcript_path || entry.transcript || null;
  entry.updatedAt = new Date().toISOString();
  registry.sessions[sessionId] = entry;
  writeRegistry(registry);
}

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  try {
    handle(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
  } catch {
    /* never break the user's Claude Code session over a status dashboard */
  }
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
