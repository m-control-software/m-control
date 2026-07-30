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
| `idle` | Stale session, probably abandoned (hidden unless `showIdle=true`) |

## Providers

| Provider | Source | Needs config? |
|----------|--------|---------------|
| `claude-code` | Local session logs in `~/.claude/projects/` | no |
| `codex` | Local Codex CLI session logs in `~/.codex/sessions/` | no |
| `cursor` | Cursor Background Agents API (`api.cursor.com`) | `cursorApiKey` |
| `copilot` | GitHub API — open PRs authored by the Copilot coding agent | `githubToken` |

Providers that lack config or local data are skipped with a log line — never
an error. Claude Code **web** sessions have no public status API yet; local
CLI sessions are covered.

## Config

All keys optional, under `tools.agent-status` in `~/.m-control/config.json`:

| Key | Description |
|-----|-------------|
| `cursorApiKey` | Cursor API key (Cursor → Settings → API keys) |
| `githubToken` | GitHub PAT with `repo` read scope (for Copilot PR search) |
| `githubOwners` | Comma-separated owners/orgs to scope the Copilot PR search. Default: PRs involving you or awaiting your review |
| `claudeProjectsDir` | Override the Claude Code projects dir |
| `codexSessionsDir` | Override the Codex sessions dir |

## How local status is inferred (heuristics)

- Session file modified in the last `activeSeconds` (default 120) → `working`
- Otherwise the tail of the log is scanned: last actor `assistant` →
  `awaiting-input`; last actor `user` → `idle` (likely interrupted)
- Sessions untouched for more than `maxAgeHours` (default 24) are ignored

These are heuristics against undocumented local log formats — they can
misclassify edge cases (e.g. role markers quoted inside message content) and
may need updating when the CLIs change their formats.

## Notes / future

- The `result` payload is stable structured data (`summary`, `providers`,
  `agents[]`) — intended as the data source for a real always-on widget later
  (Stream Deck / tray / web dashboard, see roadmap).
- Possible next providers: Claude Code web sessions (when an API exists),
  Azure DevOps-hosted agents, Jules, Devin.
