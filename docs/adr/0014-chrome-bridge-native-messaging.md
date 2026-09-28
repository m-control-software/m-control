# ADR-0014: chrome-bridge — Browser Actions via an Extension and a Native Messaging Host

**Status:** Accepted (2026-09-28, after the host-lifetime tests on the device)  
**Date:** 2026-09-28  
**Deciders:** Michał + Claude  
**Tags:** tools, browser, security, distribution

## Context

The first browser-triggered action: pick an Actions Ring item while a YouTube
or YouTube Music tab is in front, and get that track as an mp3 through
`yt-download` (`format=audio`). The Ring can only send a keystroke (ADR-0013);
nothing outside Chrome can reliably read the active tab's URL.

ADR-0009 listed "yt-dlp / YT-Music downloader + Chrome extension" in its
inventory, and ADR-0010 (Open Question 3) called the extension "a genuine
misfit — not a task, app, or artifact, but a thing installed into a browser
profile". This ADR answers that question.

Constraints:

- **Chrome on Windows installs external extensions only from the Web Store.**
  An unpacked extension needs Developer mode and one manual "Load unpacked"
  per machine. Its id is derived from its path unless the manifest pins `key`.
- **Extension shortcuts** (`chrome.commands`) are suggestions: Chrome assigns
  them unless they collide, and only the user can change them
  (`chrome://extensions/shortcuts`).
- **Native messaging** is the only sanctioned channel from an extension to a
  local process. Chrome finds the host through a registry key
  (`HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>`) pointing at a
  JSON manifest whose `allowed_origins` lists the extension ids allowed to
  connect. Web pages can't reach it.
- **Downloads take minutes** (`yt-download` declares `timeoutMs` 1 h), longer
  than any message round trip.

## Decision

A `task` tool **`chrome-bridge`** in `tools/artifacts/chrome-bridge/`
(`runtime: node`, plain JS, no dependencies, no build step):

```
tools/artifacts/chrome-bridge/
├── manifest.json   task: action=install | uninstall, check=true
├── index.js        writes the host manifest, the .cmd launcher and the HKCU key; idempotent
├── extension/      Manifest V3, plain JS; `key` pinned so the id is the same on every machine
└── host/           the native messaging host (Node): an allowlist of actions, each → one mctl run
```

1. **Trigger.** An extension command (suggested `Ctrl+Shift+Y`) reads the
   active tab's URL through `chrome.tabs` (the command grants `activeTab`).
   The Actions Ring item sends that shortcut (ADR-0013); the toolbar button
   triggers the same action.
2. **Channel.** The extension calls `chrome.runtime.connectNative` and sends
   `{ action, url }`. The host is the security boundary: it accepts only
   actions in its own hard-coded allowlist and validates the URL for each.
   v1 has one action, `yt-audio`: hosts `youtube.com`, `www.youtube.com`,
   `m.youtube.com`, `music.youtube.com`, `youtu.be`; → `yt-download` with
   `url` and `format=audio`. There is no generic "run any tool" message.
3. **Execution through mctl.** The host spawns
   `node <mctl.js> run yt-download url=<url> format=audio --json` with an
   argument array, no shell, so config resolution, timeouts and guardrails are
   mctl's. It relays each NDJSON event to the extension as a native message.
   The extension shows progress on its badge and a notification with the
   saved file name, or the error message. *(Device run: Windows didn't show
   Chrome's notifications and the badge is hidden unless the extension is
   pinned, so the same news also goes in a toast in the page, via
   `scripting` limited to the tab the command ran on.)*

   **Lifetime (Open Questions 1–2, answered on the device, Chrome 154):** the
   host lets mctl run to the end whatever happens to the port. With the
   service worker left alone, one open port kept it alive through a
   3.5-minute run and the result came back. After an extension reload and
   after quitting Chrome, the host logged the closed port and the download
   still completed (mctl exit 0, file saved). Chrome doesn't kill the host or
   its children on Windows, so **no detached spawn is needed**; only the
   progress of a job whose port closed is lost.

   **One job per URL.** Two runs of one track collide on its file (yt-dlp
   renames its `.temp.mp3` in place), so the host holds a lock per URL for
   the job's lifetime and refuses a second one (`ALREADY_RUNNING`).
4. **Install is a tool action.** `mctl run chrome-bridge action=install`
   writes, outside the repo (under `~/.m-control/chrome-bridge/`): the host
   manifest with absolute paths and the extension's id in `allowed_origins`,
   and a `.cmd` launcher with the absolute path of the Node that runs mctl
   (`process.execPath`) and of `mctl.js`. It then sets the HKCU key.
   `check=true` reports what would change; `uninstall` removes all of it.
   Loading the unpacked extension stays a documented manual step.
