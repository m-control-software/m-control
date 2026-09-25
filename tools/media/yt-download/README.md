# yt-download

> Downloads YouTube videos (mp4) or audio (mp3) with pinned, checksum-verified
> yt-dlp and ffmpeg.

A thin, deterministic wrapper over [yt-dlp](https://github.com/yt-dlp/yt-dlp):
the tool decides the formats, file names and flags, so every machine gets the
same result from the same command. yt-dlp and ffmpeg are **not** in this repo
and not taken from `PATH`. The tool installs the versions pinned in
[`deps.json`](deps.json) after verifying their SHA-256.

Only download content you have the rights to. YouTube's terms restrict
downloading.

## Usage

```bash
mctl run yt-download action=setup                          # once per machine (and after a pin bump)
mctl run yt-download url=https://youtu.be/<id>             # best-quality mp4 into ~/Downloads
mctl run yt-download url=https://youtu.be/<id> format=audio            # mp3 with tags + cover art
mctl run yt-download url=https://youtu.be/<id> maxHeight=1080          # cap the resolution
mctl run yt-download "url=https://www.youtube.com/watch?v=<id>&list=<list>" playlist=true
mctl run yt-download url=https://youtu.be/<id> outDir=.                # into the current directory
mctl run yt-download url=https://youtu.be/<id> check=true              # what would be downloaded; writes nothing
```

Quote a URL that contains `&`, or the shell splits it.

### Input

| Key | Values | Default | Meaning |
|-----|--------|---------|---------|
| `action` | `download`, `setup` | `download` | `setup` installs the pinned binaries. |
| `url` | http(s) URL | — | Video, playlist or YouTube Music link. Required for `download`. |
| `format` | `video`, `audio` | `video` | `video`: mp4, highest resolution, H.264/AAC preferred at equal resolution. `audio`: mp3 (best VBR), metadata and thumbnail embedded. |
| `maxHeight` | pixels, e.g. `720` | none | Upper bound on video height. `format=video` only. |
| `playlist` | `true`, `false` | `false` | For a URL that names both a video and a playlist, download the whole playlist. A pure playlist URL always downloads the playlist. |
| `outDir` | path | config / `~/Downloads` | Relative paths resolve against the directory mctl runs from. |
| `check` | `true`, `false` | `false` | Report only: what would be downloaded, or (with `action=setup`) what would be installed. |

Unknown keys and malformed values are rejected (`INPUT_INVALID`), never
guessed. Files are named `<title> [<id>].<ext>`. Existing files are never
overwritten, and an interrupted download resumes from its `.part` file on the
next run.

### Result

`download`: `{ outputDir, format, ytDlp: { version, source }, items, failed }`.
`items` holds `{ id, title, file, bytes, durationSec }` per saved file.
`failed` holds `{ id, title, code, recoverable, message }` per item that
failed. If a playlist fails only partly, the run still succeeds and lists the
failures. It fails only when nothing was saved. With `check=true`, `items`
holds `{ id, title, durationSec, url }`.

`setup`: `{ platform, depsDir, installed, alreadyPresent, skipped }`. Each
entry has `{ name, version, path, url, sha256 }`. `skipped` lists binaries
replaced by a configured path.

Progress is logged at most once per 10 % and at most every 2 s per file.

## Config

All keys are optional, under `tools.yt-download` in
`~/.m-control/config.json`. Relative paths resolve against the home
directory, and `~` is expanded.

| Key | Default | Description |
|-----|---------|-------------|
| `outputDir` | `~/Downloads` | Where downloads go when `outDir=` is not given. |
| `depsDir` | `~/.m-control/deps` | Where `setup` installs the pinned binaries, as `<depsDir>/<name>/<version>/`. |
| `ytDlpPath` | managed install | Use your own yt-dlp executable instead of the pinned one. |
| `ffmpegPath` | managed install | Use your own ffmpeg: the binary or its directory (ffprobe must sit next to it). |

```jsonc
{
  "tools": {
    "yt-download": { "outputDir": "D:\\Media\\YouTube" }
  }
}
```

## External dependencies

| Dependency | Why | Provided by |
|------------|-----|-------------|
| yt-dlp | Extraction and download | `action=setup`: official standalone binary from yt-dlp's GitHub releases |
| ffmpeg + ffprobe | Merging video and audio above ~720p; mp3 conversion; embedding | `action=setup`: `yt-dlp/FFmpeg-Builds` (GPL build) |
| JavaScript runtime | YouTube's player challenges ([yt-dlp EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS)) | The Node that runs mctl, passed as `--js-runtimes node:<path>`. Needs Node 22+ |
| `tar` | Extracting ffmpeg during setup | Windows 10+ `System32\tar.exe`; on Linux the tar and xz packages |

Pinned platforms: `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`.
Elsewhere (e.g. macOS), install both binaries yourself and set `ytDlpPath` and
`ffmpegPath`. The run then fails with `UNSUPPORTED_PLATFORM` until you do.

Resolution order for each binary: the configured path, then the managed
install of the pinned version. `PATH` is never searched, so a run never
silently picks up a different version.

`setup` downloads to a temporary directory next to the target, verifies the
SHA-256, extracts only the listed files, and renames the result into place. A
version directory is therefore either complete or absent. `setup` is
idempotent, and old versions stay until you delete them.

Behind a proxy: Node's `fetch` ignores `HTTPS_PROXY` unless
`NODE_USE_ENV_PROXY=1` is set (Node 22.21+). yt-dlp honours `HTTPS_PROXY`
itself.

### Updating the pins

YouTube changes break older yt-dlp versions within weeks or months. The
symptom is `EXTRACTION_FAILED`. To move to a new release:

1. Take the version tag from <https://github.com/yt-dlp/yt-dlp/releases>.
2. Copy the hashes for `yt-dlp.exe`, `yt-dlp_arm64.exe`, `yt-dlp_linux` and
   `yt-dlp_linux_aarch64` from that release's `SHA2-256SUMS`.
3. Update `version`, every `url` and every `sha256` under `yt-dlp` in
   `deps.json`. `test/setup.test.ts` fails if a URL does not contain the
   version.
4. ffmpeg rarely needs a bump. When it does, use a **month-end**
   `autobuild-YYYY-MM-DD-HH-MM` release of `yt-dlp/FFmpeg-Builds`, because
   those are retained long-term and the daily ones are pruned. Take the hashes
   from its `checksums.sha256` and the `binDir` from the archive name.
5. `yarn verify`, commit, then `mctl run yt-download action=setup` on each
   machine.

`M_CONTROL_YT_DOWNLOAD_DEPS=<file>` replaces `deps.json`. Tests use it to pin
local assets. Don't use it for anything else.

## Errors

| Code | Recoverable | Meaning |
|------|-------------|---------|
| `INPUT_INVALID` | yes | Missing `url`, bad value, unknown key, or a URL yt-dlp does not support. |
| `CONFIG_INVALID` | yes | A config path is not a string, does not exist, or does not run. |
| `NODE_TOO_OLD` | yes | mctl runs on Node < 22, which yt-dlp cannot use as its JS runtime. |
| `UNSUPPORTED_PLATFORM` | yes | No pin for this OS/CPU; set `ytDlpPath` / `ffmpegPath`. |
| `DEPS_MISSING` | yes | Not set up yet; run `action=setup`. |
| `DEPS_DOWNLOAD_FAILED` | yes | Network failure, or the pinned asset is gone (HTTP 404 → bump the pin). |
| `DEPS_EXTRACT_FAILED` | yes | `tar` (or xz) missing or failed. |
| `DEPS_INSTALL_FAILED` | yes | The install directory is not writable. |
| `DEPS_CHECKSUM_MISMATCH` | no | The download does not match the pin. Nothing was installed. |
| `DEPS_MANIFEST_INVALID` | no | `deps.json` is malformed or its `binDir`/`files` do not match the archive. |
| `OUTPUT_DIR_UNWRITABLE` | yes | The output directory cannot be created or written. |
| `VIDEO_UNAVAILABLE` | yes | Private, removed, members-only, age- or region-restricted, or a bot check. |
| `EXTRACTION_FAILED` | yes | yt-dlp could not read YouTube's page, usually because the pin is outdated. |
| `NETWORK_ERROR` | yes | yt-dlp could not reach YouTube. |
| `YTDLP_FAILED` | no | Any other yt-dlp failure. Its full output is on stderr. |

yt-dlp has no machine-readable errors. The codes above come from matching the
wording of its `ERROR:` lines (`classify` in `lib/ytdlp.js`), so new wording
upstream falls through to `YTDLP_FAILED`.

## Limitations

- **Budget:** `timeoutMs` is 1 hour. Override it per machine with
  `timeouts.tools["yt-download"]` for very long playlists.
- **Windows: a timeout does not stop yt-dlp.** The runner stops tools with a
  signal that Windows implements as TerminateProcess, which does not reach
  child processes, so yt-dlp finishes (or stalls) on its own. POSIX forwards
  the signal. The real fix is a process-tree kill in the core runner.
- **No signed-in downloads.** Private playlists (Liked, Watch Later),
  age-restricted and members-only videos need cookies. The design notes on
  `cookiesFile`/`cookiesFromBrowser` were deliberately left out of v1.
- Tests replace yt-dlp with `test/fixtures/fake-yt-dlp.js` (a shebang
  script), so the download tests run on POSIX only. CI covers them.
