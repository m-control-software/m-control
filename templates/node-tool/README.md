# tool-id

> One-line description of what this tool does.

## Usage

```bash
mctl run tool-id
mctl run tool-id key=value        # key=value pairs become the tool's input
mctl run tool-id --json           # raw NDJSON event passthrough
```

## Required config

Keys listed in `manifest.json` `requiredConfig` are resolved against the
`tools` section of `~/.m-control/config.json` and passed to the tool as a
flat map in `context.config`.

| Key | Description |
|-----|-------------|
| *(none yet)* | |

## External dependencies

- *(none)* — or list binaries/services required, e.g. `kubectl`, `az` CLI

## Notes

TODO: Known limitations, quirks, future improvements.
