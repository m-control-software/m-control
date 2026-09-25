# m-control Documentation

Where to find what, and how the documentation is kept honest.

## Start here

**Working on the code (human or AI agent)?**
1. [AGENTS.md](../AGENTS.md): layout, commands, contracts, procedures (skills), code rules
2. [ai/PROJECT-CONTEXT.md](ai/PROJECT-CONTEXT.md): where the project stands, what's next, open decisions
3. [architecture/constraints.md](architecture/constraints.md): the hard rules, and which of them are enforced where

**New to the project?**
1. [VISION.md](VISION.md): what m-control is for and where it's going
2. [architecture/OVERVIEW.md](architecture/OVERVIEW.md): how it's put together
3. [../QUICKSTART.md](../QUICKSTART.md), then [../ONBOARDING.md](../ONBOARDING.md)

**Making an architectural change?**
1. [architecture/constraints.md](architecture/constraints.md): non-negotiable rules
2. [adr/](adr/): past decisions; ADR-0009 and ADR-0010 are still Proposed
3. The `change-contract` and `write-adr` skills (`AGENTS.md` → "Procedures")

## Layout

```
docs/
├── README.md               👈 You are here
├── VISION.md               Product north star
├── adr/                    Architecture Decision Records (yarn new:adr creates one)
├── architecture/
│   ├── OVERVIEW.md         Component map, run flow, tool kinds
│   ├── constraints.md      ⚠️ The hard rules + what enforces them
│   └── execution-model.md  Tool Protocol v1
├── ai/
│   ├── PROJECT-CONTEXT.md  State of the project for a new session
│   └── CODING-GUIDELINES.md  Style and patterns beyond the hard rules
└── archive/                Superseded pre-monorepo designs; history only
```

Outside `docs/`: `AGENTS.md` (canonical agent guide), `REVIEW.md` (what a
reviewer checks), `LESSONS-LEARNED.md` (why things changed), `CHANGELOG.md`,
`.claude/skills/` (procedures). Tool-specific docs live with the tool:
`tools/<category>/<id>/README.md`, plus `docs/` inside larger tools (e.g.
`tools/artifacts/stream-deck/docs/spec-format.md`).

## Finding what you need

| I want to… | Go to |
|------------|-------|
| Add a tool | `add-tool` skill; [AGENTS.md](../AGENTS.md) → "Adding a tool" |
| Change the manifest, protocol, config or CLI | `change-contract` skill |
| Understand the tool protocol | [architecture/execution-model.md](architecture/execution-model.md) |
| Know why we chose X over Y | [adr/](adr/) |
| Record a decision | `write-adr` skill (`yarn new:adr`) |
| Review a change | [../REVIEW.md](../REVIEW.md) |
| Record a mistake so it isn't repeated | [../LESSONS-LEARNED.md](../LESSONS-LEARNED.md) — and, if it can be checked, a test |
| See what changed | [../CHANGELOG.md](../CHANGELOG.md) |
| Branching, CI, releases | [../CONTRIBUTING.md](../CONTRIBUTING.md), `release` skill |

## Keeping docs honest

1. **One source of truth per topic.** Link to it; don't restate it. Restated
   rules are what went stale here before (`LESSONS-LEARNED.md`, 2026-09-25).
2. **If it can be checked, check it** instead of writing it down: a test in
   `test/`, a lint rule, or a script. `test/docs.test.ts` already fails on
   broken links, quoted paths that don't exist, and unindexed skills.
3. **Docs match the code.** A doc that describes something the code doesn't do
   goes to `archive/`, or gets fixed in the same change.
4. **Why over what.** The code shows what; docs explain why.
5. **Update in the same change**, not afterwards. Which doc to update for
   which change: `AGENTS.md` → "Decisions and docs".
