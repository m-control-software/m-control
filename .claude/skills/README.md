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
  (`docs/architecture/`, `CLAUDE.md`), not restate it — restated rules go
  stale (see LESSONS-LEARNED.md).
- Skill names: kebab-case, verb-first where sensible (e.g. `add-tool`,
  `write-adr`).

## Related locations

| Assistant | Where it reads from |
|-----------|---------------------|
| Claude Code | `CLAUDE.md`, `.claude/rules/`, `.claude/skills/` |
| Cursor | `.cursor/rules/*.mdc` |
| GitHub Copilot | `.github/copilot-instructions.md` |

All three point at the same canonical docs under `docs/` — update those,
not the assistant files.
