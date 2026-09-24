# Claude Code Skills

Project-scoped skills for Claude Code live here. Each skill is a directory
with a `SKILL.md`:

```
.claude/skills/
└── <skill-name>/
    ├── SKILL.md          # required — frontmatter + instructions
    └── ...               # optional supporting files (scripts, templates)
```

`SKILL.md` format:

```markdown
---
name: skill-name
description: One line describing when Claude should use this skill.
---

Instructions for the skill...
```

## Conventions for this repo

- Skills committed here are **project skills** — they travel with the repo
  and are available to anyone (or any agent) working in it.
- Keep machine-specific or personal skills in `~/.claude/skills/` instead.
- A skill that encodes an architectural rule must POINT at the canonical doc
  (`AGENTS.md`, `docs/architecture/`), not restate it — restated rules go
  stale (see LESSONS-LEARNED.md).
- No machine-specific paths in a committed skill: refer to the config key
  that holds the path (e.g. `tools.logi-options.packDirs`).
- Skill names: kebab-case, verb-first where sensible (e.g. `add-tool`,
  `write-adr`).

## Related locations

| Assistant | Where it reads from |
|-----------|---------------------|
| Any agent that supports it (Codex, Cursor, Copilot, …) | `AGENTS.md` |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`), `.claude/rules/`, `.claude/skills/` |
| Cursor | `.cursor/rules/*.mdc` |
| GitHub Copilot | `.github/copilot-instructions.md` |

`AGENTS.md` is canonical; the assistant-specific files point at it. Update
`AGENTS.md` (and the docs it links), not the pointers.
