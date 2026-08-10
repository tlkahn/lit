#!/bin/bash
# Local install - builds a free-by-default release bundle (Cargo default feature
# free-distribution) and installs it to /Applications. Matches shipping free
# builds from scripts/release.sh.
set -euo pipefail

APP_NAME="Lit.app"
INSTALL_DIR="/Applications"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."
export REPO_ROOT="${REPO_ROOT:-$(pwd)}"

source "$SCRIPT_DIR/release-lib.sh"

if [ -z "${LIT_LICENSE_VERIFYING_KEY_B64:-}" ]; then
    echo "ERROR: Release builds require LIT_LICENSE_VERIFYING_KEY_B64 env var."
    echo "  Export base64-encoded 32-byte key before running this script."
    echo "  Example: export LIT_LICENSE_VERIFYING_KEY_B64=\$(base64 < keys/dev_license_verifying.bin)"
    exit 1
fi

# Fail fast if the embedded free key is missing or still a placeholder -
# same gate as release.sh so local installs cannot ship without free-grant.
release_check_free_distribution_key

echo "==> Installing dependencies"
bun install

# Patch the version into package.json/tauri.conf.json/Cargo.toml so the built
# .app bundle's CFBundleShortVersionString matches the About dialog's
# git-derived LIT_GIT_VERSION. Use the SAME mechanism as release-lib.sh's
# release_sync_version: `git describe --tags --abbrev=0` (nearest tag, no
# -N-gSHA suffix), falling back to v0.0.0, then strip the leading `v` so
# set-version.sh receives strict semver X.Y.Z.
echo "==> Syncing version from git tag"
VERSION="$(git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0)"
bash scripts/set-version.sh "${VERSION#v}"

echo "==> Cleaning stale bundle"
rm -rf "$BUNDLE_DIR"

echo "==> Building release bundle (free-by-default)"
bun tauri build

echo "==> Installing $APP_NAME to $INSTALL_DIR"
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    rm -rf "$INSTALL_DIR/$APP_NAME"
fi
cp -R "$BUNDLE_DIR/$APP_NAME" "$INSTALL_DIR/$APP_NAME"

echo "==> Building lit-cli"
cargo build --release -p lit-cli --manifest-path ../lit-cli/Cargo.toml

echo "==> Installing 'lit' CLI to /usr/local/bin"
LIT_CLI_BIN="../lit-cli/target/release/lit-cli"
if [ -w /usr/local/bin ]; then
    cp "$LIT_CLI_BIN" /usr/local/bin/lit
    chmod 755 /usr/local/bin/lit
else
    cp "$LIT_CLI_BIN" /tmp/lit-cli
    osascript -e 'do shell script "mv /tmp/lit-cli /usr/local/bin/lit && chmod 755 /usr/local/bin/lit" with administrator privileges'
fi

echo "==> Done"
echo "   App:  $INSTALL_DIR/$APP_NAME"
echo "   CLI:  /usr/local/bin/lit"
