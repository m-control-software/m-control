# Lessons Learned

This document captures the "why" behind major decisions and pivots in m-control. While CHANGELOG.md tracks **what** changed, this file explains **why** it changed.

## Purpose

- Record strategic pivots and reasoning
- Document failed experiments and learnings
- Capture insights that aren't obvious from code or ADRs
- Help future self (and AI) understand historical context

## Format

Each entry should include:
- **Date:** When the lesson was learned
- **Context:** What was happening
- **What happened:** The event or decision
- **Lesson:** What we learned
- **Impact:** How it changed the project

---

## 2025-02-18: Project Inception - AI-First Documentation Strategy

**Context:**  
Starting m-control with intention to use AI assistants (Claude Code, Cursor, Copilot) for 80%+ of development. Needed a way to maintain consistency and context across tools.

**What happened:**  
Instead of "code first, docs later", invested upfront in comprehensive documentation structure optimized for AI consumption (PROJECT-CONTEXT, CODING-GUIDELINES, ANTI-PATTERNS, prompts library).

**Lesson:**  
AI-assisted development at scale requires structured knowledge transfer. Without proper docs, each new AI chat session starts from zero, leading to:
- Inconsistent patterns
- Repeated mistakes
- Lost context when switching tools
- Architectural drift

**Impact:**  
- Created docs/ structure before writing significant code
- All major docs reference each other (navigation graph)
- AI can bootstrap project context in <2 minutes
- Can seamlessly switch between Cursor ↔ Claude Code

**Would do differently:** Nothing yet - too early to tell.

---

## 2025-02-18: TypeScript Over .NET for MVP

**Context:**  
Evaluating tech stack for CLI orchestrator. Options: TypeScript, .NET, Python, Go.

**What happened:**  
Chose TypeScript despite .NET being better for performance and native distribution.

**Lesson:**  
For AI-assisted MVP development, speed of iteration > raw performance.
- TypeScript: Fast prototyping, large ecosystem, AI assistants excel at it
- .NET: Better performance, but slower dev cycle with AI

**Impact:**  
- Can add new tools in minutes with AI assistance
- Polyglot approach allows .NET tools later if needed
- Trade-off: Runtime dependency (Node.js), but acceptable for target users

**Related ADR:** docs/adr/0001-typescript-orchestrator.md

**Would do differently:**  
If starting with team >3 people or enterprise customers from day 1, might choose .NET for better "professional" perception. But for solo MVP with AI? TypeScript was correct.

---

## 2026-02-27: CLI Distribution — Monorepo Package Not Resolvable Outside Repo

**Context:**
`mctl` depends on `@m-control/core` as a Yarn workspace package. Yarn symlinks it inside the repo's `node_modules/`, but once `mctl.js` is copied to `~/.m-control/` the symlink is gone and Node.js throws `Cannot find module '@m-control/core'`.

**What happened:**
Tried a simple `Copy-Item dist/ → ~/.m-control/dist/` install approach. It failed at runtime because `@m-control/core` wasn't available on the target path. Introduced ncc bundling to inline all dependencies into a single file before copying.

**Lesson:**
Monorepo workspace packages are a development convenience, not a distribution mechanism. Any tool that ships outside the repo must either:
1. Be published to npm so its dependencies resolve normally, or
2. Be bundled so no external resolution is needed at runtime.

**Impact:**
- Temporary: ncc bundle (`dist/bundle/index.js`) — zero-config, works anywhere Node.js exists
- Installer now copies a single file instead of an entire directory tree
- Accepted tech debt: bundle grows with deps, no partial updates, no native addon support

**Would do differently:**
Go straight to `npm publish` if there were even one external user from day 1. The bundling step is a workaround that buys time without creating blocking debt.

**Related:**
- ADR: `docs/adr/0004-cli-distribution-strategy.md`

**Migration trigger:** First external user → migrate to `npm publish @m-control/mctl`.

