# ADR-0013: Actions Ring Items in logi-options Packs

**Status:** Accepted  
**Date:** 2026-09-28  
**Deciders:** Michał + Claude  
**Tags:** tools, devices, generated-artifacts, safety

## Context

ADR-0011 made MX Master 4 buttons reproducible from `*.logi.json` packs. The
Actions Ring (the radial menu the haptic panel opens) stayed out of scope, so
a Ring item could only be made by hand in the Options+ UI and could not be
backed up as a spec or recreated on another machine. That gap blocked the
first feature that needs the Ring: a Chrome-only item that sends the shortcut
of the chrome-bridge extension (ADR-0014).

A feasibility study (2026-09-27/28, `tools/artifacts/logi-options/docs/actions-ring.md`,
experiments R0–R6 and K1–K3) established:

- **A second store with a second owner.** The Ring is not in `settings.db`. It
  lives in `%LOCALAPPDATA%\Logi\LogiPluginService\Applications\Loupedeck72\<app>\Profiles\<profile>\ProfileInfo.json`,
  owned by `LogiPluginService.exe` (LPS), a child of the Options+ agent. The
  8 `radial-menu-virtual-device` slots in `settings.db` are dormant.
- **Its own format.** 8 slots (`controlId` 0 = top, clockwise), each a
  reference string to an action defined elsewhere in the file, or `null`.
  Keyboard shortcuts are `$@Generic___@KeyboardKey` profile actions whose
  `keyboardKey` string is decoded (K1): logical names, Windows VK, a modifier
  bitmask, and a keyboard-layout id (HKL) plus scan code. It is not the card
  format `lib/model.py` compiles.
- **Portable with transformations.** The layout id can't be empty (the item
  loads but sends nothing), but any layout installed on the target works, so
  apply fills it in per machine (K2). Action ids are random in the UI.
  Plugin-less app Rings are matched by the lower-case exe stem, with no path.
  Chrome's Ring, as the UI creates it, requires Logitech's ChromeExtension
  plugin and its browser extension.
- **Writable safely.** Nothing is encrypted or signed; the file re-serializes
  byte for byte (Newtonsoft: 4-space indent, CRLF, declared key order); LPS
  does not re-save on start or stop; a script-written item was kept and fired
  on the device (R5). Writes need the whole agent tree stopped: the agent
  respawns a killed LPS in ~1.5 s (K3), so "stop LPS only, then write" is a race.

## Decision

Extend **`logi-options`**, not a new tool.

1. **Spec.** An optional `actionsRing` object per profile, next to `buttons`.
   Additive; `specVersion` stays 1 (an older tool rejects the unknown field,
   which is a safe refusal).
   - Slots by name: `top`, `top-right`, `right`, `bottom-right`, `bottom`,
     `bottom-left`, `left`, `top-left` (aliases `1`…`8`) → `controlId` 0…7.
   - Actions: `shortcut` (the buttons' grammar), `system` (an LPS system action
     by name, e.g. `media-play-pause` → `$DefaultWin___…`), `nothing` (→ `null`),
     and `raw` (the verbatim reference plus its definition; the export fallback,
     not portable).
   - Folders are not supported: apply rejects them, export fails recoverably
     naming the slot. A slot is never skipped silently.
2. **Applications, per app as well as global.**
   - `{"global": true}` → LPS app `@_defaultwin`.
   - `{"executable": "x.exe"}` → plugin-less LPS app `x` (lower-case stem),
     created with an empty profile when missing.
   - `{"builtin": "…"}` → the LPS app its Logitech plugin registers, when that
     plugin is installed; otherwise a recoverable error naming the plugin. The
     tool never installs Logitech plugins.
   - Chrome is decided by experiment R7 (Open Questions): if a plugin-less
     `chrome` app profile works, `builtin: google-chrome` maps to it and
     Logitech's plugin is not needed.
3. **Encoder.** `keyboardKey` is built at apply time. The HKL comes from the
   target machine (the default input layout, `HKCU\Keyboard Layout\Preload\1`,
   then the first `GetKeyboardLayoutList` entry); the scan code from
   `MapVirtualKeyEx` for that HKL. Keys and modifier orders not yet observed
   are rejected with a recoverable error, never guessed. Right-hand modifiers
   are rejected: the Ring stores them as left ones.
4. **Identity.** Action ids are `uuid5(RING_NAMESPACE, <canonical spec action>)`,
   e.g. `"shortcut:CTRL+SHIFT+Y"`. They are derived from the spec, never from
   the encoded string, so the id is the same on every machine and a layout
   change rewrites the action in place instead of adding a new one.
5. **Equality is semantic.** A slot is in sync when its action decompiles to
   the spec action: same logical keys, VK and modifier bits, and an HKL that is
   installed on this machine. A difference in HKL or scan code alone never
   triggers a write (and so never an agent restart).
