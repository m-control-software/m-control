# hello-world

> Sanity check for the `node` runtime: proves discovery, spawning and Tool
> Protocol v1 work end to end.

It is also the smallest reference implementation of the protocol in Node.js.
New tools start from `templates/node-tool` (via `yarn new:tool`), not from here.

## Usage

```bash
mctl run hello-world              # "Hello, World!"
mctl run hello-world name=CI      # "Hello, CI!"
```

Input: `name` (optional, default `World`). Result: `{ message, toolId }`.

## Config

None.

## External dependencies

None beyond Node.js.
