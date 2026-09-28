"""Guarded write transaction for the settings document, inside mctl's time budget.

    preview -> backup -> [stop agent -> re-read -> mutate -> write -> start agent]
    -> wait for the agent to load and re-save -> verify -> rollback if wrong

The Actions Ring (lib/ring.py, another store owned by LogiPluginService, a child
of the agent) is written inside the same bracketed window.

Why the budget matters: manifest.json declares timeoutMs 30 000, which `mctl run`
enforces unless the user overrides it per tool (config.timeouts.tools), and on
Windows the runner's kill is TerminateProcess - no `finally` runs. A kill inside the bracketed window would
leave the agent stopped (mouse on default buttons until the next login). So the
window is short (seconds), and it is never entered unless enough of the budget
remains to finish it. A kill after the agent is back up is harmless.
"""
from __future__ import annotations

import copy
import time
from pathlib import Path
from collections.abc import Callable

import backup
import docdiff
import ring
import store as st
from errors import StoreError, VerifyError

RUNNER_TIMEOUT_S = 30.0  # must match manifest.json timeoutMs
BUDGET_S = 26.0          # this tool's own deadline: margin for interpreter start-up and the runner
CRITICAL_MIN_S = 12.0    # minimum budget left before stopping the agent (stop ~1 s, write <1 s, start ~2 s)
RING_OWNER_STOP_S = 1.0  # after the agent stopped, LogiPluginService must be gone within this (ADR-0013)


class Deadline:
    def __init__(self, budget_s: float = BUDGET_S):
        self.t0 = time.monotonic()
        self.end = self.t0 + budget_s

    def remaining(self) -> float:
        return self.end - time.monotonic()

    def elapsed(self) -> float:
        return time.monotonic() - self.t0

    def require(self, seconds: float, what: str) -> None:
        if self.remaining() < seconds:
            raise StoreError(f"Only {self.remaining():.0f}s left of mctl's {RUNNER_TIMEOUT_S:.0f}s budget - not enough "
                             f"to {what} safely. Nothing was changed; run the command again.")


def with_agent_stopped(store: st.Store, fn: Callable[[], None], log, deadline: Deadline) -> bool:
    """Run fn with the agent stopped; always restart it. Returns True if it was running.
    For a non-live store (tests, copies) the agent is never touched."""
    if not store.live:
        fn()
        return False
    deadline.require(CRITICAL_MIN_S, "stop and restart the Options+ agent")
    was_running = store.stop_agent(log)
    try:
        fn()
    finally:  # also runs on Ctrl+C (KeyboardInterrupt)
        if was_running:
            store.start_agent(log)
    return was_running


def wait_for_resave(store: st.Store, written: st.Snapshot, deadline: Deadline) -> st.Snapshot | None:
    """The agent re-saves the whole document shortly after it starts (observed
    ~8 s). That re-save is the evidence it loaded what was written."""
    while deadline.remaining() > 1.0:
        snap = store.read()
        if snap.sha256 != written.sha256 or snap.date_created != written.date_created:
            return snap
        time.sleep(0.25)
    return None


def apply_change(store: st.Store, mutate: Callable[[dict], dict], verify: Callable[[dict], list[str]],
                 backups_dir: Path, label: str, log, deadline: Deadline, dry_run: bool = False,
                 ring_plans: list | None = None, ring_store=None, ring_verify=None) -> dict:
    """mutate(doc) -> doc must be pure and idempotent; verify(doc) -> problems.

    ring_plans (lib/ring.py Plan objects) join the same transaction (ADR-0013
    Decision 7): one backup, one agent restart; after stopping the agent,
    LogiPluginService must be gone within ~1 s or nothing is written.
    ring_verify(plans) -> problems runs once LogiPluginService is back."""
    snap = store.read()
    preview = mutate(copy.deepcopy(snap.doc))
    settings_changed = st.serialize(preview) != snap.blob
    rings = [p for p in ring_plans or [] if p.changes]
    if not settings_changed and not rings:
        return {"changed": False, "planned": []}
    planned = docdiff.describe(snap.doc, preview, include_noise=True) if settings_changed else []  # hides nothing
    planned += [f"{p.target.label} ({p.target.app}): {c}" for p in rings for c in p.changes]
    if dry_run:
        return {"changed": False, "dryRun": True, "planned": planned}
    if rings and ring_store.live and not store.live:
        raise StoreError("The Ring store is the live one but logi-options.dataDir is a copy, so the Options+ agent "
                         "(and LogiPluginService with it) would not be stopped. Nothing was written. Point both at "
                         "copies, or both at the live stores.")

    if store.live:
        deadline.require(CRITICAL_MIN_S + 1, "back up, stop and restart the Options+ agent")
    safety = backup.create(store, backups_dir, f"pre-{label}")
    if rings:
        ring.backup(rings, ring_store, safety)
    log("info", f"backup: {safety}")
    written: dict = {}

    def patch() -> None:
        if rings and ring_store.live:
            ring.wait_owner_stopped(st.list_processes, RING_OWNER_STOP_S)
        fresh = store.read()  # the agent may have saved between the preview and the stop
        doc = mutate(copy.deepcopy(fresh.doc))
        if rings:
            ring.precheck(rings)
            ring.write(rings)
        try:
            if settings_changed:
                store.write(doc, fresh.sha256)
        except Exception:
            if rings:
                ring.undo(rings)
            raise
        written["snap"] = store.read()

    restarted = with_agent_stopped(store, patch, log, deadline)
    out = {"changed": True, "planned": planned, "backup": str(safety), "agentRestarted": restarted}
    if store.live and not restarted:
        out["note"] = "Options+ is not running; the change takes effect when it starts."
    after = (wait_for_resave(store, written["snap"], deadline) if restarted and settings_changed
             else store.read())
    if after is None:
        out.update(verified=False, note="The agent had not re-saved within the time budget. "
                                        "Confirm with: mctl run logi-options check=true")
        return out
    problems = verify(after.doc)
    if rings:
        if restarted and ring_store.live and not ring.wait_owner_running(
                st.list_processes, lambda: deadline.remaining() > 1.0):
            out.update(verified=False, note="LogiPluginService had not started again within the time budget. "
                                            "Confirm with: mctl run logi-options check=true")
            return out
        problems += ring_verify(rings)
    if problems:
        msg = "The change was not kept:\n  " + "\n  ".join(problems)
        if not store.live or deadline.remaining() >= CRITICAL_MIN_S:
            backup.restore(store, backups_dir, safety, log, deadline, ring_store)
            raise VerifyError(msg + f"\nRolled back to {safety.name}.")
        raise VerifyError(msg + f"\nRoll back with: mctl run logi-options mode=restore backup={safety.name}")
    out["verified"] = True
    return out
