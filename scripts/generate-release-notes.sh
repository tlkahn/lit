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

command -v llm >/dev/null 2>&1 || die "'llm' not found in PATH. Install it: cargo install llm-cmd"

git rev-parse "$TAG" >/dev/null 2>&1 || die "Tag '$TAG' does not exist in this repository."

# Strip leading 'v' for the version string
VERSION="${TAG#v}"

OUTPUT_FILE="$OUTPUT_DIR/$TAG.md"
if [[ $DRY_RUN -eq 0 && $FORCE -eq 0 && -f "$OUTPUT_FILE" ]]; then
  die "$OUTPUT_FILE already exists. Use --force to overwrite."
fi

# --- Determine range start ---

if [[ -z "$FROM_TAG" ]]; then
  FROM_TAG=$(git tag --sort=-creatordate | grep -A1 "^${TAG}$" | tail -1) || true
  if [[ "$FROM_TAG" == "$TAG" || -z "$FROM_TAG" ]]; then
    # First release or no previous tag — use root commit
    FROM_TAG=$(git rev-list --max-parents=0 HEAD | head -1)
  fi
fi

# --- Collect commits ---

ALL_COMMITS=$(git log --oneline --no-merges "$FROM_TAG..$TAG")
if [[ -z "$ALL_COMMITS" ]]; then
  die "No commits found in range $FROM_TAG..$TAG"
fi

# --- Filter to feat/fix commits ---

COMMITS=$(echo "$ALL_COMMITS" | grep -E '^[0-9a-f]+ (feat|fix)[:(]' || true)
HAS_FEAT=$(echo "$COMMITS" | grep -E '^[0-9a-f]+ feat[:(]' || true)

if [[ -z "$COMMITS" ]]; then
  NOTES="Internal improvements and maintenance."
elif [[ -z "$HAS_FEAT" ]]; then
  NOTES="Bug fixes and internal improvements."
else
  # --- Generate notes via LLM ---
  MODEL="${LLM_MODEL:-claude-sonnet-4-6}"
  NOTES=$(echo "$COMMITS" | llm -m "$MODEL" -s "$(cat "$PROMPT_FILE")")
fi

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
