# m-control — Quick Start

## What is this?

**m-control** is a personal CLI orchestrator. You run `mctl run <tool-id>` and it discovers, spawns, and streams the output of standalone tool processes.

The project is a TypeScript monorepo:

```
m-control/
├── apps/mctl/          # CLI binary (@m-control/mctl)
├── packages/core/      # Runtime engine, no I/O (@m-control/core)
├── tools/              # Standalone tool processes (NOT npm packages)
│   ├── misc/           # hello-world (node), hello-python (python)
│   ├── agents/         # agent-status
│   └── artifacts/      # stream-deck, logi-options
├── templates/          # Boilerplate for new tools
├── docs/               # Architecture docs, ADRs, AI context
└── scripts/            # install.ps1 (Windows), install.sh (Linux/macOS)
```

## Prerequisites

- Node.js 20+ (22 recommended, see `.nvmrc`)
- Yarn 1.22+
- Git
- Python 3.10+ (for Python tools such as `hello-python`)

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
# Create ~/.m-control/config.json (registers this checkout's tools/ directory)
node apps/mctl/dist/bundle/index.js init

# List all discovered tools
node apps/mctl/dist/bundle/index.js list

# Run the hello-world tool (key=value pairs become the tool's input)
node apps/mctl/dist/bundle/index.js run hello-world name=You

# Check config, tools roots, runtimes, and required tool config
node apps/mctl/dist/bundle/index.js doctor
```

`mctl run` needs the config: without `init` it stops with
"No config found. Run 'mctl init'…". `doctor` reporting missing config for
`stream-deck` or `logi-options` is expected until you fill in their sections
under `tools` — those tools are Windows-only.

## 5. Install system-wide

```powershell
.\scripts\install.ps1      # Windows
```

```bash
./scripts/install.sh       # Linux/macOS — wrappers go to ~/.local/bin (override: M_CONTROL_BIN_DIR)
```

This:
- Builds the project
- Copies `apps/mctl/dist/bundle/index.js` to `~/.m-control/mctl.js`
- Adds `mctl` (and alias `mm`) to your PATH
- Creates `~/.m-control/config.json`, or adds this checkout's `tools/` to `paths.toolsRoots` in an existing one

**Windows: restart your terminal after installation.**

After installing:

```bash
mctl list
mctl run hello-world
```

## Development workflow

```bash
yarn verify                              # everything CI checks (resume: --from=<step>)
node apps/mctl/dist/bundle/index.js list # run without installing
```

The full command list is in `AGENTS.md` → "Commands".

## Adding a new tool

```bash
yarn new:tool --id=my-tool --category=misc --runtime=node --description="What it does"
node apps/mctl/dist/bundle/index.js run my-tool
```

No registration needed: discovery finds it. Then follow `AGENTS.md` →
"Adding a tool" (config keys, tests, README); `yarn verify` checks the result.

## Project docs

| File | Purpose |
|------|---------|
| `AGENTS.md` | Working rules for humans and AI agents — read this first |
| `docs/ai/PROJECT-CONTEXT.md` | Project state, roadmap, open decisions |
| `docs/architecture/constraints.md` | Hard rules (the constitution) |
| `docs/architecture/execution-model.md` | Tool Protocol v1 spec |
| `docs/ai/CODING-GUIDELINES.md` | Patterns and naming conventions |
| `docs/adr/` | Architecture Decision Records |
| `CONTRIBUTING.md` | Branching strategy, CI, commit conventions, releases |
| `REVIEW.md` | What reviewers check beyond `yarn verify` |
