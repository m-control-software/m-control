# m-control — Quick Start

## What is this?

**m-control** is a personal CLI orchestrator. You run `mctl <tool-id>` and it discovers, spawns, and streams the output of standalone tool processes.

The project is a TypeScript monorepo:

```
m-control/
├── apps/mctl/          # CLI binary (@m-control/mctl)
├── packages/core/      # Runtime engine, no I/O (@m-control/core)
├── tools/              # Standalone tool processes (NOT npm packages)
│   └── misc/
│       └── hello-world/
├── templates/          # Boilerplate for new tools
├── docs/               # Architecture docs, ADRs, AI context
└── scripts/            # install.ps1 (Windows)
```

## Prerequisites

- Node.js 18+
- Yarn 1.22+
- Git

## 1. Install dependencies

Always run from the monorepo root:

```bash
yarn install
```

## 2. Build

Build order matters — `core` must be built before `mctl`:

```bash
yarn build
```

This runs:
1. `yarn workspace @m-control/core build` — compiles TypeScript → `packages/core/dist/`
2. `yarn workspace @m-control/mctl build` — compiles TypeScript, then bundles via ncc → `apps/mctl/dist/bundle/index.js`

The final executable is `apps/mctl/dist/bundle/index.js` — a single self-contained Node.js file.

## 3. Verify the build

```bash
node apps/mctl/dist/bundle/index.js --help
```

Expected output: help text listing available commands and flags.

## 4. First commands

```bash
# List all discovered tools
node apps/mctl/dist/bundle/index.js list

# Run the hello-world tool
node apps/mctl/dist/bundle/index.js run hello-world
```

## 5. Install system-wide (Windows)

```powershell
.\scripts\install.ps1
```

This:
- Builds the project
- Copies `apps/mctl/dist/bundle/index.js` to `%USERPROFILE%\.m-control\`
- Adds `mctl` (and alias `mm`) to your PATH
- Initializes `~/.m-control/config.json`

**Restart your terminal after installation.**

After installing:

```bash
mctl list
mctl run hello-world
```

## Development workflow

### Type-check only (fast feedback)

```bash
yarn typecheck
```

### Lint

```bash
yarn lint
```

### Full build

```bash
yarn build
```

### Watch mode (core only)

```bash
yarn workspace @m-control/core dev
```

### Run without installing

```bash
node apps/mctl/dist/bundle/index.js <command>
```

## Adding a new tool

1. Copy the boilerplate:
   ```bash
   cp -r templates/node-tool tools/<category>/<tool-id>   # or templates/python-tool
   ```

2. Edit `tools/<category>/<tool-id>/manifest.json`:
   ```json
   {
     "manifestVersion": 1,
     "id": "my-tool",
     "name": "My Tool",
     "runtime": "node",
     "entry": "index.js"
   }
   ```

3. Implement `tools/<category>/<tool-id>/index.js` following the Tool Protocol:
   - Read all of `stdin` before doing work (JSON `ToolRequest`)
   - Emit NDJSON `ToolEvent` lines to `stdout`
   - Never use `console.log` to stdout (breaks the NDJSON parser)

4. No registration needed — `discoverTools()` finds tools automatically.

5. Test:
   ```bash
   node apps/mctl/dist/bundle/index.js run my-tool
   ```

See `docs/architecture/execution-model.md` for the full Tool Protocol spec.

## Project docs

| File | Purpose |
|------|---------|
| `docs/ai/PROJECT-CONTEXT.md` | AI session primer — read this first |
| `docs/architecture/constraints.md` | Hard rules (the constitution) |
| `docs/architecture/execution-model.md` | Tool Protocol v1 spec |
| `docs/ai/CODING-GUIDELINES.md` | Patterns and naming conventions |
| `docs/adr/` | Architecture Decision Records |
| `CONTRIBUTING.md` | Branching strategy, CI, commit conventions |
