# research/ — developer scripts

These are **not** part of the tool. They are run directly with `python`, not through
`mctl`, and they print human-readable text. They are the instruments behind
[`../docs/maintenance.md`](../docs/maintenance.md).

| Script | Use |
|---|---|
| `snapshot.py <label>` | Read-only snapshot: file hashes, registry fingerprints, processes, settings document |
| `diff_snapshots.py <a> <b> [--all]` | What changed between two snapshots: files, registry, document paths |
| `probe_keycodes.py` | Keystroke evidence in the installed catalogs, next to what `catalog.KEYS` maps each code to |

Snapshots go to `~/.m-control/research/logi-options/snapshots/`, never into the
repo. They contain the whole settings document: host name, device serials, and
the path and command line of every app the agent has seen.
