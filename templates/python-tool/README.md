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

## Config

Only keys the manifest declares reach the tool: `requiredConfig` (the tool
can't work without them; `mctl doctor` reports unset ones) and `optionalConfig`
(read when present). They are resolved against the `tools` section of
`~/.m-control/config.json` and passed as a flat map in `context["config"]`, keyed by
the dot-path (e.g. `"tool-id.apiKey"`).

If a run can take more than 30 s, declare `timeoutMs` in the manifest.

| Key | Description |
|-----|-------------|
| *(none yet)* | |

A run with a required key unset fails with a recoverable `CONFIG_MISSING`
error naming the key.

## External dependencies

- Python 3.10+ (standard library only — add requirements here if that changes)
