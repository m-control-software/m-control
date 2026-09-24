# m-control — Claude Code Context

@AGENTS.md

The import above is the canonical guide shared by every agent. Change rules
there, not here. This file only adds what is specific to Claude Code.

## Claude Code specifics

- `.claude/rules/*.md` — focused rule files (monorepo, errors, tool protocol)
  that restate parts of `AGENTS.md` for quick reference; `AGENTS.md` wins if
  they ever disagree.
- `.claude/skills/<name>/SKILL.md` — project skills (see
  `.claude/skills/README.md`). Current: `author-logi-profile`.
- `.claude/settings.json` — shared permissions for this repo.
  `.claude/settings.local.json` and `CLAUDE.local.md` are personal and
  git-ignored.
- `docs/ai/PROMPTS/` — reusable prompts (implement a tool, design review,
  write an ADR, import a Stream Deck setup).
