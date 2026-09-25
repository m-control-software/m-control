---
name: author-deck-profile
description: Create or change Elgato Stream Deck keys, pages, folders or profiles by writing *.deck.json specs and applying them with `mctl run stream-deck`. Use when the user asks to add, move, remap or remove a Stream Deck button, page or folder, give a key an icon, add a hotkey/app/website/script key, set up the Stream Deck on a new machine, or migrate a hand-built Stream Deck profile into specs (e.g. "add a Stream Deck button that opens Rider", "put my meeting controls on a folder", "restore my Stream Deck on this laptop"). Also use when stream-deck reports a spec, merge or collision error.
---

# Author a Stream Deck profile

The tool is `tools/artifacts/stream-deck`. Before writing anything, read
**`tools/artifacts/stream-deck/docs/spec-format.md`** — the canonical
reference for packs, pages, key coordinates, icons and action types — and
`tools/artifacts/stream-deck/specs/shared.deck.json` as the worked example.
Don't restate the format from memory.

Migrating a hand-built setup instead? Follow
`tools/artifacts/stream-deck/docs/import-existing-setup.md` phase by phase;
its classification step (what is personal, client-owned, or shared) comes
before any spec is written.

## Workflow

1. **Find the right pack.** Packs live in the directories listed in
   `tools.stream-deck.packDirs` in `~/.m-control/config.json`; read it there.
   Personal and client keys go in those packs. **Only generic keys belong in
   the repo's `specs/shared.deck.json`**; ask when unsure (ADR-0009).
2. **Place the key.** The grid is 5 × 3, coordinates `"column,row"` from
   `"0,0"`; `"4,2"` is the default Back slot on sub-pages. Check the page's
   existing keys and folder slots (including other packs' `folder.slot`
   claims on the same parent) so nothing collides. To add a key to a page
   another pack owns, set `"extends": true` on that page in your pack.
3. **Choose the action** from the table in spec-format.md. For hotkeys, take
   the combination from the target application's actual key bindings, never
   from memory; if you can't determine it, say so. Apps go in `apps` with
   `candidates` that work on the user's machines; scripts and icons are
   pack-relative files you add next to the spec.
4. **Accent.** Use an existing palette name; a new one is declared in the
   same pack's `palette`.
5. **Validate and preview:** `mctl run stream-deck check=true`. It writes
   nothing. Show the user the result: pages, key count, and any
   `missingApps` / `missingProfiles`. An `app` key whose app does not resolve
   fails the build — fix the `candidates` first.
6. **Ask before installing.** Installing requires the Stream Deck app to be
   closed (the tool refuses otherwise) and replaces the generated profile
   (after a backup). Then `mctl run stream-deck` and confirm the result shows
   `installed: true`.
7. **Ask the user to check the device.** The tool verifies what it wrote;
   only a person can verify the key does the right thing.

## Never

- Edit files under `%APPDATA%\Elgato\StreamDeck\ProfilesV3` directly. The
  generated profile is a build output; the spec is the source.
- Put client names — including palette names, page labels and plugin
  settings — into the repo's shared pack.
- Pass `--check`-style flags; mctl drops them and the tool would install for
  real. It is `check=true`.
- Change `lib/*.ps1` to make a spec work without asking: the generator must
  stay Windows PowerShell 5.1-compatible, and its tests only run on Windows.
