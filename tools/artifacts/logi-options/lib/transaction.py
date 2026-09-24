"""Guarded write transaction for the settings document, inside mctl's time budget.

    preview -> backup -> [stop agent -> re-read -> mutate -> write -> start agent]
    -> wait for the agent to load and re-save -> verify -> rollback if wrong

Why the budget matters: `mctl run` hard-codes timeoutMs 30 000
(apps/mctl/src/commands/run.ts) and on Windows the runner's kill is
TerminateProcess - no `finally` runs. A kill inside the bracketed window would
leave the agent stopped (mouse on default buttons until the next login). So the
window is short (seconds), and it is never entered unless enough of the budget
remains to finish it. A kill after the agent is back up is harmless.
"""
from __future__ import annotations

import copy
import time
from pathlib import Path
from typing import Callable

import backup
import docdiff
import store as st
from errors import StoreError, VerifyError

RUNNER_TIMEOUT_S = 30.0  # mctl's hard-coded runner timeout
BUDGET_S = 26.0          # this tool's own deadline: margin for interpreter start-up and the runner
CRITICAL_MIN_S = 12.0    # minimum budget left before stopping the agent (stop ~1 s, write <1 s, start ~2 s)


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
                 backups_dir: Path, label: str, log, deadline: Deadline, dry_run: bool = False) -> dict:
    """mutate(doc) -> doc must be pure and idempotent; verify(doc) -> problems."""
    snap = store.read()
    preview = mutate(copy.deepcopy(snap.doc))
    if st.serialize(preview) == snap.blob:
        return {"changed": False, "planned": []}
    planned = docdiff.describe(snap.doc, preview, include_noise=True)  # a plan hides nothing
    if dry_run:
        return {"changed": False, "dryRun": True, "planned": planned}

    if store.live:
        deadline.require(CRITICAL_MIN_S + 1, "back up, stop and restart the Options+ agent")
    safety = backup.create(store, backups_dir, f"pre-{label}")
    log("info", f"backup: {safety}")
    written: dict = {}

    def patch() -> None:
        fresh = store.read()  # the agent may have saved between the preview and the stop
        store.write(mutate(copy.deepcopy(fresh.doc)), fresh.sha256)
        written["snap"] = store.read()

    restarted = with_agent_stopped(store, patch, log, deadline)
    out = {"changed": True, "planned": planned, "backup": str(safety), "agentRestarted": restarted}
    if store.live and not restarted:
        out["note"] = "Options+ is not running; the change takes effect when it starts."
    after = wait_for_resave(store, written["snap"], deadline) if restarted else store.read()
    if after is None:
        out.update(verified=False, note="The agent had not re-saved within the time budget. "
                                        "Confirm with: mctl run logi-options check=true")
        return out
    problems = verify(after.doc)
    if problems:
        msg = "The agent did not keep the change:\n  " + "\n  ".join(problems)
        if not store.live or deadline.remaining() >= CRITICAL_MIN_S:
            backup.restore(store, backups_dir, safety, log, deadline)
            raise VerifyError(msg + f"\nRolled back to {safety.name}.")
        raise VerifyError(msg + f"\nRoll back with: mctl run logi-options mode=restore backup={safety.name}")
    out["verified"] = True
    return out
