# `*.deck.json` spec format (specVersion 1)

The canonical reference for Stream Deck specs. The code that enforces it:
`lib/Spec.ps1` (loading, merging), `lib/Actions.ps1` (action types),
`lib/Render.ps1` + `lib/IconEngine.ps1` (icons), `lib/AppResolver.ps1` (apps).
When this page and the code disagree, the code wins — fix this page.

The worked example is the shared pack, `specs/shared.deck.json`.

## Packs

A **pack** is a directory holding one `*.deck.json` (directly or in `specs/`)
plus the icons and scripts it references. Relative paths in a spec (`image`,
`script`, `file`) resolve against **its own pack directory**. Packs are found
in this tool's directory and in every `tools.stream-deck.packDirs` entry.

## Top level

| Field | Required | Meaning |
|-------|----------|---------|
| `specVersion` | yes | `1` |
| `pack` | yes | kebab-case id, unique across all loaded packs |
| `profile` | one pack | Profile name. Config `profileName` overrides it. The pack declaring it is merged first |
| `accent` | no | Default palette entry for this pack's pages |
| `palette` | no | `{ name: "#RRGGBB" }`. Accumulates across packs; declare the accents your keys use in your pack |
| `apps` | no | `{ id: AppDefinition }` referenced by `app` actions |
| `plugins` | no | `{ id: PluginTemplate }` referenced by `plugin` actions |
| `requires` | no | `{ bin: [...], plugins: [pluginUUID...] }` — what the machine needs |
| `pages` | no | `{ pageId: Page }` |

Merge order is deterministic: the pack with `profile` first, then the rest
alphabetically by `pack`.

## Pages

Page ids are **global**. The root page is `home`; some pack must define it.

| Field | Meaning |
|-------|---------|
| `label` | Display name (default: the id) |
| `accent` | Default accent for the page's keys (default: the pack's `accent`) |
| `folder` | `{ "parent": "<pageId>", "slot": "c,r" }` — puts a folder key on `parent` (default `home`) that opens this page. Two packs claiming the same parent slot is an error |
| `backSlot` | Where the generated Back key goes (default `"4,2"`) |
| `extends` | `true` = add keys to a page another pack defines, instead of an error for a duplicate page id. A key coordinate both packs define is still an error |
| `keys` | `{ "c,r": Key }` |

The device grid is 5 columns × 3 rows. Coordinates are `"column,row"`,
zero-based: `"0,0"` top-left, `"4,2"` bottom-right.

A page whose folder parent is absent (its pack is not installed) is dropped
with its folder key: an absent pack is a no-op, never an error.

## Keys

| Field | Meaning |
|-------|---------|
| `title` | Text under the icon |
| `icon` | `{ "image": "icons/x.png" }` (pack-relative), `{ "glyph": "<name>" }`, or `{ "badge": "M" }`; optional `scale` (default `0.54`), `mono` |
| `accent` | Palette entry (default: the page's accent) |
| `action` | One of the action types below |
| `states` | Multi-state keys (e.g. mute on/off): an array of `{ title, accent, icon }` overrides |
| `unconfigured` | `true` renders the key muted (placeholder) |

Glyph names are the cases of `switch ($shape)` in `lib/IconEngine.ps1`
(`terminal`, `microphone-slash`, `checkbox-list`, …). A new glyph means new
drawing code there.

## Action types (`action.type`)

| Type | Fields | Does |
|------|--------|------|
| `app` | `app` (id in `apps`), `title`, `args` | Launches a resolved application |
| `website` | `url` | Opens a URL or URI scheme (`ms-todo:`) |
| `open` | `target` (command, path or URI) **or** `file` (pack-relative) | Stream Deck "Open"; use `file` for wrappers such as a hidden-window `.vbs` |
| `script` | `script` (pack-relative `.ps1`), `title` | Runs the script with `pwsh -NoProfile -File` (needs the `pwsh` app) |
| `hotkey` | `hotkeys`: up to 4 × `{ ctrl, shift, option, cmd, modifiers, native, qt, vkey }` | Sends a key combination |
| `multimedia` | `index`: 0 play/pause, 1 next, 2 previous, 3 stop, 4 mute, 5 vol+, 6 vol− | Media keys |
| `folder` | `page` | Opens another page (usually generated from `folder` instead) |
| `back` | — | Parent folder |
| `profile` | `profile` (name) | Switches to another, hand-maintained profile. Missing here → inert key, reported as `missingProfiles` |
| `plugin` | `plugin` (id in `plugins`), `settings` (merged over the template's) | A third-party plugin action |

## Apps (`apps.<id>`)

Resolved per machine, tried in order: `appx` (`{ package, exe, aumid }`, Store
apps), then `candidates` (absolute paths with `%VAR%` and wildcards; the
highest-sorting match wins), then `command` (looked up on PATH). Unresolved
apps are listed in a warning and in the result's `missingApps`, and an `app`
key that uses one **fails the build** — run `check=true` on the target machine
to see which before installing.

## Plugins (`plugins.<id>`)

A template copied from a working profile: `uuid`, `name`, `settings`,
`stateCount`, `linkedTitle`, and the plugin's `manifest` (`Name`, `UUID`,
`Version`). The pack that uses a plugin declares it, so client-specific
plugins never need an entry in the shared pack. List the plugin's UUID in
`requires.plugins`.

## Where specs live

Only generic material goes in this repo's `specs/`. Personal or client packs
live in directories listed in `tools.stream-deck.packDirs` (ADR-0009). A
palette key is still a name: keep client-specific accents in the client pack.
