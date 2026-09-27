# research/ — developer scripts

These are **not** part of the tool. They are run directly with `python`, not through
`mctl`, and they print human-readable text. They are the instruments behind
[`../docs/maintenance.md`](../docs/maintenance.md).

| Script | Use |
|---|---|
| `snapshot.py <label>` | Read-only snapshot: file hashes, registry fingerprints, processes, settings document |
| `diff_snapshots.py <a> <b> [--all]` | What changed between two snapshots: files, registry, document paths |
| `probe_keycodes.py` | Keystroke evidence in the installed catalogs, next to what `catalog.KEYS` maps each code to |
| `ring_poc.py [--slot N] [--dry-run] [--rollback DIR]` | Actions Ring proof of concept (R5 in [`../docs/actions-ring.md`](../docs/actions-ring.md)): writes Ctrl+Shift+Esc into one Ring slot with LogiPluginService stopped. **Writes live state**; backs up first |
| `ring-ui-written.json` | Sanitized Ring items as the UI wrote them (R1–R4); evidence for a future `test/fixtures/` entry |

Snapshots go to `~/.m-control/research/logi-options/snapshots/`, never into the
repo. They contain the whole settings document: host name, device serials, and
the path and command line of every app the agent has seen.
