# m-control

Michał's personal CLI orchestrator — discovers and runs standalone tool processes from a single `mctl` command. Evolving toward a SaaS product for developer teams.

## Features

- Tool discovery — drop a `manifest.json` in `tools/`, it just works
- NDJSON event streaming — live progress from long-running tools
- Polyglot runtime — tools can be Node.js, Python, .NET, or anything else
- Cross-platform — Windows primary, Linux secondary

## Requirements

- Node.js 18.0.0 or higher
- Yarn 1.22+

## Project structure

```
m-control/
├── apps/mctl/          # CLI binary (@m-control/mctl)
│   └── dist/bundle/    # Build output — index.js (ncc bundle)
├── packages/core/      # Runtime engine (@m-control/core) — library only
├── tools/              # Standalone tool processes (NOT npm packages)
│   └── misc/
│       ├── hello-world/    # node reference tool
│       └── hello-python/   # python reference tool
├── templates/          # Boilerplate for new tools (node-tool, python-tool)
├── docs/               # Architecture docs, ADRs, AI context
├── scripts/            # install.ps1 (Windows), install.sh (Linux/macOS)
├── .claude/            # Claude Code rules + project skills
├── .cursor/            # Cursor rules (thin pointer to docs/)
└── .github/            # CI + Copilot instructions
```

## Installation

The installers build the repo, copy the single-file bundle to
`~/.m-control/mctl.js`, put `mctl` (and the `mm` alias) on PATH, and create
`~/.m-control/config.json` with this checkout's `tools/` directory registered
as a tools root — so the globally installed `mctl` keeps discovering the
repo's tools. `git pull` + `./scripts/install.sh` (or `.ps1`) to update.

### Windows

```powershell
.\scripts\install.ps1
```

**Restart your terminal after installation.**

### Linux / macOS

```bash
./scripts/install.sh
```

Wrappers go to `~/.local/bin` (override with `M_CONTROL_BIN_DIR`).

## Usage

```bash
mctl init                        # create ~/.m-control/config.json
mctl list                        # list all discovered tools
mctl run hello-world             # run a tool
mctl run hello-world name=You    # key=value pairs become tool input
mctl run hello-world --json      # raw NDJSON event passthrough
mctl doctor                      # diagnose config, discovery, runtimes
mctl --help                      # show help
```

Tools are discovered from, in priority order: the `M_CONTROL_TOOLS_ROOT`
env var, `paths.toolsRoots` in the config, or the repo's `tools/` directory
when running from a checkout.

## Build

Always run from the monorepo root:

```bash
yarn install
yarn build
```

Build order is enforced: `@m-control/core` is built first, then `@m-control/mctl`. The final output is `apps/mctl/dist/bundle/index.js`.

To verify:

```bash
node apps/mctl/dist/bundle/index.js --help
```

## Development

```bash
yarn typecheck     # type-check all packages
yarn lint          # lint all packages
yarn test          # run Vitest tests
yarn build         # full build (core then mctl)
```

See `QUICKSTART.md` for a complete getting-started walkthrough.

## Branching strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable, releasable. Tags here only. |
| `develop` | Active development. Direct commits while solo. |

CI runs on both branches. See `CONTRIBUTING.md` for details.

## Adding a tool

1. Copy `templates/node-tool/` or `templates/python-tool/` to `tools/<category>/<id>/`
2. Edit `manifest.json` — set `id`, `runtime`, `entry`
3. Implement the entry file following Tool Protocol v1 (NDJSON stdout, JSON stdin)
4. No registration needed — discovery is automatic

Any language works: `node`, `python`, `powershell`, and `dotnet` runtimes are
supported out of the box; interpreters can be overridden per machine via
`runtimes` in the config (e.g. `{ "python": "py" }`).

See `docs/architecture/execution-model.md` for the protocol spec.

## Documentation

- `QUICKSTART.md` — step-by-step first-run guide
- `CONTRIBUTING.md` — branching, CI, commit conventions
- `docs/ai/PROJECT-CONTEXT.md` — AI session primer
- `docs/architecture/` — architecture docs and constraints
- `docs/adr/` — architecture decision records

## License

MIT
