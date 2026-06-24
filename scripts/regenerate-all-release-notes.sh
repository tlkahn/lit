#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SKIP_TAGS="v0.0.0-test.1 v0.0.1 v0.1.0 v0.2.0"

TAGS=$(git tag --sort=creatordate | grep '^v')

for TAG in $TAGS; do
  if echo "$SKIP_TAGS" | grep -qw "$TAG"; then
    echo "⏭  Skipping $TAG (pre-conventional-commit era)"
    continue
  fi

  echo "── Generating notes for $TAG..."
  bash "$SCRIPT_DIR/generate-release-notes.sh" --force "$TAG" || {
    echo "⚠  Failed for $TAG, continuing..."
    continue
  }
  sleep 2
done

echo ""
echo "✓ Done. Review the generated files in release-notes/."
