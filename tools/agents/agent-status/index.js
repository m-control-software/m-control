#!/usr/bin/env node
/**
 * agent-status — Tool Protocol v1
 *
 * Aggregates the status of pending AI coding-agent sessions into one view:
 *
 *   claude-code  — local Claude Code CLI sessions (~/.claude/projects/*.jsonl)
 *   codex        — local Codex CLI sessions (~/.codex/sessions/**.jsonl)
 *   cursor       — Cursor background agents (api.cursor.com, needs API key)
 *   copilot      — GitHub Copilot coding-agent PRs (api.github.com, needs token)
 *
 * Providers with missing config or missing local data are skipped gracefully —
 * the tool reports what it could see and why the rest was skipped.
 *
 * stdin  <- JSON ToolRequest (read to EOF before doing any work)
 * stdout -> NDJSON ToolEvent lines ONLY (never raw console.log)
 * stderr -> raw diagnostic output (allowed, not parsed)
 * exit      0 = success, 1 = expected failure (after error event), >=2 = crash
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const TOOL_ID = 'agent-status';

const ALL_PROVIDERS = ['claude-code', 'codex', 'cursor', 'cursor-ide', 'copilot'];

// Status vocabulary (ordered by how much the user cares):
//   awaiting-input — the agent finished and is waiting on you (the money shot)
//   working        — the agent is actively doing something
//   failed         — the agent errored / expired
//   idle           — stale session, probably abandoned (hidden unless showIdle=true)
const STATUS_ORDER = { 'awaiting-input': 0, working: 1, failed: 2, idle: 3, unknown: 4 };
const STATUS_ICONS = {
  'awaiting-input': '◉',
  working: '◐',
  failed: '✗',
  idle: '·',
  unknown: '?',
};

// ---------------------------------------------------------------------------
// Protocol helpers
// ---------------------------------------------------------------------------

function emit(type, payload) {
  process.stdout.write(
    JSON.stringify({ type, ts: new Date().toISOString(), toolId: TOOL_ID, payload }) + '\n'
  );
}

const started = (meta = {}) => emit('started', { meta });
const log = (level, message, data) =>
  emit('log', { level, message, ...(data !== undefined ? { data } : {}) });
const result = (payload) => emit('result', payload);
const error = (message, code, recoverable = true) =>
  emit('error', { message, code, recoverable });

function readRequest() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch (err) {
        reject(new Error(`Failed to parse ToolRequest from stdin: ${err.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

async function safeStat(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function listDir(p) {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Read up to `bytes` from the end of a file (session logs can be huge). */
async function readTail(file, bytes = 64 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    await handle.read(buf, 0, len, size - len);
    return buf.toString('utf-8');
  } finally {
    await handle.close();
  }
}

/** Read up to `bytes` from the start of a file. */
async function readHead(file, bytes = 8 * 1024) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    await handle.read(buf, 0, len, 0);
    return buf.toString('utf-8');
  } finally {
    await handle.close();
  }
}

