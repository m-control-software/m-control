# m-control Documentation

Where to find what. For how the documentation system itself is organised and
maintained, see [DOCS-STRUCTURE.md](../DOCS-STRUCTURE.md).

## Start here

**Working on the code (human or AI agent)?**
1. [AGENTS.md](../AGENTS.md): layout, commands, contracts, how to add a tool, code rules
2. [ai/PROJECT-CONTEXT.md](ai/PROJECT-CONTEXT.md): current state, roadmap, open decisions
3. [architecture/constraints.md](architecture/constraints.md): the hard rules

**New to the project?**
1. [VISION.md](VISION.md): what m-control is for and where it's going
2. [architecture/OVERVIEW.md](architecture/OVERVIEW.md): how it's put together
3. [../QUICKSTART.md](../QUICKSTART.md), then [../ONBOARDING.md](../ONBOARDING.md)

**Making an architectural change?**
1. [architecture/constraints.md](architecture/constraints.md): non-negotiable rules
2. [adr/](adr/): past decisions; ADR-0009 and ADR-0010 are still Proposed
3. New ADR from [adr/TEMPLATE.md](adr/TEMPLATE.md) (see [ai/PROMPTS/write-adr.md](ai/PROMPTS/write-adr.md))

## Layout

```
docs/
├── README.md               👈 You are here
├── VISION.md               Product north star
├── adr/                    Architecture Decision Records (0001–0012)
├── architecture/
│   ├── OVERVIEW.md         Component map, run flow, tool kinds
│   ├── constraints.md      ⚠️ The hard rules
│   └── execution-model.md  Tool Protocol v1
├── ai/
│   ├── PROJECT-CONTEXT.md  State of the project for a new session
│   ├── CODING-GUIDELINES.md
│   ├── ANTI-PATTERNS.md    Mistakes we made, and what to do instead
│   └── PROMPTS/            implement-tool, design-review, write-adr, import-streamdeck
└── archive/                Superseded pre-monorepo designs; history only
```

Tool-specific docs live with the tool: `tools/<category>/<id>/README.md`, plus
`docs/` inside larger tools (e.g. `tools/artifacts/logi-options/docs/`).

## Finding what you need

| I want to… | Go to |
|------------|-------|
| Add a tool | [AGENTS.md](../AGENTS.md) → "Adding a tool", [ai/PROMPTS/implement-tool.md](ai/PROMPTS/implement-tool.md) |
| Understand the tool protocol | [architecture/execution-model.md](architecture/execution-model.md) |
| Know why we chose X over Y | [adr/](adr/) |
| Review a design before building it | [ai/PROMPTS/design-review.md](ai/PROMPTS/design-review.md) |
| Record a mistake so it isn't repeated | [ai/ANTI-PATTERNS.md](ai/ANTI-PATTERNS.md) or [../LESSONS-LEARNED.md](../LESSONS-LEARNED.md) |
| See what changed | [../CHANGELOG.md](../CHANGELOG.md) |
| Branching, CI, releases | [../CONTRIBUTING.md](../CONTRIBUTING.md) |

## Principles

1. **One source of truth per topic.** Link to it; don't restate it.
2. **Docs match the code.** A doc that describes something the code doesn't do
   goes to `archive/`, or gets fixed in the same change.
3. **Why over what.** The code shows what; docs explain why.
4. **Update in the same change**, not afterwards.

**Last updated:** 2026-09-24
