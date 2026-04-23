#!/bin/bash
set -euo pipefail

APP_NAME="Lit.app"
INSTALL_DIR="/Applications"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"

cd "$(dirname "$0")/.."

echo "==> Installing dependencies"
bun install

echo "==> Cleaning stale bundle"
rm -rf "$BUNDLE_DIR"

echo "==> Building release bundle"
bun tauri build

echo "==> Installing $APP_NAME to $INSTALL_DIR"
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    rm -rf "$INSTALL_DIR/$APP_NAME"
fi
cp -R "$BUNDLE_DIR/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

echo "==> Installing 'lit' CLI to /usr/local/bin"
cat > /tmp/lit-cli <<'SCRIPT'
#!/bin/bash
"/Applications/Lit.app/Contents/MacOS/Lit" "$@" &>/dev/null &
disown
SCRIPT

if [ -w /usr/local/bin ]; then
    mv /tmp/lit-cli /usr/local/bin/lit
    chmod 755 /usr/local/bin/lit
else
    osascript -e 'do shell script "mv /tmp/lit-cli /usr/local/bin/lit && chmod 755 /usr/local/bin/lit" with administrator privileges'
fi

echo "==> Done"
echo "   App:  $INSTALL_DIR/$APP_NAME"
echo "   CLI:  /usr/local/bin/lit"
