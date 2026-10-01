# research/ — developer scripts

These are **not** part of the tool. They are run directly with `python`, not through
`mctl`, and they print human-readable text. They are the instruments behind
[`../docs/maintenance.md`](../docs/maintenance.md).

| Script | Use |
|---|---|
| `snapshot.py <label>` | Read-only snapshot: file hashes, registry fingerprints, processes, settings document |
| `diff_snapshots.py <a> <b> [--all]` | What changed between two snapshots: files, registry, document paths |
| `probe_keycodes.py` | Keystroke evidence in the installed catalogs, next to what `catalog.KEYS` maps each code to |
| `ring_poc.py [--app X [--create]] [--slot N] [--shortcut CTRL+SHIFT+Y] [--label TEXT] [--form full/short/nolayout] [--dry-run] [--rollback DIR]` | Actions Ring proof of concept (R5, R5c, R7, K2, K5 in [`../docs/actions-ring.md`](../docs/actions-ring.md)): encodes a shortcut and writes it into one Ring slot with LogiPluginService stopped; `--create` makes a plugin-less app. `--folder LABEL --folder-item ITEM…` writes a folder of 1–4 items (F6; `system:<Name>` or a shortcut), `--macro GUID [--macro-from FILE]` copies a macro verbatim (M1). **Writes live state**; backs up first |

Snapshots go to `~/.m-control/research/logi-options/snapshots/`, never into the
repo. They contain the whole settings document: host name, device serials, and
the path and command line of every app the agent has seen.
