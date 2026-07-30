#!/usr/bin/env bash
# m-control installation script for Linux/macOS.
# Mirrors scripts/install.ps1:
#   1. Build the monorepo
#   2. Copy the single-file ncc bundle to ~/.m-control/mctl.js
#   3. Create `mctl` and `mm` wrappers in ~/.local/bin
#   4. Initialize ~/.m-control/config.json with this repo's tools/ registered
#
# Usage: ./scripts/install.sh   (from anywhere; resolves the repo from itself)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALL_PATH="${M_CONTROL_INSTALL_PATH:-$HOME/.m-control}"
BIN_DIR="${M_CONTROL_BIN_DIR:-$HOME/.local/bin}"

echo "=== m-control Installer ==="
echo "Repo root: $REPO_ROOT"
echo ""

command -v node >/dev/null 2>&1 || { echo "FAIL Node.js not found. Install Node.js 18+ first."; exit 1; }
echo "OK Node.js detected: $(node --version)"
command -v yarn >/dev/null 2>&1 || { echo "FAIL yarn not found. Install via: npm install -g yarn"; exit 1; }
echo "OK yarn detected: $(yarn --version)"

echo ""
echo "Installing dependencies..."
(cd "$REPO_ROOT" && yarn install)
echo "OK Dependencies installed"

echo ""
echo "Building project..."
(cd "$REPO_ROOT" && yarn build)
echo "OK Build successful"

MCTL_BUNDLE="$REPO_ROOT/apps/mctl/dist/bundle/index.js"
[ -f "$MCTL_BUNDLE" ] || { echo "FAIL Bundle not found: $MCTL_BUNDLE"; exit 1; }

echo ""
echo "Installing to: $INSTALL_PATH"
mkdir -p "$INSTALL_PATH"
cp "$MCTL_BUNDLE" "$INSTALL_PATH/mctl.js"
cp "$REPO_ROOT/config/config.template.json" "$INSTALL_PATH/config.template.json"
echo "OK Files copied"

mkdir -p "$BIN_DIR"
for cmd in mctl mm; do
  cat > "$BIN_DIR/$cmd" <<WRAPPER
#!/usr/bin/env bash
exec node "$INSTALL_PATH/mctl.js" "\$@"
WRAPPER
  chmod +x "$BIN_DIR/$cmd"
done
echo "OK Command wrappers created: $BIN_DIR/mctl, $BIN_DIR/mm"

case ":$PATH:" in
  *":$BIN_DIR:"*) echo "OK $BIN_DIR already in PATH" ;;
  *)
    echo "IMPORTANT: $BIN_DIR is not in PATH. Add this to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
echo "Initializing configuration..."
CONFIG_PATH="$INSTALL_PATH/config.json"
REPO_TOOLS_ROOT="$REPO_ROOT/tools"

if [ ! -f "$CONFIG_PATH" ]; then
  # Run init via the bundle INSIDE the repo — it detects the checkout and
  # pre-fills paths.toolsRoots with the repo tools/ directory.
  node "$MCTL_BUNDLE" init
  echo "OK Config initialized at: $CONFIG_PATH"
else
  echo "OK Config already exists"
  # Ensure the installed mctl can find this repo's tools: a globally
  # installed bundle has no repo-relative fallback, it relies on
  # paths.toolsRoots in the config.
  MCTL_CONFIG_PATH="$CONFIG_PATH" MCTL_TOOLS_ROOT="$REPO_TOOLS_ROOT" node <<'NODE'
const fs = require('fs');
const configPath = process.env.MCTL_CONFIG_PATH;
const toolsRoot = process.env.MCTL_TOOLS_ROOT;
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
config.paths = config.paths ?? {};
config.paths.toolsRoots = config.paths.toolsRoots ?? [];
if (!config.paths.toolsRoots.includes(toolsRoot)) {
  config.paths.toolsRoots.push(toolsRoot);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`OK Registered tools root in config: ${toolsRoot}`);
} else {
  console.log(`OK Tools root already registered: ${toolsRoot}`);
}
NODE
fi

echo ""
echo "=== Installation Complete! ==="
echo ""
echo "Next steps:"
echo "  1. Run 'mctl doctor' to verify the setup"
echo "  2. Fill in credentials in: $CONFIG_PATH"
echo ""
