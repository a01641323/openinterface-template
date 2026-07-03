import config from '../../../template.config.json';

const base = String(config.vercelUrl).replace(/\/+$/, '');

export async function GET() {
  // Bash script: TS interpolates ${...}; bash-side expansions use \${...} or "$VAR".
  const script = `#!/bin/bash
# ${config.brandName} installer — curl -fsSL ${base}/install.sh | bash
set -euo pipefail

BASE="\${INSTALL_BASE:-${base}}"
CMD="${config.commandName}"
DEST="$HOME/.$CMD"
BIN_DIR="\${INSTALL_BIN_DIR:-$HOME/.local/bin}"

command -v node >/dev/null 2>&1 || { echo "error: node is required (https://nodejs.org)"; exit 1; }
command -v tar  >/dev/null 2>&1 || { echo "error: tar is required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$BASE/api/bundle" -o "$TMP/bundle.tar.gz"
mkdir -p "$DEST"
tar -xzf "$TMP/bundle.tar.gz" -C "$DEST"

# Per-install random key sealing the local session state (clock-tamper defense).
# Created once; survives updates.
KEY_FILE="$DEST/install-key"
if [ ! -f "$KEY_FILE" ]; then
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' > "$KEY_FILE"
  echo >> "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

mkdir -p "$BIN_DIR"
printf '#!/bin/sh\\nexec node "%s/cli/index.mjs" "$@"\\n' "$DEST" > "$BIN_DIR/$CMD"
chmod +x "$BIN_DIR/$CMD"

case ":$PATH:" in
  *":$BIN_DIR:"*) HINT="" ;;
  *) HINT=" — add it to your PATH first: export PATH=\\"$BIN_DIR:\\$PATH\\"" ;;
esac
echo "Installed ${config.brandName} to $DEST — run '$CMD' to start$HINT"
`;
  return new Response(script, {
    headers: { 'Content-Type': 'text/x-shellscript; charset=utf-8' },
  });
}