/** Extract the session's working directory from a JSONL head chunk. */
function extractCwd(text) {
  const m = text.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

/**
 * Heuristic: who acted last in a JSONL session log?
 * Scans the last lines (newest first) for role/type markers. Works for both
 * Claude Code (`"type":"assistant"` / `"type":"user"`) and Codex rollout
 * files (`"role":"assistant"`, `"task_complete"`).
 */
function inferLastActor(tailText) {
  const lines = tailText.split('\n').filter((l) => l.trim().length > 0);
  const from = Math.max(0, lines.length - 50);
  for (let i = lines.length - 1; i >= from; i--) {
    const line = lines[i];
    if (/"task_complete"/.test(line)) return 'assistant';
    if (/"(?:type|role)"\s*:\s*"assistant"/.test(line)) return 'assistant';
    if (/"(?:type|role)"\s*:\s*"user"/.test(line)) return 'user';
  }
  return 'unknown';
}

/** Recursively collect .jsonl files under dir (bounded depth). */
async function collectJsonl(dir, depth, out) {
  if (depth < 0) return;
  for (const entry of await listDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectJsonl(full, depth - 1, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}

/** Classify a local session file into a status via mtime + last-actor heuristics. */
async function classifyLocalSession(file, mtimeMs, opts) {
  const ageMs = Date.now() - mtimeMs;
  if (ageMs < opts.activeMs) {
    return { status: 'working', detail: 'session log is being written right now' };
  }
  const actor = inferLastActor(await readTail(file));
  if (actor === 'assistant') {
    return { status: 'awaiting-input', detail: 'agent replied — response waiting for you' };
  }
  if (actor === 'user') {
    return { status: 'idle', detail: 'last entry is user input — session likely interrupted' };
  }
  return { status: 'idle', detail: 'inactive session' };
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Liveness: hook registry + process scan
// ---------------------------------------------------------------------------
// JSONL heuristics cannot tell "agent replied, waiting for you" apart from
// "terminal was closed" — the log file looks identical. Two extra signals fix
// that:
//   1. A live-session registry maintained by Claude Code lifecycle hooks
//      (install once: `mctl run agent-status setup=claude-hooks`). Ground truth.
//   2. A process scan: if no claude/codex process is running at all, nothing
//      can be awaiting input — stale "awaiting-input" gets demoted to closed.

const STATE_DIR =
  process.env.M_CONTROL_STATE_DIR || path.join(os.homedir(), '.m-control', 'state');
const REGISTRY_FILE = path.join(STATE_DIR, 'claude-sessions.json');

const CLAUDE_CMD_RE = /(?:^|[\\/\s"'=])claude(?:\.exe|\.cmd|\.js|\.mjs)?(?:["'\s]|$)/i;
const CODEX_CMD_RE = /(?:^|[\\/\s"'=])codex(?:\.exe|\.cmd|\.js|\.mjs)?(?:["'\s]|$)/i;

function execFileP(cmd, args, options) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** List running processes as [{ pid, cmd }], or null if the scan failed. */
async function listProcesses() {
  try {
    if (process.platform === 'win32') {
      const out = await execFileP(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
        ],
        { timeout: 15_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf-8' }
      );
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((p) => ({
        pid: Number(p.ProcessId),
        cmd: String(p.CommandLine || p.Name || ''),
      }));
    }
    const out = await execFileP('ps', ['-eo', 'pid=,args='], {
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf-8',
    });
    return out
      .split('\n')
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter(Boolean)
      .map((m) => ({ pid: Number(m[1]), cmd: m[2] }));
  } catch {
    return null;
  }
}

/**
 * Is `pid` alive? Prefer the scan snapshot (immune to PID reuse by unrelated
 * processes when combined with a cmd match upstream); fall back to signal 0.
 * Returns true / false, or null when it cannot be determined.
 */
function isPidAlive(pid, procs) {
  if (!Number.isFinite(pid) || pid == null) return null;
  if (procs) return procs.some((p) => p.pid === pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM' ? true : false;
  }
}

/** Registry written by hooks/claude-session-hook.js. */
async function readSessionRegistry() {
  try {
    const raw = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
    if (raw && typeof raw === 'object' && raw.sessions && typeof raw.sessions === 'object') {
      return { present: true, sessions: raw.sessions };
    }
  } catch {
    /* not installed yet, or unreadable */
  }
  return { present: false, sessions: {} };
}

// ---------------------------------------------------------------------------
// SQLite access (for Cursor IDE local state) — no dependencies
// ---------------------------------------------------------------------------
// node:sqlite ships with Node >=22.5 (unflagged in recent 22.x/23.4+). Prefer
// the in-process module; fall back to re-spawning ourselves with
// --experimental-sqlite for Node versions where it is still flag-gated.

let sqliteModule; // undefined = not probed, null = unavailable in-process
function getSqliteInProcess() {
  if (sqliteModule === undefined) {
    try {
      sqliteModule = require('node:sqlite');
    } catch {
      sqliteModule = null;
    }
  }
  return sqliteModule;
}

function querySqliteSync(dbPath, sql, params) {
  const sqlite = getSqliteInProcess();
  if (!sqlite) throw Object.assign(new Error('node:sqlite unavailable'), { code: 'NO_SQLITE' });
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

/** Query a SQLite db, tolerating flag-gated node:sqlite and busy/locked files. */
async function querySqlite(dbPath, sql, params = []) {
  try {
    return querySqliteSync(dbPath, sql, params);
  } catch (err) {
    if (err.code === 'NO_SQLITE') {
      // Older Node: re-exec this script in helper mode with the flag.
      const out = await execFileP(
        process.execPath,
        ['--experimental-sqlite', __filename, '--sqlite-helper', dbPath, sql, JSON.stringify(params)],
        { timeout: 15_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf-8', windowsHide: true }
      );
      return JSON.parse(out);
    }
    // Likely SQLITE_BUSY while the app is writing — retry against a temp copy.
    const tmp = path.join(os.tmpdir(), `agent-status-${process.pid}-${Date.now()}.vscdb`);
    try {
      await fs.copyFile(dbPath, tmp);
      return querySqliteSync(tmp, sql, params);
    } finally {
      await fs.rm(tmp, { force: true }).catch(() => {});
    }
  }
}

/** Drop registry entries whose process died without a SessionEnd hook firing. */
async function pruneSessionRegistry(deadIds) {
  if (deadIds.length === 0) return;
  try {
    const raw = JSON.parse(await fs.readFile(REGISTRY_FILE, 'utf-8'));
    for (const id of deadIds) delete raw.sessions[id];
    const tmp = `${REGISTRY_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(raw, null, 2));
    await fs.rename(tmp, REGISTRY_FILE);
  } catch {
    /* best-effort housekeeping — next run will retry */
  }
}

function relTime(iso) {
  if (!iso) return 'unknown age';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return 'unknown age';
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
// Each provider returns: { provider, ok, reason?, agents: Agent[] }
// Agent: { provider, id, title, status, detail, lastActivity, url? }

async function scanClaudeCode(config, opts, sys) {
  const provider = 'claude-code';
  const root =
    (config['agent-status.claudeProjectsDir'] || '') ||
    path.join(os.homedir(), '.claude', 'projects');

  if (!(await safeStat(root))) {
    return { provider, ok: false, reason: `no local Claude Code sessions (${root} not found)`, agents: [] };
  }

  const registry = await readSessionRegistry();
  const claudeProcs = sys.procs ? sys.procs.filter((p) => CLAUDE_CMD_RE.test(p.cmd)) : null;

  const agents = [];
  const deadIds = [];
  const hints = [];

  for (const project of await listDir(root)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    for (const entry of await listDir(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(projectDir, entry.name);
      const stat = await safeStat(file);
      if (!stat || Date.now() - stat.mtimeMs > opts.maxAgeMs) continue;

      const sessionId = entry.name.replace(/\.jsonl$/, '');
      const reg = registry.sessions[sessionId];
      let status;
      let detail;
      let verified = false;

      if (Date.now() - stat.mtimeMs < opts.activeMs) {
        // Actively being written — live by definition, registry or not.
        status = 'working';
        detail = 'session log is being written right now';
        verified = true;
      } else if (reg) {
        const alive = isPidAlive(reg.pid, claudeProcs);
        if (alive === false) {
          // Crash / killed terminal: SessionEnd never fired, but the PID is gone.
          status = 'idle';
          detail = 'session closed (its process is gone)';
          verified = true;
          deadIds.push(sessionId);
        } else {
          verified = alive === true;
          if (reg.state === 'working') {
            status = 'working';
            detail = verified ? 'live session — agent is working' : 'agent is working (hooks)';
          } else {
            status = 'awaiting-input';
            detail =
              (reg.note || 'agent replied — response waiting for you') +
              (verified ? ' (verified live)' : '');
          }
        }
      } else if (registry.present) {
        // Hooks are installed and tracking; an untracked session is not live.
        status = 'idle';
        detail = 'session closed (not in the live-session registry)';
        verified = true;
      } else {
        // No hooks installed — heuristic mode, but never claim "awaiting input"
        // when there is provably no claude process on the whole machine.
        ({ status, detail } = await classifyLocalSession(file, stat.mtimeMs, opts));
        if (status === 'awaiting-input') {
          if (claudeProcs && claudeProcs.length === 0) {
            status = 'idle';
            detail = 'session closed (no Claude Code process is running)';
            verified = true;
          } else {
            detail += ' — unverified';
          }
        }
      }

      const cwd = extractCwd(await readHead(file));
      agents.push({
        provider,
        id: sessionId.slice(0, 8),
        title: cwd || project.name,
        status,
        detail,
        verified,
        lastActivity: toIso(stat.mtimeMs),
      });
    }
  }

  await pruneSessionRegistry(deadIds);
  if (!registry.present && agents.length > 0) {
    hints.push(
      "claude-code statuses are heuristic — run 'mctl run agent-status setup=claude-hooks' " +
        'once to install lifecycle hooks and get verified live status'
    );
  }
  return { provider, ok: true, agents, hints };
}

async function scanCodex(config, opts, sys) {
  const provider = 'codex';
  const root =
    (config['agent-status.codexSessionsDir'] || '') ||
    path.join(os.homedir(), '.codex', 'sessions');

  if (!(await safeStat(root))) {
    return { provider, ok: false, reason: `no local Codex sessions (${root} not found)`, agents: [] };
  }

  const codexProcs = sys.procs ? sys.procs.filter((p) => CODEX_CMD_RE.test(p.cmd)) : null;

  // Layout: sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
  const files = [];
  await collectJsonl(root, 4, files);

  const agents = [];
  for (const file of files) {
    const stat = await safeStat(file);
    if (!stat || Date.now() - stat.mtimeMs > opts.maxAgeMs) continue;

    let { status, detail } = await classifyLocalSession(file, stat.mtimeMs, opts);
    let verified = status === 'working';
    // Codex has no hook API for a live registry, but the process scan still
    // stops closed sessions from masquerading as "awaiting input".
    if (status === 'awaiting-input') {
      if (codexProcs && codexProcs.length === 0) {
        status = 'idle';
        detail = 'session closed (no Codex process is running)';
        verified = true;
      } else {
        detail += ' — unverified';
      }
    }
    const cwd = extractCwd(await readHead(file));
    const base = path.basename(file, '.jsonl');
    agents.push({
      provider,
      id: base.slice(-8),
      title: cwd || base,
      status,
      detail,
      verified,
      lastActivity: toIso(stat.mtimeMs),
    });
  }
  return { provider, ok: true, agents };
}

async function fetchCursor(config, opts) {
  const provider = 'cursor';
  const apiKey = config['agent-status.cursorApiKey'];
  if (!apiKey) {
    return { provider, ok: false, reason: 'cursorApiKey not configured — skipped', agents: [] };
  }

  try {
    const res = await fetch('https://api.cursor.com/v0/agents?limit=50', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(opts.httpTimeoutMs),
    });
    if (!res.ok) {
      throw new Error(`api.cursor.com returned HTTP ${res.status}`);
    }
    const body = await res.json();
    const list = Array.isArray(body.agents) ? body.agents : Array.isArray(body) ? body : [];

    const agents = [];
    for (const a of list) {
      const raw = String(a.status || '').toUpperCase();
      let status = 'unknown';
      if (['RUNNING', 'CREATING', 'PENDING', 'QUEUED'].includes(raw)) status = 'working';
      else if (['FINISHED', 'COMPLETED'].includes(raw)) status = 'awaiting-input';
      else if (['ERROR', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(raw)) status = 'failed';

      const lastActivity = a.updatedAt || a.createdAt || null;
      // Non-running agents older than the window are history, not "pending".
      if (
        status !== 'working' &&
        lastActivity &&
        Date.now() - Date.parse(lastActivity) > opts.maxAgeMs
      ) {
        continue;
      }
      agents.push({
        provider,
        id: String(a.id ?? ''),
        title: a.name || a.summary || (a.source && a.source.repository) || 'background agent',
        status,
        detail: `Cursor status: ${a.status}`,
        lastActivity,
        url: (a.target && a.target.url) || a.url || undefined,
      });
    }
    const hints = [];
    if (agents.length === 0) {
      hints.push(
        'cursor API is reachable but lists 0 cloud Background Agents — chats inside the ' +
          'Cursor desktop IDE are covered by the cursor-ide provider instead'
      );
    }
    return { provider, ok: true, agents, hints };
  } catch (err) {
    return { provider, ok: false, reason: `Cursor API error: ${err.message}`, agents: [] };
  }
}

// ---------------------------------------------------------------------------
// cursor-ide — chats/agents inside the Cursor desktop app (local SQLite state)
// ---------------------------------------------------------------------------
// Cursor has no public API for IDE sessions; it persists them locally:
//   <User>/workspaceStorage/<hash>/workspace.json     -> which folder
//   <User>/workspaceStorage/<hash>/state.vscdb        -> composer list (ItemTable)
//   <User>/globalStorage/state.vscdb                  -> conversations (cursorDiskKV)
// Message types in conversations: 1 = user, 2 = assistant.

const CURSOR_CMD_RE = /(?:^|[\\/\s"'=])cursor(?:\.exe|\.cmd|\.AppImage)?(?:["'\s]|$)/i;

function cursorUserDir(config) {
  const override = config['agent-status.cursorIdeDir'];
  if (override) return String(override);
  if (process.platform === 'win32') {
    const appData =
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
  }
  return path.join(os.homedir(), '.config', 'Cursor', 'User');
}

function fileUriToPath(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'file:') return uri;
    let p = decodeURIComponent(u.pathname);
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // windows /C:/...
    return process.platform === 'win32' ? p.replace(/\//g, '\\') : p;
  } catch {
    return uri;
  }
}

/** vscdb value columns are BLOB-typed — rows may come back as text or bytes. */
function sqliteText(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf-8');
  return String(value);
}

/** 1 = user, 2 = assistant, null = unknown. */
function lastBubbleType(composerJson) {
  const list = Array.isArray(composerJson.conversation)
    ? composerJson.conversation
    : Array.isArray(composerJson.fullConversationHeadersOnly)
      ? composerJson.fullConversationHeadersOnly
      : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i] && list[i].type;
    if (t === 1 || t === 2) return t;
  }
  return null;
}

async function scanCursorIde(config, opts, sys) {
  const provider = 'cursor-ide';
  const userDir = cursorUserDir(config);

  if (!(await safeStat(userDir))) {
    return { provider, ok: false, reason: `Cursor desktop not found (${userDir} missing)`, agents: [] };
  }

  const cursorProcs = sys.procs ? sys.procs.filter((p) => CURSOR_CMD_RE.test(p.cmd)) : null;
  const cursorRunning = cursorProcs === null ? null : cursorProcs.length > 0;

  // Collect recent composers across workspaces.
  const composers = []; // { id, name, lastUpdatedAt, folder }
  try {
    const wsRoot = path.join(userDir, 'workspaceStorage');
    for (const ws of await listDir(wsRoot)) {
      if (!ws.isDirectory()) continue;
      const wsDir = path.join(wsRoot, ws.name);
      const db = path.join(wsDir, 'state.vscdb');
      const stat = await safeStat(db);
      if (!stat || Date.now() - stat.mtimeMs > opts.maxAgeMs) continue;

      let folder = ws.name;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(wsDir, 'workspace.json'), 'utf-8'));
        if (meta.folder) folder = fileUriToPath(meta.folder);
      } catch {
        /* workspace.json optional */
      }

      let rows;
      try {
        rows = await querySqlite(
          db,
          "SELECT value FROM ItemTable WHERE key = 'composer.composerData'"
        );
      } catch (err) {
        if (err.code === 'NO_SQLITE' || /unknown or not supported|bad option/i.test(String(err.message))) {
          return {
            provider,
            ok: false,
            reason: 'reading Cursor IDE state needs Node >= 22.5 (node:sqlite)',
            agents: [],
          };
        }
        continue; // this workspace's db is unreadable right now — skip it
      }
      if (!rows[0]) continue;
      try {
        for (const c of JSON.parse(sqliteText(rows[0].value)).allComposers ?? []) {
          const ts = Number(c.lastUpdatedAt ?? c.createdAt ?? 0);
          if (!ts || Date.now() - ts > opts.maxAgeMs) continue;
          composers.push({ id: String(c.composerId), name: c.name || '', lastUpdatedAt: ts, folder });
        }
      } catch {
        /* malformed composer blob — skip workspace */
      }
    }
  } catch (err) {
    return { provider, ok: false, reason: `failed to read Cursor state: ${err.message}`, agents: [] };
  }

  // One lookup in the global conversation store to see who spoke last.
  const lastTypeById = new Map();
  if (composers.length > 0) {
    try {
      const keys = composers.map((c) => `composerData:${c.id}`);
      const rows = await querySqlite(
        path.join(userDir, 'globalStorage', 'state.vscdb'),
        `SELECT key, value FROM cursorDiskKV WHERE key IN (${keys.map(() => '?').join(',')})`,
        keys
      );
      for (const row of rows) {
        try {
          lastTypeById.set(
            sqliteText(row.key).replace('composerData:', ''),
            lastBubbleType(JSON.parse(sqliteText(row.value)))
          );
        } catch {
          /* single bad row — leave unknown */
        }
      }
    } catch {
      /* global store unreadable — statuses degrade to idle/working below */
    }
  }

  const agents = [];
  for (const c of composers) {
    const ageMs = Date.now() - c.lastUpdatedAt;
    const last = lastTypeById.get(c.id) ?? null;
    let status;
    let detail;
    let verified = false;

    if (cursorRunning === false) {
      status = 'idle';
      detail = 'session closed (Cursor desktop is not running)';
      verified = true;
    } else if (ageMs < opts.activeMs) {
      status = 'working';
      detail = 'Cursor agent active right now';
      verified = cursorRunning === true;
    } else if (last === 2) {
      status = 'awaiting-input';
      detail = 'agent replied in Cursor IDE — unverified';
    } else if (last === 1) {
      status = 'idle';
      detail = 'last message is yours — likely interrupted';
    } else {
      status = 'idle';
      detail = 'inactive Cursor IDE chat';
    }

    agents.push({
      provider,
      id: c.id.slice(0, 8),
      title: c.name ? `${c.folder} — ${c.name}` : c.folder,
      status,
      detail,
      verified,
      lastActivity: toIso(c.lastUpdatedAt),
    });
  }
  return { provider, ok: true, agents };
}

async function fetchCopilot(config, opts) {
  const provider = 'copilot';
  const token = config['agent-status.githubToken'];
  if (!token) {
    return { provider, ok: false, reason: 'githubToken not configured — skipped', agents: [] };
  }

  // Copilot coding agent works inside draft PRs it authors; a PR leaving
  // draft means the agent is done and waiting for review.
  const base = 'is:pr is:open author:app/copilot-swe-agent';
  const owners = String(config['agent-status.githubOwners'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const scopes =
    owners.length > 0
      ? owners.map((o) => `user:${o}`)
      : ['involves:@me', 'review-requested:@me'];

  try {
    const byId = new Map();
    for (const scope of scopes) {
      const q = encodeURIComponent(`${base} ${scope}`);
      const res = await fetch(
        `https://api.github.com/search/issues?q=${q}&per_page=50`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'm-control-agent-status',
          },
          signal: AbortSignal.timeout(opts.httpTimeoutMs),
        }
      );
      if (!res.ok) {
        throw new Error(`api.github.com returned HTTP ${res.status} for scope "${scope}"`);
      }
      const body = await res.json();
      for (const item of body.items ?? []) {
        byId.set(item.id, item);
      }
    }

    const agents = [...byId.values()].map((pr) => {
      const repo = String(pr.repository_url || '').replace('https://api.github.com/repos/', '');
      const working = pr.draft === true;
      return {
        provider,
        id: `${repo}#${pr.number}`,
        title: pr.title,
        status: working ? 'working' : 'awaiting-input',
        detail: working ? 'Copilot is still working (PR in draft)' : 'PR ready for your review',
        lastActivity: pr.updated_at || null,
        url: pr.html_url,
      };
    });
    return { provider, ok: true, agents };
  } catch (err) {
    return { provider, ok: false, reason: `GitHub API error: ${err.message}`, agents: [] };
  }
}

const PROVIDERS = {
  'claude-code': scanClaudeCode,
  codex: scanCodex,
  cursor: fetchCursor,
  'cursor-ide': scanCursorIde,
  copilot: fetchCopilot,
};

const LOCAL_PROVIDERS = ['claude-code', 'codex', 'cursor-ide'];

// ---------------------------------------------------------------------------
// setup=claude-hooks — install/remove the lifecycle hooks in ~/.claude/settings.json
// ---------------------------------------------------------------------------

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'];
const HOOK_MARKER = 'claude-session-hook.js';

async function setupClaudeHooks(action) {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const hookScript = path.join(__dirname, 'hooks', 'claude-session-hook.js');
  const command = `node "${hookScript}"`;

  let settings = {};
  const stat = await safeStat(settingsPath);
  if (stat) {
    try {
      settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    } catch (err) {
      throw Object.assign(
        new Error(
          `${settingsPath} exists but is not valid JSON (${err.message}) — ` +
            'fix it manually, then re-run setup'
        ),
        { code: 'SETTINGS_UNREADABLE' }
      );
    }
    await fs.copyFile(settingsPath, `${settingsPath}.agent-status.bak`);
    log('info', `backed up existing settings to ${settingsPath}.agent-status.bak`);
  }

  if (typeof settings.hooks !== 'object' || settings.hooks === null) settings.hooks = {};

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    // Drop any previous install of ours (identified by the script name), then
    // re-add — this makes setup idempotent and repairs a moved repo path.
    const kept = groups.filter(
      (g) => !(g && Array.isArray(g.hooks) && g.hooks.some((h) => String(h.command).includes(HOOK_MARKER)))
    );
    if (action === 'install') {
      kept.push({ hooks: [{ type: 'command', command }] });
    }
    if (kept.length > 0) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  if (action === 'install') {
    log('info', `hooks installed in ${settingsPath} (${HOOK_EVENTS.join(', ')})`);
    log('info', 'restart any running Claude Code sessions to activate them');
    log('info', 'from then on, agent-status reports verified live status for claude-code');
  } else {
    log('info', `agent-status hooks removed from ${settingsPath}`);
  }
  return { action, settingsPath, hookScript, events: action === 'install' ? HOOK_EVENTS : [] };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseOptions(input) {
  const maxAgeHours = Number(input.maxAgeHours ?? 24);
  const activeSeconds = Number(input.activeSeconds ?? 120);
  const requested = String(input.providers ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const unknown = requested.filter((p) => !ALL_PROVIDERS.includes(p));
  if (unknown.length > 0) {
    throw Object.assign(
      new Error(
        `Unknown provider(s): ${unknown.join(', ')}. Valid: ${ALL_PROVIDERS.join(', ')}`
      ),
      { code: 'BAD_INPUT' }
    );
  }

  const setup = String(input.setup ?? '');
  if (setup && !['claude-hooks', 'remove-claude-hooks'].includes(setup)) {
    throw Object.assign(
      new Error(`Unknown setup action: "${setup}". Valid: claude-hooks, remove-claude-hooks`),
      { code: 'BAD_INPUT' }
    );
  }

  return {
    setup: setup || null,
    providers: requested.length > 0 ? requested : ALL_PROVIDERS,
    maxAgeMs: (Number.isFinite(maxAgeHours) ? maxAgeHours : 24) * 3_600_000,
    activeMs: (Number.isFinite(activeSeconds) ? activeSeconds : 120) * 1_000,
    httpTimeoutMs: 10_000,
    showIdle: String(input.showIdle ?? '') === 'true',
    maxPerProvider: 50,
  };
}

async function main() {
  started();

  let request;
  try {
    request = await readRequest();
  } catch (err) {
    error(err.message, 'INVALID_REQUEST', false);
    process.exit(1);
  }

  const { context, input } = request;
  const config = context.config ?? {};

  let opts;
  try {
    opts = parseOptions(input ?? {});
  } catch (err) {
    error(err.message, err.code ?? 'BAD_INPUT', true);
    process.exit(1);
  }

  if (opts.setup) {
    try {
      const payload = await setupClaudeHooks(
        opts.setup === 'claude-hooks' ? 'install' : 'remove'
      );
      result(payload);
      process.exit(0);
    } catch (err) {
      error(err.message, err.code ?? 'SETUP_FAILED', true);
      process.exit(1);
    }
  }

  // One process-list snapshot shared by the local providers for liveness checks.
  const needsLocal = opts.providers.some((p) => LOCAL_PROVIDERS.includes(p));
  const sys = { procs: needsLocal ? await listProcesses() : null };

  const results = await Promise.all(
    opts.providers.map((p) => PROVIDERS[p](config, opts, sys))
  );

  const providers = [];
  const hints = [];
  let agents = [];
  for (const r of results) {
    hints.push(...(r.hints ?? []));
    providers.push({
      id: r.provider,
      ok: r.ok,
      ...(r.reason ? { reason: r.reason } : {}),
      count: r.agents.length,
    });
    if (!r.ok) {
      log('info', `[${r.provider}] skipped: ${r.reason}`);
    }
    agents.push(
      ...r.agents
        .sort((a, b) => String(b.lastActivity).localeCompare(String(a.lastActivity)))
        .slice(0, opts.maxPerProvider)
    );
  }

  if (!opts.showIdle) {
    agents = agents.filter((a) => a.status !== 'idle');
  }

  agents.sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      String(b.lastActivity).localeCompare(String(a.lastActivity))
  );

  for (const a of agents) {
    const icon = STATUS_ICONS[a.status] ?? '?';
    let label = a.status === 'awaiting-input' ? 'awaiting input' : a.status;
    if (a.status === 'awaiting-input' && a.verified === false) label += ' (unverified)';
    log(
      'info',
      `${icon} [${a.provider}] ${a.title} (${a.id}) — ${label} · ${relTime(a.lastActivity)}`
    );
  }

  const count = (s) => agents.filter((a) => a.status === s).length;
  const summary = {
    total: agents.length,
    awaitingInput: count('awaiting-input'),
    working: count('working'),
    failed: count('failed'),
  };

  log(
    'info',
    `${summary.awaitingInput} awaiting input, ${summary.working} working, ` +
      `${summary.failed} failed · providers: ${providers
        .map((p) => `${p.id}${p.ok ? `(${p.count})` : '(skipped)'}`)
        .join(', ')}`
  );
  for (const hint of hints) {
    log('info', `tip: ${hint}`);
  }

  result({ generatedAt: new Date().toISOString(), summary, providers, agents });
  process.exit(0);
}

// Helper mode: `node --experimental-sqlite index.js --sqlite-helper <db> <sql> <paramsJson>`
// Used when node:sqlite is flag-gated in the host Node. Prints raw JSON rows —
// this is a subprocess of the tool itself, not a Tool Protocol endpoint.
if (process.argv[2] === '--sqlite-helper') {
  try {
    const [, , , dbPath, sql, paramsJson] = process.argv;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    process.stdout.write(JSON.stringify(db.prepare(sql).all(...JSON.parse(paramsJson))));
    db.close();
    process.exit(0);
  } catch (err) {
    process.stderr.write(String(err.message));
    process.exit(1);
  }
}

main().catch((err) => {
  error(`Unhandled error: ${err.message}`, 'UNHANDLED_ERROR', false);
  process.exit(2);
});
