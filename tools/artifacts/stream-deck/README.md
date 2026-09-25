# stream-deck

> Generates an Elgato Stream Deck profile from declarative `*.deck.json` specs
> and installs it in place of the previous version. Windows only.

The spec is the source of truth; the profile on disk is a build output. A
captured profile encodes one machine (absolute paths, device model, UUID-named
folders), so it is regenerated rather than versioned. Rationale:
ADR-0010, "Generated artifacts" and "Corrections from the Stream Deck build".

## Usage

```bash
mctl run stream-deck check=true   # validate, resolve, build into a temp dir; write nothing
mctl run stream-deck              # build and install (close the Stream Deck app first)
```

Options are `key=value` input, not flags: `--check` is swallowed by mctl and
would install for real. `check` accepts `true/false`, `1/0`, `yes/no`, `on/off`.

The result reports the profile GUID, packs and pages, key count, and anything
that couldn't be resolved on this machine (`missingApps`, `missingProfiles`);
after an install also the target path and the backup location.

## Config (`tools.stream-deck` in `~/.m-control/config.json`)

| Key | Required | Meaning |
|-----|----------|---------|
| `profileName` | yes | Name of the generated profile; overrides the spec's `profile` |
| `packDirs` | yes | Directories holding personal or client packs (array, or one `;`-separated string; `%VAR%` expanded) |
| `profilesRoot` | no | Stream Deck profiles folder. Default `%APPDATA%\Elgato\StreamDeck\ProfilesV3` |
| `deviceModel` | no | Which device to bind to when several are known |
| `backupDir` | no | Where the previous profile is copied before replacement. Default `%TEMP%` |

The manifest declares `timeoutMs: 120000`: a full generate-plus-install of a
93-key profile measured ~21 s, too close to the 30 s default.

## Packs and specs

A pack is a directory with one `*.deck.json` plus the icons and scripts it
references. Specs are found in this tool's own `specs/` (the shared pack, see
`specs/shared.deck.json`) and in every `packDirs` entry (the directory itself
or its `specs/` subfolder). Top-level spec fields: `specVersion`, `pack`,
`profile`, `accent`, `palette`, `apps`, `plugins`, `requires`, `pages`.

Merge rules (`lib/Spec.ps1`):
- An absent pack is a no-op: its pages, and the folder key that would open
  them, are not generated.
- Page ids are global; two packs claiming the same folder slot on the same
  parent page is an error, never a silent overwrite.
- Other profiles are referenced by **name** and never regenerated. If two
  installed profiles share a name the tool warns, because references to them
  become ambiguous.

The full format — every field, action type and icon form — is
[docs/spec-format.md](docs/spec-format.md). Personal and client packs stay
outside this repo. To migrate a hand-built setup, use
[docs/import-existing-setup.md](docs/import-existing-setup.md). With Claude
Code, the `author-deck-profile` skill drives both.

## Safety

- Refuses to install while the Stream Deck app runs: the app rewrites
  profiles on exit and would discard the new one.
- Builds into a temporary staging directory; `check=true` stops there.
- Before replacing a profile, copies it to `backupDir`, then swaps by rename.
  A failed swap restores the previous bundle. A run killed mid-swap is
  recovered on the next install.
- The profile GUID is derived deterministically (UUIDv5) from the profile
  name, so re-running replaces the same profile instead of adding a new one.

## Runtime and dependencies

- Runtime `powershell`: Windows PowerShell 5.1 on Windows. Code must stay
  5.1-compatible (no ternaries, no `??`).
- The Stream Deck app, installed and started at least once. Plugins that
  keys use (listed under `requires.plugins`) must be installed.
- `System.Drawing` for icon rendering.

## Tests

`test/*.test.ts` spawn the tool against fixture profile roots, never the live
one. They are Windows-only and skip elsewhere, so CI (Ubuntu) doesn't run
them. Run `yarn test` on Windows after changing anything under `lib/`.
