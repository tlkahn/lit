#!/usr/bin/env bash
# Patch version in package.json, tauri.conf.json, Cargo.toml, and Cargo.lock.
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

# Keep Cargo.lock in sync so `cargo build --locked` / `cargo check --locked`
# don't fail on a lockfile mismatch. Let cargo re-resolve the lockfile entry
# for the `lit` package after patching Cargo.toml — this is format-agnostic
# and survives any future Cargo.lock layout changes.
if [[ -f "$REPO_ROOT/src-tauri/Cargo.lock" ]]; then
  (cd "$REPO_ROOT/src-tauri" && cargo update -p lit 2>/dev/null) || true
fi

echo "Version set to $VERSION in package.json, tauri.conf.json, Cargo.toml, Cargo.lock"