---

## 2026-09-25: AI-First Means Executable, Not More Prose

**Context:**
Almost all code in the repo is written by coding agents. The rules they
follow lived in about 2,900 lines of Markdown: `AGENTS.md`, plus restated
copies in `.claude/rules/`, `PROJECT-CONTEXT.md`, `CODING-GUIDELINES.md`,
`ANTI-PATTERNS.md`, `DOCS-STRUCTURE.md`, `ONBOARDING.md`, `CONTRIBUTING.md`
and a prompt library.

**What happened:**
An audit found the prose and the repo disagreeing: two of five tools broke the
"Adding a tool" checklist (no README, no tests); `stream-deck` ignored its
`requiredConfig`; nothing checked the "PowerShell 5.1" rule; test files were
never type-checked; the smoke test would overwrite a developer's real config;
`ANTI-PATTERNS.md` forbade a shebang that `apps/mctl/src/index.ts` has;
`package-lock.json` sat next to `yarn.lock`. Each rule was written down, often
several times; none was checked.

**Lesson:**
For agents, a rule that runs beats a rule that is read. A checklist is
followed most of the time; a test is followed every time, and it names the
violation. And every restatement of a rule is a second copy that drifts.
Hence the order of preference: make it impossible (a scaffolder, a template
that reads its own manifest) → make it fail CI (conformance, parity, docs and
lint checks in `yarn verify`) → write it once in `AGENTS.md` and link to it.
Skills are for judgment and approval gates, and hand the mechanics to
scripts.

**Impact:**
`yarn verify` (= CI), `yarn new:tool` / `new:adr` / `release`, a shared test
harness, repo-wide conformance and docs tests, linting for every language in
the repo, five skills. Removed: `.claude/rules/`, `ANTI-PATTERNS.md`,
`DOCS-STRUCTURE.md`, the prompt library.

**Would do differently:**
`DOCS-STRUCTURE.md` argued for copy-paste templates over a scaffolding CLI
("auditable, works offline"). That holds for people; for agents, the
hand-edited id in four places was exactly where copies went wrong. The
scaffolder copies the same auditable templates, so nothing is lost.

---

## Earlier mistakes (from the retired ANTI-PATTERNS.md)

Kept for the record; each is now prevented by code or a check.

- **Hard-coded config path** (`C:\Users\Michal\.m-control\config.json`):
  broke other users and platforms. Config paths come from
  `USERPROFILE`/`os.homedir()` (`packages/core/src/config.ts`).
- **Config template as a separate file read at run time:** broke after
  bundling. The template is embedded in core, and it holds no tool sections
  (open config schema).
- **Missing `lib` in tsconfig:** Node globals failed to type-check.
  `tsconfig.base.json` sets `lib: ["ES2022"]` for every workspace.

---

## Template for Future Entries

```markdown
## YYYY-MM-DD: [Short Title]

**Context:**  
What was the situation?

**What happened:**  
What decision/event/pivot occurred?

**Lesson:**  
What did we learn? What insight emerged?

**Impact:**  
How did this change the project? What became easier/harder?

**Would do differently:**  
In hindsight, what would you change?

**Related:**  
- ADR: docs/adr/XXXX-*.md (if applicable)
- Code: src/path/to/code (if applicable)
```

---

## Guidelines for Adding Entries

**Add entry when:**
- ✅ Strategic pivot (change in product direction)
- ✅ Architecture change with non-obvious reasoning
- ✅ Failed experiment with valuable lesson
- ✅ "Aha moment" that changed understanding
- ✅ Trade-off that future self might question

**Don't add entry for:**
- ❌ Bug fixes (use CHANGELOG)
- ❌ Minor implementation details
- ❌ Obvious decisions
- ❌ Routine refactoring

**Think:** Will future me (or AI) benefit from understanding WHY I did this?

---

**Last updated:** 2026-09-25  
**Maintainer:** Michał