6. **Surgical.** Only listed slots are written. Only actions with our own
   namespace ids are ever replaced or removed, and only once nothing
   references them. Items and orphans the UI created are left alone.
7. **One transaction for both stores.** The Ring write runs inside the
   existing stop → write → start window of `transaction.apply_change`, with
   one agent restart. After stopping the agent, the tool waits at most ~1 s
   for LPS to exit and otherwise refuses; it never extends the budget of
   ADR-0011.
8. **Guards, "refuse, not corrupt".** Byte-exact round-trip; layout shape (one
   mode, workspace and press page, controls 0…7); `deviceType`; owner stopped;
   hash re-checked right before an atomic replace; backup first. Any failure
   before the write writes nothing.
9. **Verification is weaker than for buttons, and says so.** LPS never re-saves,
   so there is no "loaded" signal. Apply verifies that LPS is running again,
   that the file is unchanged since the write, and that it decompiles to the
   specs. Whether an item fires is confirmed only on the device.
10. **Export covers the Ring.** `mode=export` decompiles slots into `shortcut`,
    `system` and `nothing`, and anything else into `raw`, so a hand-made Ring
    can be adopted into a pack without loss (folders excepted, see 1).

## Consequences

### Positive
- ✅ The Ring becomes part of the backed-up, reproducible mouse profile, per
  application
- ✅ No new tool, pack format or restart: the same packs, merge rules,
  backups and transaction
- ✅ Plugin-less app Rings match by exe stem only, which ports better than
  `settings.db` custom apps (no path resolution)

### Negative
- ❌ A second undocumented store to maintain. LPS has migrated this file on
  four updates already; each one can make the tool refuse until
  `docs/maintenance.md` is re-run
- ❌ The post-apply check can't prove an item fires; that stays a manual,
  on-device check
- ❌ A Ring-only change still restarts the agent (mouse on defaults for a few
  seconds), because LPS can't be stopped on its own without a race
- ❌ `raw` Ring items (e.g. run program, which stores a path) don't port

### Neutral
- ⚪ Folders and other `@Generic` actions (open URL, Easy-Switch, macros) can be
  added later, each after its own controlled-change experiment

## Alternatives Considered

### A separate tool for the Ring
**Pros:** isolates the second store. **Cons:** the same device and pack, two
transactions and two agent restarts per apply, and a merge across tools for one
profile. **Why rejected:** the store is different; the user's unit is the
same (one mouse profile).

### Kill only LogiPluginService, then write
**Pros:** buttons stay live during a Ring-only apply. **Cons:** the agent
respawns LPS in ~1.5 s (K3); a write in that window races the owner.
**Why rejected:** correctness over a few seconds of default buttons. LPS-only
*reload* after a write may be revisited.

### LPS's local WebSocket (`Temp\WebSocketPort.txt`)
**Why rejected:** undocumented IPC, rejected for the agent's pipe in ADR-0011
for the same reasons.

### Store `ProfileInfo.json` copies as the spec
**Why rejected:** not portable (random ids, the recording machine's layout,
paths) and not surgical. It stays what `mode=backup` does on one machine.

### Global Ring only
**Pros:** smaller v1, no app-profile creation. **Cons:** the feature that
motivated this is Chrome-only; per-app Rings are the point. **Why rejected:**
by the user's requirement.

## Open Questions

1. **R5c:** does a plugin-less app Ring created by the tool (not the UI) work
   when that app is in front?
2. **R7:** does a plugin-less `chrome` app Ring work without Logitech's
   ChromeExtension plugin and Logi Web Extension? Decides how
   `builtin: google-chrome` maps (Decision 2).
3. **Key coverage:** modifier order for Alt vs Win and Alt vs Shift; digits,
   punctuation, Space, arrows, Enter. Until recorded, the encoder rejects them.
4. **Layouts where VK and scan differ from US** (e.g. German QWERTZ): which
   value LPS replays.
5. **Second machine**, and whether the Global profile folder name differs per
   install (the tool reads `defaultProfileName` either way).

## Related Decisions

- **Extends:** [ADR-0011](0011-logi-options-spec-and-live-applier.md) (same packs, transaction, guards and budget)
- **Enables:** [ADR-0014](0014-chrome-bridge-native-messaging.md) (the Ring item that triggers the extension)
- **Related to:** [ADR-0009](0009-repository-topology-and-personal-work-split.md) (personal packs stay outside this repo)

## References

- `tools/artifacts/logi-options/docs/actions-ring.md` — findings, grammar, evidence R0–R6, K1–K3
- `tools/artifacts/logi-options/research/ring_poc.py` — the PoC writer
- `tools/artifacts/logi-options/research/ring-ui-written.json` — UI-written evidence
