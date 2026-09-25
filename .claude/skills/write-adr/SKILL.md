---
name: write-adr
description: Record an architectural decision as an ADR in docs/adr/, or update an existing ADR's status (supersede, deprecate, accept a Proposed one). Use when the user asks to write, draft or record an ADR or a design decision, when a change is hard to reverse or changes a contract (the change-contract skill sends you here), or when a Proposed ADR (e.g. 0009, 0010) is being decided. Not for naming conventions, bug fixes or refactors.
---

# Write an ADR

## 1. Is it an ADR?

Yes when the decision is hard to reverse, changes the manifest / protocol /
config / CLI surface, or trades something off that someone will later ask
"why?" about. No for naming, minor refactors, config tweaks, bug fixes.

First read the ADRs it relates to (`docs/adr/`), especially Proposed ones:
the decision may belong in an existing ADR's Open Questions or as its
acceptance, not in a new file.

## 2. Gather before writing

Ask the user for anything you can't find in the code or the conversation:

- the problem and why it needs deciding now;
- the options actually considered — at least two real alternatives;
- the choice, and what it gives up;
- consequences, including the negative ones.

Don't invent alternatives or rationale to fill the template.

## 3. Create the file

```bash
yarn new:adr --title="<decision, as a short statement>" --status=<Proposed|Accepted> --tags=<a,b> --dry-run
yarn new:adr --title="<decision, as a short statement>" --status=<Proposed|Accepted> --tags=<a,b>
```

It takes the next free number, fills the header and drops the template's
usage notes. Never number an ADR by hand. `Accepted` if the decision is
already implemented or agreed; otherwise `Proposed`, with an **Open
Questions** section listing what is still undecided.

Fill every section; delete sections that genuinely don't apply. Aim for one
to two pages. Link related ADRs by relative path (`[ADR-0007](0007-….md)`).

## 4. Superseding

When the new ADR replaces an old one, set the old one's status to
`**Status:** Superseded by [ADR-NNNN](NNNN-….md) (YYYY-MM-DD)`; never delete it.
The new ADR names what it supersedes under "Related Decisions".

## 5. Follow-through, same change

- A contract or rule changed → `AGENTS.md` and the architecture docs (see the
  change-contract skill).
- The decision changed something users see → `CHANGELOG.md` `[Unreleased]`.
- `test/adr.test.ts` checks numbering and headers; run `yarn test`.
