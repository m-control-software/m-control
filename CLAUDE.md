# m-control — Claude Code Context

@AGENTS.md

The import above is the canonical guide shared by every agent. Change rules
there, not here. This file only adds what is specific to Claude Code.

## Claude Code specifics

- `.claude/skills/<name>/SKILL.md` — project skills, loaded automatically.
  The list, and what each one drives, is in `AGENTS.md` → "Procedures
  (skills)"; conventions for writing one are in `.claude/skills/README.md`.
- `.claude/hooks/` — `session-start.mjs` installs dependencies and builds core
  in cloud sessions; `format-edited-file.mjs` runs Prettier on TS/JS you edit.
  Registered in `.claude/settings.json`.
- `.claude/settings.json` — shared permissions and hooks for this repo.
  `.claude/settings.local.json` and `CLAUDE.local.md` are personal and
  git-ignored.
- Before reporting work as done, run `yarn verify` and quote its summary line.
