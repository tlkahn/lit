#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_FILE="$SCRIPT_DIR/release-notes-prompt.txt"
OUTPUT_DIR="$PROJECT_ROOT/release-notes"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--force] [--dry-run] <tag> [from-tag]

Generate user-facing release notes from git history using an LLM.

Arguments:
  <tag>        The release tag to document (e.g. v0.4.0)
  [from-tag]   Start of the range (default: previous tag)

Flags:
  --force      Overwrite existing notes file
  --dry-run    Print to stdout instead of writing a file
  -h, --help   Show this help
EOF
}

die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

FORCE=0
DRY_RUN=0
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)   FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)        die "Unknown flag: $1" ;;
    *)         POSITIONAL+=("$1"); shift ;;
  esac
done

[[ ${#POSITIONAL[@]} -ge 1 ]] || { usage >&2; exit 1; }
TAG="${POSITIONAL[0]}"
FROM_TAG="${POSITIONAL[1]:-}"

# --- Preflight checks ---

command -v llm >/dev/null 2>&1 || die "'llm' not found in PATH. Install it: pip install llm (https://llm.datasette.io)"

git rev-parse "$TAG" >/dev/null 2>&1 || die "Tag '$TAG' does not exist in this repository."

# Strip leading 'v' for the version string
VERSION="${TAG#v}"

OUTPUT_FILE="$OUTPUT_DIR/$TAG.md"
if [[ $DRY_RUN -eq 0 && $FORCE -eq 0 && -f "$OUTPUT_FILE" ]]; then
  die "$OUTPUT_FILE already exists. Use --force to overwrite."
fi

# --- Determine range start ---

if [[ -z "$FROM_TAG" ]]; then
  FROM_TAG=$(git tag --sort=-v:creatordate | grep -A1 "^${TAG}$" | tail -1) || true
  if [[ "$FROM_TAG" == "$TAG" || -z "$FROM_TAG" ]]; then
    # First release or no previous tag — use root commit
    FROM_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
  fi
fi

# --- Collect commits ---

COMMITS=$(git log --oneline --no-merges "$FROM_TAG..$TAG")
if [[ -z "$COMMITS" ]]; then
  die "No commits found in range $FROM_TAG..$TAG"
fi

# --- Generate notes via LLM ---

NOTES=$(echo "$COMMITS" | llm -s "$(cat "$PROMPT_FILE")")

# --- Get tag date ---

TAG_DATE=$(git log -1 --format='%ai' "$TAG" | cut -d' ' -f1)

# --- Assemble output ---

OUTPUT=$(cat <<EOF
---
version: "$VERSION"
tag: "$TAG"
date: "$TAG_DATE"
---

$NOTES
EOF
)

if [[ $DRY_RUN -eq 1 ]]; then
  echo "$OUTPUT"
else
  mkdir -p "$OUTPUT_DIR"
  echo "$OUTPUT" > "$OUTPUT_FILE"
  echo "✓ Generated $OUTPUT_FILE"
  echo "  Review and edit before committing."
fi
