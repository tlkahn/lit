#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
STAGED="src-tauri/binaries/llm-${TRIPLE}"

mkdir -p src-tauri/binaries
touch "$STAGED"

echo "==> Installing llm for $TRIPLE (from crates.io)"
cargo install llm-cmd --root ./llm-install

cp "./llm-install/bin/llm" "$STAGED"

echo "==> Staged: $STAGED"
