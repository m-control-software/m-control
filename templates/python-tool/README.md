# tool-id

> One-line description of what this tool does.

## Usage

```bash
mctl run tool-id
mctl run tool-id key=value        # key=value pairs become the tool's input
mctl run tool-id --json           # raw NDJSON event passthrough
```

## Runtime

Runs under the `python` runtime: `python3` on Linux/macOS, `python` on
Windows. Override the interpreter via `runtimes.python` in
`~/.m-control/config.json` (e.g. `"py"` or an absolute venv path).

## Required config

Keys listed in `manifest.json` `requiredConfig` are resolved against the
`tools` section of `~/.m-control/config.json` and passed to the tool as a
flat map in `context["config"]`.

| Key | Description |
|-----|-------------|
| *(none yet)* | |

## External dependencies

- Python 3.10+ (standard library only — add requirements here if that changes)
