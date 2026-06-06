#!/usr/bin/env bash
# Patch version in package.json, tauri.conf.json, and Cargo.toml.
# Usage: bash scripts/set-version.sh 0.13.0

set -euo pipefail

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: set-version.sh <semver>" >&2
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: '$VERSION' is not valid semver (expected X.Y.Z)" >&2
  exit 1
fi

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

jq --arg v "$VERSION" '.version = $v' "$REPO_ROOT/package.json" > "$REPO_ROOT/package.json.tmp" \
  && mv "$REPO_ROOT/package.json.tmp" "$REPO_ROOT/package.json"

jq --arg v "$VERSION" '.version = $v' "$REPO_ROOT/src-tauri/tauri.conf.json" > "$REPO_ROOT/src-tauri/tauri.conf.json.tmp" \
  && mv "$REPO_ROOT/src-tauri/tauri.conf.json.tmp" "$REPO_ROOT/src-tauri/tauri.conf.json"

sed -i.bak -E '/^\[package\]/,/^\[/{s/^version = ".*"/version = "'"$VERSION"'"/;}' "$REPO_ROOT/src-tauri/Cargo.toml"
rm -f "$REPO_ROOT/src-tauri/Cargo.toml.bak"

echo "Version set to $VERSION in package.json, tauri.conf.json, Cargo.toml"
