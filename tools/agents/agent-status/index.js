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

const ALL_PROVIDERS = ['claude-code', 'codex', 'cursor', 'copilot'];

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

async function scanClaudeCode(config, opts) {
  const provider = 'claude-code';
  const root =
    (config['agent-status.claudeProjectsDir'] || '') ||
    path.join(os.homedir(), '.claude', 'projects');

  if (!(await safeStat(root))) {
    return { provider, ok: false, reason: `no local Claude Code sessions (${root} not found)`, agents: [] };
  }

  const agents = [];
  for (const project of await listDir(root)) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    for (const entry of await listDir(projectDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(projectDir, entry.name);
      const stat = await safeStat(file);
      if (!stat || Date.now() - stat.mtimeMs > opts.maxAgeMs) continue;

      const { status, detail } = await classifyLocalSession(file, stat.mtimeMs, opts);
      const cwd = extractCwd(await readHead(file));
      agents.push({
        provider,
        id: entry.name.replace(/\.jsonl$/, '').slice(0, 8),
        title: cwd || project.name,
        status,
        detail,
        lastActivity: toIso(stat.mtimeMs),
      });
    }
  }
  return { provider, ok: true, agents };
}

async function scanCodex(config, opts) {
  const provider = 'codex';
  const root =
    (config['agent-status.codexSessionsDir'] || '') ||
    path.join(os.homedir(), '.codex', 'sessions');

  if (!(await safeStat(root))) {
    return { provider, ok: false, reason: `no local Codex sessions (${root} not found)`, agents: [] };
  }

  // Layout: sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
  const files = [];
  await collectJsonl(root, 4, files);

  const agents = [];
  for (const file of files) {
    const stat = await safeStat(file);
    if (!stat || Date.now() - stat.mtimeMs > opts.maxAgeMs) continue;

    const { status, detail } = await classifyLocalSession(file, stat.mtimeMs, opts);
    const cwd = extractCwd(await readHead(file));
    const base = path.basename(file, '.jsonl');
    agents.push({
      provider,
      id: base.slice(-8),
      title: cwd || base,
      status,
      detail,
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
    return { provider, ok: true, agents };
  } catch (err) {
    return { provider, ok: false, reason: `Cursor API error: ${err.message}`, agents: [] };
  }
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
  copilot: fetchCopilot,
};

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

  return {
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

  const results = await Promise.all(
    opts.providers.map((p) => PROVIDERS[p](config, opts))
  );

  const providers = [];
  let agents = [];
  for (const r of results) {
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
    const label = a.status === 'awaiting-input' ? 'awaiting input' : a.status;
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

  result({ generatedAt: new Date().toISOString(), summary, providers, agents });
  process.exit(0);
}

main().catch((err) => {
  error(`Unhandled error: ${err.message}`, 'UNHANDLED_ERROR', false);
  process.exit(2);
});
