# Project skills

Each skill is a directory with a `SKILL.md`:

```
.claude/skills/
└── <skill-name>/
    ├── SKILL.md          # required — frontmatter + instructions
    └── ...               # optional reference files, loaded only when needed
```

The current skills and what each drives are listed in `AGENTS.md` →
"Procedures (skills)". Claude Code loads them automatically; other agents read
the `SKILL.md` the table points to.

## Writing a skill

A skill encodes **judgment and approval gates**. Mechanical steps belong in a
script the skill calls (`yarn new:tool`, `yarn new:adr`, `yarn release`), and
checkable rules belong in a test — a checklist in prose is followed most of
the time, a script every time (`LESSONS-LEARNED.md`, 2026-09-25).

- **Frontmatter:** `name` equals the directory name; `description` says what
  it does, when to use it (with example requests), and when **not** to — the
  description is always in context and decides when the skill fires.
- **Point, don't restate.** Link the canonical doc (`AGENTS.md`,
  `docs/architecture/`, a tool's `docs/`) instead of copying rules into the
  skill; restated rules go stale.
- **Stop points.** Say explicitly where to stop and ask: before a design is
  implemented, before live state changes, before anything is pushed.
- **End with verification** — `yarn verify` or the tool's `check=true` — and
  report the actual result.
- **Paths** are repo-rooted (`tools/artifacts/stream-deck/docs/…`); a path
  relative to a tool is written `<tool>/test/…`. `test/docs.test.ts` checks
  that every quoted repo path exists.
- **No machine-specific paths or personal data**: refer to the config key that
  holds the path (e.g. `tools.logi-options.packDirs`).
- Machine-specific or personal skills go in `~/.claude/skills/`, not here.

After adding a skill, add its row to the table in `AGENTS.md`
(`test/docs.test.ts` fails otherwise).

## Where each assistant reads from

| Assistant | Reads |
|-----------|-------|
| Any agent that supports it (Codex, Cursor, Copilot, …) | `AGENTS.md` |
| Claude Code | `CLAUDE.md` (imports `AGENTS.md`), `.claude/skills/`, `.claude/hooks/` via `.claude/settings.json` |
| Cursor | `.cursor/rules/*.mdc` (points at `AGENTS.md`) |
| GitHub Copilot | `.github/copilot-instructions.md` (points at `AGENTS.md`) |
