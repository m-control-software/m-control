# Maintenance — when Options+ changes underneath

Options+ updates itself. The tool treats it as an undocumented external system
and is built to **refuse, not corrupt**, when the internals move. This page says
what each refusal means and how to re-derive the model. It's the same method
that produced [internals.md](internals.md).

## After every Options+ update

```powershell
python -m unittest discover -s tools/artifacts/logi-options/test -p "test_*.py" -v
mctl run logi-options check=true
```

All green plus `inSync: true` means nothing is left to do.

## Guards and what they mean

| Error | Meaning | Where |
|---|---|---|
| `Expected exactly 1 row in settings.db data` / `not the expected Options+ store` | the storage container changed | `store.read_db` |
| `no longer round-trips byte-identically` | the agent's JSON writer changed (key order, escaping, indent); patches can no longer be proven minimal | `store.read_db` |
| `<catalog file> missing` | the depot layout moved | `catalog._load` |
| `No SPECIAL_KEYS defaults in the device package` | device package format changed | `model._special_keys` |
| `test_model` failures `*_byte_identical_to_ui` | the UI now writes cards differently: tags, fields, keystroke message | tests |
| `The agent did not keep the change` (auto-rollback) | the agent rejected, rewrote, or normalized what was written | `transaction.apply_change` |
| `verified: false` | the agent hadn't re-saved within the time budget. Usually harmless; confirm with `check=true` | `transaction.wait_for_resave` |

The guards fire **before** anything is written, except the last two, which fire
after a write the tool then rolls back (or tells you how to roll back).

## Re-deriving the model: the controlled-change method

Use this whenever a guard fires or you want to support something new (another
action type, a device setting, another device).

1. `python research/snapshot.py before`: a read-only snapshot of every candidate file, the registry, and the document.
2. In the Options+ UI make **exactly one** recognizable change (for example, top button → keyboard shortcut Ctrl+Shift+Esc).
3. `python research/snapshot.py after`.
4. `python research/diff_snapshots.py <snapshots>/before <snapshots>/after`: the changed files and document paths.
   Idle noise is zero. Agent-driven noise (token expiry, run times, firmware checks, icon cache) is hidden unless `--all`.
5. Compare what the UI wrote with what `model.compile_button` produces for the same spec.
   Adjust `catalog.normalize` / `model` until the new UI output is reproduced **byte for byte**.
6. Refresh the evidence: replace the relevant entry in `test/fixtures/ui-written.json`
   with the assignment exactly as the UI wrote it (cards only; no paths or serials),
   and update `optionsPlusBuild`.
7. Update [internals.md](internals.md) with what changed and the build number.

Rules that kept the original research safe:
- Take a backup first: `mctl run logi-options mode=backup`.
- Never write to settings.db while the agent runs.
- Keep snapshots out of the repo. They default to `~/.m-control/research/logi-options/`
  and contain host names, serials, and app command lines.
- One change per experiment, and prove "no noise" with an idle control pair first.

## The time budget

`mctl run` kills a tool after 30 s (hard-coded in `apps/mctl/src/commands/run.ts`),
and on Windows that kill runs no cleanup. `lib/transaction.py`:
- keeps its own 26 s deadline,
- refuses to stop the agent with less than 12 s left,
- keeps the stop → write → start window to a few seconds, and restarts the agent in `finally` (also on Ctrl+C),
- after that, only waits for the agent's re-save. A kill there is harmless.

If a machine is slow enough that applies report `verified: false` routinely, the
fix is a per-tool timeout in the manifest (open question in ADR-0011), not a
longer sleep.

## Adding a device

1. Find its package under `%PROGRAMDATA%\LogiOptionsPlus\depots\<build>\<guid>\manifest.json` (`modelId`).
2. Read `core_metadata.json` for its slot ids, and `ever_connected_devices` in the document for its `slotPrefix`.
3. Add it to `DEVICES` in `lib/catalog.py` with portable button names that match
   the MX Master 4's where the hardware is equivalent (`back`, `forward`, `middle`, …).
4. Run the controlled-change method once on the device, and add its evidence to the fixtures.

## Known unverified areas

- A second physical machine: portability is argued from the data, not yet exercised.
- Built-in apps that aren't yet detected on the target machine.
- Plugin / Smart Action cards across machines.
- Logitech cloud backup interacting with applied profiles.
- macOS: the catalogs ship `_osx` variants; the store location and agent control would differ.
