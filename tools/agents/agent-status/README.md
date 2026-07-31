# agent-status

> One dashboard for all your pending AI coding-agent sessions — Claude Code,
> Codex CLI, Cursor background agents, and GitHub Copilot coding agent.

If you run multiple simultaneous agent sessions across tools, this answers
"who has replied and who is still working?" in a single command instead of
tab-cycling through every app.

## Usage

```bash
mctl run agent-status                          # all providers, last 24h
mctl run agent-status providers=claude-code,cursor
mctl run agent-status maxAgeHours=8            # narrower window
mctl run agent-status showIdle=true            # include stale/abandoned sessions
mctl run agent-status --json                   # raw NDJSON for scripting/widgets

# Poor man's live widget:
watch -n 30 mctl run agent-status
```

## Statuses

| Status | Meaning |
|--------|---------|
| `awaiting-input` | The agent finished and is waiting on **you** (a reply/PR to review) |
| `working` | The agent is actively doing something right now |
| `failed` | The agent errored or expired |
| `idle` | Closed or stale session (hidden unless `showIdle=true`) |

Each agent also carries `verified: true|false` — whether the status is backed
by a live-process check (hooks/PID/API) or is only a log-file heuristic.
Unverified `awaiting-input` is marked `(unverified)` in the output.

## Verified live status for Claude Code (recommended)

Log files alone cannot distinguish "agent replied, waiting for you" from
"terminal was closed" — the file looks identical. Fix it once with:

```bash
mctl run agent-status setup=claude-hooks     # setup=remove-claude-hooks to undo
```

This installs Claude Code lifecycle hooks (in `~/.claude/settings.json`,
after backing it up) that maintain a live-session registry at
`~/.m-control/state/claude-sessions.json`:

- `SessionStart` / `UserPromptSubmit` → session registered as `working` (with its PID)
- `Stop` → `awaiting-input` (agent replied)
- `Notification` → `awaiting-input` (permission prompt / needs attention)
- `SessionEnd` → removed from the registry

On every run the tool verifies each registered PID is still alive, so even a
killed terminal (where `SessionEnd` never fired) is reported as closed and
pruned. Restart any running Claude Code sessions after installing.

Without hooks the tool falls back to heuristics, with one hard guarantee: if
**no** `claude` process is running on the machine, stale sessions are reported
as closed, never as `awaiting-input`. The same process-scan guard applies to
Codex (which has no hook API).

## Providers

| Provider | Source | Needs config? |
|----------|--------|---------------|
| `claude-code` | Local session logs in `~/.claude/projects/` | no |
| `codex` | Local Codex CLI session logs in `~/.codex/sessions/` | no |
| `cursor` | Cursor **cloud Background Agents** API (`api.cursor.com`) | `cursorApiKey` |
| `cursor-ide` | Chats/agents inside the **Cursor desktop app** (local SQLite state) | no (Node ≥ 22.5) |
| `copilot` | GitHub API — open PRs authored by the Copilot coding agent | `githubToken` |

Note the Cursor split: the API only knows about cloud Background Agents
(launched from cursor.com/agents or "run in background"); sessions inside the
desktop IDE never appear there. `cursor-ide` covers those by reading Cursor's
local state (`workspaceStorage`/`globalStorage` `state.vscdb`) via `node:sqlite`.
If no Cursor process is running, IDE sessions are reported closed.

Providers that lack config or local data are skipped with a log line — never
an error. Claude Code **web** sessions have no public status API yet; local
CLI sessions are covered.

## Config

All keys optional, under `tools.agent-status` in `~/.m-control/config.json`:

| Key | Description |
|-----|-------------|
| `cursorApiKey` | Cursor API key (see below) |
| `githubToken` | GitHub PAT (see below) |
| `githubOwners` | Comma-separated owners/orgs to scope the Copilot PR search. Default: PRs involving you or awaiting your review |
| `claudeProjectsDir` | Override the Claude Code projects dir |
| `codexSessionsDir` | Override the Codex sessions dir |
| `cursorIdeDir` | Override the Cursor `User` dir (default: `%APPDATA%\Cursor\User` / `~/Library/Application Support/Cursor/User` / `~/.config/Cursor/User`) |

### Getting the tokens

**Cursor** — [cursor.com/dashboard](https://cursor.com/dashboard) →
**Integrations** → **API Keys** → *Create API Key* (requires a plan with
Background Agents). Copy the `key_...` value:

```json
"tools": { "agent-status": { "cursorApiKey": "key_..." } }
```

**GitHub Copilot** — [github.com/settings/tokens](https://github.com/settings/tokens)
→ *Generate new token (classic)* → scope: `repo` (private repos) or
`public_repo`. Fine-grained tokens also work with *Pull requests: read* +
*Contents: read* on the relevant repos:

```json
"tools": { "agent-status": { "githubToken": "ghp_...", "githubOwners": "your-org" } }
```

## How local status is inferred (fallback heuristics)

When the hook registry is not available:

- Session file modified in the last `activeSeconds` (default 120) → `working`
- Otherwise the tail of the log is scanned: last actor `assistant` →
  `awaiting-input (unverified)`; last actor `user` → `idle`
- If no `claude`/`codex` process is running at all → `idle` (closed), never
  `awaiting-input`
- Sessions untouched for more than `maxAgeHours` (default 24) are ignored

These heuristics work against undocumented local log formats and may need
updating when the CLIs change their formats — prefer installing the hooks.

## Notes / future

- The `result` payload is stable structured data (`summary`, `providers`,
  `agents[]`) — intended as the data source for a real always-on widget later
  (Stream Deck / tray / web dashboard, see roadmap).
- Possible next providers: Claude Code web sessions (when an API exists),
  Azure DevOps-hosted agents, Jules, Devin.
