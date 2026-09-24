# Prompt: Write ADR (Architecture Decision Record)

Use this prompt when you've made a significant technical decision and need to document it properly.

---

## When to Write an ADR

Write an ADR when the decision:
- Affects the overall architecture, Tool Protocol v1, the manifest, or the config schema
- Is hard to reverse (high cost of change)
- Involves non-obvious trade-offs
- Others might question later ("why did we do it this way?")

**Don't** write ADRs for: naming conventions, minor refactors, config tweaks.

---

## Prompt Template

```
Write an ADR for m-control using docs/adr/TEMPLATE.md.

**Decision:** [One sentence summary of what was decided]
**Context:** [What problem needed solving? What alternatives existed?]
**Chosen approach:** [What we're doing]
**Rejected alternatives:**
  - [Option A] — why rejected
  - [Option B] — why rejected
**Key trade-offs:** [What are we giving up? What do we gain?]
**Consequences:** [What changes? What becomes easier/harder?]

ADR number: [Next number from docs/adr/ directory]

Reference constraints from @docs/architecture/constraints.md where relevant.
Link to related ADRs if applicable. If an ADR is Proposed, list what is still
undecided under Open Questions.
```

---

## Example Usage

```
Write an ADR for m-control using docs/adr/TEMPLATE.md.

**Decision:** Let a tool declare its own run budget in the manifest
**Context:** The runner killed every tool at a hard-coded 30 s. A Stream Deck
  generate-plus-install measured ~21 s on a good run and sometimes exceeded
  30 s mid-install; other tools rely on the 30 s being exact.
**Chosen approach:** Optional `timeoutMs` in the manifest; precedence
  config.timeouts.tools[id] > manifest.timeoutMs > config.timeouts.default > 30 s
**Rejected alternatives:**
  - Raise the global default — slows failure detection for every tool
  - Config-only overrides — every user rediscovers the budget by failing
**Key trade-offs:** Tool authors can ask for long budgets; the user override
  stays on top
**Consequences:** Additive field, no manifestVersion bump; discovery validates it

ADR number: [next free number]
```

---

## What AI Should Deliver

A complete ADR file following `docs/adr/TEMPLATE.md`:

```markdown
# ADR-XXXX: [Title]

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-YYYY
**Date:** YYYY-MM-DD
**Context:** ...
**Decision:** ...
**Consequences:** ...
**Alternatives considered:** ...
```

---

## Checklist After AI Delivers

- [ ] Status is correct (usually "Accepted" if already implemented)
- [ ] Date is today
- [ ] "Why" is clear — future-you should understand the reasoning
- [ ] Alternatives actually considered (not just "we didn't think of this")
- [ ] Consequences are honest (include negatives)
- [ ] File saved as `docs/adr/XXXX-kebab-case-title.md`
- [ ] CHANGELOG.md updated if the decision caused visible changes
- [ ] AGENTS.md / architecture docs updated if a contract or rule changed

---

## Related Prompts

- **design-review.md** — Review an architecture decision before committing
- **implement-tool.md** — Implement a tool after architecture is decided

---

**Last updated:** 2026-09-24
