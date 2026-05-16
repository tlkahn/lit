#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

TRIPLE=$(rustc -vV | awk '/^host:/ { print $2 }')
STAGED="src-tauri/binaries/llm-${TRIPLE}"

mkdir -p src-tauri/binaries
touch "$STAGED"

echo "==> Building llm for $TRIPLE (from llm-rs submodule)"
(cd llm-rs && cargo build --release -p llm-cli)

cp "llm-rs/target/release/llm" "$STAGED"

echo "==> Staged: $STAGED"
