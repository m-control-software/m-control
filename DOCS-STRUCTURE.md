# DOCS-STRUCTURE.md — Documentation System Guide

> Meta-documentation: docs about the docs. Read this to understand *how* the documentation system works, not what it contains.

---

## 🗺️ Complete Structure

```
m-control/
│
├── README.md                    # Project overview & quick links
├── AGENTS.md                    # ⭐ Canonical guide for AI agents (and a dense one for humans)
├── CLAUDE.md                    # Claude Code: imports AGENTS.md + Claude specifics
├── ONBOARDING.md                # Deeper walkthrough of the codebase
├── QUICKSTART.md                # Get running in 5 minutes
├── CONTRIBUTING.md              # Workflow: branching, commits, PR, release
├── CHANGELOG.md                 # What changed + WHY it changed
├── LESSONS-LEARNED.md           # Pivots, mistakes, and what we learned
├── DOCS-STRUCTURE.md            # ← You are here
│
├── docs/
│   ├── README.md                # Navigation hub for all docs
│   ├── VISION.md                # Product north star (CLI → SaaS)
│   │
│   ├── adr/                     # Architecture Decision Records
│   │   ├── TEMPLATE.md          # Blank ADR to copy
│   │   └── 0001-…0011-*.md      # 0009 and 0010 are Proposed
│   │
│   ├── architecture/            # How the system works (technical)
│   │   ├── OVERVIEW.md          # Big picture, component map, run flow
│   │   ├── constraints.md       # ⚠️  Hard rules — never violate
│   │   └── execution-model.md   # Tool Protocol v1: manifest → run → events
│   │
│   ├── archive/                 # Superseded pre-monorepo design docs (history only)
│   │
│   └── ai/                      # AI assistant context & tooling
│       ├── PROJECT-CONTEXT.md   # ⭐ Attach this to every new AI session
│       ├── CODING-GUIDELINES.md # Patterns, naming, error handling
│       ├── ANTI-PATTERNS.md     # What NOT to do (with rationale)
│       └── PROMPTS/             # Reusable prompt templates
│           ├── implement-tool.md
│           ├── design-review.md
│           ├── write-adr.md
│           └── import-streamdeck.md
│
├── templates/
│   ├── node-tool/               # Copy for a new Node.js tool (protocol v1)
│   │   ├── manifest.json
│   │   ├── index.js             # Plain JS — no build step
│   │   └── README.md
│   └── python-tool/             # Copy for a new Python tool (protocol v1)
│       ├── manifest.json
│       ├── main.py
│       └── README.md
│
├── tools/<category>/<id>/README.md  # Per-tool usage, config, dependencies (+ docs/ for big tools)
│
├── .claude/                     # Claude Code
│   ├── settings.json            # Shared permissions
│   ├── rules/                   # Focused rule files (monorepo, errors, protocol)
│   └── skills/                  # Project skills (see skills/README.md)
├── .cursor/rules/               # Cursor rules — pointer to AGENTS.md
└── .github/copilot-instructions.md  # Copilot — pointer to AGENTS.md
```

---

## 📁 Folder Purposes

### `/` (root)
Human-facing project docs. What GitHub/GitLab shows on the repo landing page. Keep short; link into `docs/` for depth.

### `docs/`
Technical and product documentation. Organized by *audience* (architecture for engineers, ai/ for AI assistants) and *type* (decisions vs. reference vs. vision).

### `docs/adr/`
**Architecture Decision Records** — numbered, immutable log of *why* we made key technical choices. Once written, never delete — mark as "Superseded" instead. This is the project's institutional memory.

### `docs/architecture/`
**Living reference** for how the system works. Updated when the system changes. `constraints.md` is the closest thing to a constitution — it defines hard rules that override convenience.

### `docs/archive/`
**Superseded documents**, kept for history with a banner. Never implement from them. When a design doc stops describing the system, move it here instead of leaving it next to current docs.

### `AGENTS.md`
**The canonical rules for AI agents.** Contracts, commands, how to add a tool, code rules, and which doc to update for which change. Every assistant-specific file points here.

