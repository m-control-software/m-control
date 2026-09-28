# chrome-bridge

> A Chrome extension and a native messaging host that run allowlisted
> browser actions through `mctl`. v1 has one: save the YouTube / YouTube Music
> track in the current tab as an mp3 (`yt-download format=audio`).

```
Ctrl+Shift+Y (or the toolbar button, or an Actions Ring item that sends it)
  └─ extension/ (Manifest V3): reads the active tab's URL, checks it, connectNative
       └─ host/host.js (Node, started by Chrome): re-checks against its allowlist,
            runs  node <mctl.js> run yt-download url=<url> format=audio --json
            and relays mctl's events → badge progress, then one notification
```

Design and security model: [ADR-0014](../../../docs/adr/0014-chrome-bridge-native-messaging.md).

## Install (once per machine, Windows)

1. `mctl` installed at `~/.m-control/mctl.js` (`scripts/install.ps1`), or set
   `tools.chrome-bridge.mctlPath`. `yt-download` set up: `mctl run yt-download action=setup`.
2. Register the host:

   ```bash
   mctl run chrome-bridge action=install check=true   # shows what it would write; writes nothing
   mctl run chrome-bridge action=install
   ```

   It writes `~/.m-control/chrome-bridge/com.m_control.chrome_bridge.json` (the
   host manifest; only this extension's id is in `allowed_origins`) and
   `chrome-bridge-host.cmd` (absolute paths of the Node that ran mctl, `host/host.js`
   and `mctl.js`), then sets
   `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.m_control.chrome_bridge`.
   Re-run it after moving the repo or Node; it is idempotent.

3. Load the extension, the one manual step: open `chrome://extensions`, turn on
   **Developer mode**, click **Load unpacked**, and pick
   `tools/artifacts/chrome-bridge/extension` (the result's `extensionDir`). Its id must be
   **`dgngghofokeolbfnhajhdloajhbggalo`** (pinned by the manifest's `key`, the same on
   every machine).
4. Open `chrome://extensions/shortcuts` and check that "Save this YouTube / YouTube
   Music track as mp3" is **Ctrl+Shift+Y**. Chrome skips a suggested shortcut that
   another extension already uses; set it there if it's empty.

To remove it: `mctl run chrome-bridge action=uninstall` (files, log and registry
key; `check=true` first if you like), then remove the extension in Chrome.

## Use

On a YouTube or YouTube Music tab, press Ctrl+Shift+Y or click the toolbar button.
The badge shows `…`, then the percentage, then `✓` or `!`; a notification names the
saved file, or shows yt-download's error message and code. The file goes wherever
`yt-download` puts it (`tools.yt-download.outputDir`, default `~/Downloads`), with tags
and cover art.

Only the track in the tab is saved: the host rebuilds the URL from the video id, so
`&list=`, `&index=`, `&t=` and `&si=` are dropped. Any other page is refused by the
extension before anything starts, and again by the host.

## Input

| Key      | Values                    | Meaning                                                                                                   |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `action` | `install`, `uninstall`    | Required.                                                                                                 |
| `check`  | `true`, `false` (default) | Report the planned changes (`changes[]`: `create`/`update`/`unchanged`/`remove`/`absent`); write nothing. |

Result: `{ action, check, changed, hostName, extensionId, extensionDir, mctlPath, nodePath, changes, nextSteps }`.

## Config

Optional, under `tools.chrome-bridge` in `~/.m-control/config.json`.

| Key        | Default                | Description                                                                                                                                                                            |
| ---------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mctlPath` | `~/.m-control/mctl.js` | The mctl bundle the host runs. `~` is expanded; relative paths resolve against the home directory. Written into the launcher at install time, so re-run the install after changing it. |

## Security

- **Only this extension can connect.** Chrome checks the host manifest's
  `allowed_origins`; the host also refuses any other caller origin. Web pages can't
  reach a native host at all.
- **The host is the boundary**, not the extension. It accepts one message
  `{action, url}` per connection, looks the action up in a hard-coded allowlist
  (`extension/actions.js`, shared with the extension), validates the URL for it
  (exact hosts `youtube.com`, `www.`, `m.`, `music.youtube.com`, `youtu.be`; http(s)
  only; no credentials or port; an 11-character video id), and runs exactly one
  argument list with `spawn` and no shell. There is no "run any tool" message.
- Messages are length-prefixed (4 bytes, little-endian) and capped at 1 MB both ways.
- **The extension's private key isn't in the repo.** Only the public `key` is in
  `extension/manifest.json`, which is all "Load unpacked" needs to pin the id. The
  private key (needed only to pack a `.crx` or publish) was generated on the reference
  machine and is kept at `~/.m-control/keys/chrome-bridge-extension.pem`. Without it,
  a new key pair would change the id, and every host manifest would need re-installing.

## Lifetime

The host doesn't stop a download when the connection to the extension closes (the
service worker stops, the extension is reloaded, Chrome is closed): mctl keeps
running and the file still arrives, only its progress has nobody to go to. See
ADR-0014 for what was verified on the device. The host logs each run to
`~/.m-control/chrome-bridge/host.log` (256 KB, one rotation).

## Errors

The tool (`mctl run chrome-bridge …`):

| Code                               | Recoverable | Meaning                                                                       |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `INPUT_INVALID`                    | yes         | Missing or unknown `action`, a bad `check`, or an unknown key.                |
| `CONFIG_INVALID`                   | yes         | `mctlPath` is not a string.                                                   |
| `MCTL_NOT_FOUND`                   | yes         | No mctl at `mctlPath`.                                                        |
| `UNSUPPORTED_PLATFORM`             | yes         | Not Windows (v1).                                                             |
| `PATH_UNSUPPORTED`                 | yes         | A path contains `"`, `%` or a newline, which the `.cmd` launcher can't quote. |
| `WRITE_FAILED` / `REGISTRY_FAILED` | yes         | The host files or the registry key could not be written.                      |
| `VERIFY_FAILED`                    | yes         | After writing, the files or key still differ from the plan.                   |

The notification, when a tab is refused: `URL_NOT_ALLOWED`, `NOT_A_VIDEO`,
`URL_INVALID`, `ACTION_NOT_ALLOWED`, `MESSAGE_INVALID`, `MCTL_NOT_FOUND`; otherwise
yt-download's own codes (its README), or `HOST_DISCONNECTED` when Chrome can't start
the host (usually: `action=install` not run).

## Limitations

- Windows and Chrome only (v1). Edge would need its own registry key; macOS and
  Linux read host manifests from a directory instead of the registry.
- "Load unpacked" needs Developer mode, which a managed browser may forbid.
- `M_CONTROL_CHROME_BRIDGE_REG_KEY` replaces the registry key. Tests use it to stay
  out of Chrome's real key. Don't use it for anything else.
