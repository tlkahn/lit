#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../src-tauri"

TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
STAGED="binaries/lit-cli-${TRIPLE}"

# Placeholder satisfies tauri-build's externalBin check during cargo build
mkdir -p binaries
touch "$STAGED"

echo "==> Building lit-cli for $TRIPLE"
cargo build --release --bin lit-cli

cp "target/release/lit-cli" "$STAGED"

echo "==> Staged: $STAGED"