### `docs/ai/`
**AI-first context layer.** `PROJECT-CONTEXT.md` is the product-level primer (state, roadmap, open decisions); `AGENTS.md` holds the working rules.

### `docs/ai/PROMPTS/`
**Reusable prompt recipes.** Don't write the same context paragraph for the 10th time — template it here and reference it.

### `templates/node-tool/`, `templates/python-tool/`
**Copy-paste foundation** for new tools — working Tool Protocol v1 implementations, not just stubs. Copy into `tools/<category>/<id>/`, set the manifest fields, implement.

### `.claude/`, `.cursor/`, `.github/copilot-instructions.md`
**Per-assistant entry points.** The rules live in `AGENTS.md` and `docs/` — these files only point there (plus assistant-specific mechanics like skills). Never duplicate a rule into an assistant file; duplicated rules go stale.

---

## 🧭 "What Do I Read For…?"

| I want to… | Read… |
|------------|-------|
| Start a new AI coding session | `AGENTS.md`, then `docs/ai/PROJECT-CONTEXT.md` |
| Add a new tool | `AGENTS.md` → "Adding a tool" + `docs/ai/PROMPTS/implement-tool.md` |
| Make an architectural decision | `docs/adr/TEMPLATE.md` + `docs/ai/PROMPTS/write-adr.md` |
| Understand a hard rule | `docs/architecture/constraints.md` |
| Review code quality | `docs/ai/CODING-GUIDELINES.md` + `docs/ai/ANTI-PATTERNS.md` |
| Understand the product direction | `docs/VISION.md` |
| Know what changed recently | `CHANGELOG.md` |
| Know why something changed | `LESSONS-LEARNED.md` or the relevant ADR |
| Navigate all docs | `docs/README.md` |

---

## 🔄 How to Maintain These Docs

### When adding a feature
1. Does it require an architectural decision? → Write ADR
2. Does it change a contract (manifest, protocol, config, CLI)? → Update `AGENTS.md` and `execution-model.md`
3. Does it change the component map or run flow? → Update `architecture/OVERVIEW.md`
4. Add entry to `CHANGELOG.md` with *why*, not just *what*
5. Don't restate the change in QUICKSTART/ONBOARDING/README unless the first-run steps change — link instead

### When something goes wrong / you pivot
1. Add to `LESSONS-LEARNED.md`
2. If it reveals a missing constraint → add to `constraints.md`
3. If it supersedes an ADR → mark old ADR, write new one

### When you add a new AI prompt pattern
1. Add to `docs/ai/PROMPTS/`
2. List it in `CLAUDE.md` and `docs/README.md`

### ADR numbering
Sequential: `0001`, `0002`, `0003`... Never reuse numbers. Gap in sequence = deleted ADR (don't do this; use "Deprecated" status instead).

---

## 💡 Rationale: Why This Structure?

### Why separate `ai/` folder?
AI assistants need different information than human developers. A human reading `OVERVIEW.md` builds mental model over time. An AI needs dense, cross-linked context in one place. Mixing them degrades both.

### Why `constraints.md` as "constitution"?
Technical decisions accumulate. Without a canonical "never do this" document, you end up re-relitigating the same debates. Constraints are architectural invariants — they should be referenced, not re-decided.

### Why CHANGELOG includes "why"?
`git log` tells you *what* changed. CHANGELOG tells you *why you should care*. "Refactored discovery" is useless. "Discovery now reads `paths.toolsRoots` — fixes a globally installed mctl finding no tools" is useful.

### Why boilerplate over scaffolding CLI?
A scaffolding CLI (`mctl new-tool`) requires maintenance and has its own bugs. A copy-paste template is auditable, versionable, and works offline. When the boilerplate evolves, old tools aren't force-migrated.

---

## ✏️ Editing These Docs

**Tools:** Any Markdown editor. Diagrams use [Mermaid](https://mermaid.js.org/).

**Line endings:** LF (configured in `.editorconfig`)

**Language:** English only — for AI tooling consistency.

**Style:** Concise. Document *why* and *trade-offs*, not *what* (code is self-documenting). Avoid padding.

---

*Last updated: 2026-09-24 — AGENTS.md as canonical agent guide; plugin-era docs archived*
