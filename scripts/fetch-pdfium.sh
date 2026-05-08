#!/usr/bin/env bash
set -euo pipefail

DEST="$(dirname "$0")/../src-tauri/libs"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
DYLIB="$DEST/libpdfium.dylib"

if [ -f "$DYLIB" ]; then
  echo "libpdfium.dylib already exists at $DYLIB — skipping download."
  exit 0
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) PLATFORM="mac-arm64" ;;
  x86_64) PLATFORM="mac-x64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

VERSION="7811"
URL="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/${VERSION}/pdfium-${PLATFORM}.tgz"

echo "Downloading pdfium for $PLATFORM (chromium/$VERSION)..."
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

curl -fsSL "$URL" -o "$TMPDIR/pdfium.tgz"
tar xzf "$TMPDIR/pdfium.tgz" -C "$TMPDIR"

cp "$TMPDIR/lib/libpdfium.dylib" "$DYLIB"
echo "Installed libpdfium.dylib to $DYLIB"