5. **Discovery stops at a tool's directory** *(added 2026-09-28, during the
   build)*. Chrome requires `extension/manifest.json` by that name, and mctl's
   discovery walked the whole tools root, so it reported the extension's
   manifest as a broken tool manifest on every run. Discovery now treats a
   directory holding `manifest.json` as a tool and never descends into it
   (core change, CHANGELOG "Changed"). Chosen over copying the extension out
   of the repo at install time, which would need a re-install for every change.
6. **Where it lives.** In this repo: it is generic code with no personal
   data, a few hundred lines with no build. It moves to its own repo only if
   it ever needs a build step or Web Store publishing (ADR-0009, rule 2).

## Consequences

### Positive
- ✅ Reliable URL: the browser API, not screen scraping; works across YouTube
  Music's in-page navigation
- ✅ Only our extension can reach the host, and the host runs only
  allowlisted actions on validated URLs
- ✅ Progress and results come back to the browser from the tool's own events
- ✅ A second browser action is one allowlist entry, not a second extension

### Negative
- ❌ One manual step per machine ("Load unpacked", Developer mode on); a
  managed work laptop may forbid it by policy
- ❌ Windows only in v1 (the registry key); macOS/Linux use manifest paths instead
- ❌ Chrome only in v1; Edge would need its own registry key and a second
  `allowed_origins` entry
- ❌ Depends on the MV3 service-worker lifetime rules, which Chrome has changed before

### Neutral
- ⚪ Resolves ADR-0010 Open Question 3 without a fourth `kind`: an ordinary
  `task` that installs, plus one manual step

## Alternatives Considered

### Read the address bar with Windows UI Automation
**Pros:** nothing to install. **Cons:** breaks on Chrome UI changes and on
localized control names (Polish here); the omnibox drops the scheme; no way to
report progress. **Why rejected:** fragile where it matters.

### A custom `mctl://` protocol handler
**Pros:** no native messaging registration. **Cons:** any web page can invoke
it, and one "always allow" turns it into a path from any site into the
toolchain. **Why rejected:** security.

### Copy the URL with a keystroke macro, then read the clipboard
**Cons:** clobbers the clipboard, depends on focus and timing, and can't be
authored in a spec. **Why rejected:** fragile.

### The extension inside `tools/media/yt-download/`
**Cons:** the next browser action would need a second extension, host and
registry key. **Why rejected:** the bridge is generic; the action is one entry.

### A separate repository
**Cons:** cross-repo sync for a few hundred lines with no build.
**Why rejected:** ADR-0009 reserves separate repos for heavy apps with builds and releases.

## Open Questions

Answered on 2026-09-28 (device, Chrome 154.0.8037.57, Windows 11):

1. ~~**Host lifetime.**~~ The download survives the port closing: extension
   reloaded (finished 1 min 49 s later) and Chrome quit (finished 2 min later).
   No job object kills the host's children; the detached fallback isn't needed.
2. ~~**MV3 lifetime.**~~ An open `connectNative` port kept the idle service worker
   alive for a 3.5-minute run (download plus mp3 conversion) and the result arrived.
3. ~~**Finding mctl.**~~ The default works, **if that mctl is current**. On the
   device `~/.m-control/mctl.js` was two months old: it ignored yt-download's
   `timeoutMs` and stopped every run after 30 s (`RUNNER_TIMEOUT`, while yt-dlp
   carried on unsupervised). `action=install` now warns when it differs from the
   checkout's build (`mctlCurrent`); keeping mctl updated is the fix.

Still open:

4. **Work laptop.** Is Developer mode / unpacked loading allowed by policy there?
5. **Runs mctl can't stop.** On Windows mctl's timeout doesn't kill yt-dlp's
   process tree (yt-download README, Limitations). With a current mctl the 1 h
   budget makes that rare, but a run killed that way keeps writing after the host
   released its lock. The fix is the process-tree kill in the core runner.

## Related Decisions

- **Answers:** [ADR-0010](0010-tool-kinds-task-app-artifact.md) Open Question 3
- **Triggered by:** [ADR-0013](0013-actions-ring-in-logi-options-packs.md) (the Ring item that sends the shortcut)
- **Related to:** [ADR-0009](0009-repository-topology-and-personal-work-split.md) (where code lives), [ADR-0003](0003-ndjson-protocol.md) (the events relayed to the browser)

## References

- Chrome docs: Native messaging; `chrome.commands`; extension service worker lifecycle
- `tools/media/yt-download/README.md` — inputs, result and error codes the extension shows
