# hello-python

> Sanity check for the `python` runtime: proves the interpreter is found and
> Tool Protocol v1 works end to end.

It is also the smallest reference implementation of the protocol in Python.
New tools start from `templates/python-tool` (via `yarn new:tool`), not from
here.

## Usage

```bash
mctl run hello-python             # "Hello, World!"
mctl run hello-python name=CI     # "Hello, CI!"
```

Input: `name` (optional, default `World`). Result: `{ message, toolId }`. The
`started` event reports the Python version in `meta.python`.

## Config

None. The interpreter is `python3` (Linux/macOS) or `python` (Windows);
override it with `runtimes.python` in `~/.m-control/config.json`.

## External dependencies

Python 3.10+ (standard library only).
