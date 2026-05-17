#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMPT_FILE="$SCRIPT_DIR/social-post-prompt.txt"
RELEASE_NOTES_DIR="$PROJECT_ROOT/release-notes"
RELEASE_URL_BASE="https://lit.solar/releases/#v"
MASTODON_CHAR_LIMIT=500

usage() {
  cat <<EOF
Usage: $(basename "$0") [--publish] [--channel <channels>] <tag>

Generate a social media announcement from release notes and optionally post it.

By default, prints a preview (dry-run). Pass --publish to actually post.

Arguments:
  <tag>              The version tag (e.g. v0.4.0). Must have a matching
                     release-notes/v0.4.0.md file.

Flags:
  --publish          Actually post to social media (default is dry-run)
  --dry-run          Print the post without sending (this is the default)
  --channel <list>   Comma-separated channels (default: mastodon)
                     Available: mastodon
  -h, --help         Show this help

Environment variables (required for --publish with mastodon channel):
  MASTODON_INSTANCE_URL    e.g. https://mastodon.social
  MASTODON_ACCESS_TOKEN    OAuth bearer token with write:statuses scope

Examples:
  $(basename "$0") v0.4.0                    # preview the post
  $(basename "$0") --publish v0.4.0          # post to Mastodon
  $(basename "$0") --channel mastodon v0.4.0 # explicit channel
EOF
}

die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

# --- Channel adapters ---

post_mastodon() {
  local status_text="$1"

  [[ -n "${MASTODON_INSTANCE_URL:-}" ]] || die "MASTODON_INSTANCE_URL not set"
  [[ -n "${MASTODON_ACCESS_TOKEN:-}" ]] || die "MASTODON_ACCESS_TOKEN not set"

  local response
  response=$(curl -sS --fail-with-body \
    -X POST "${MASTODON_INSTANCE_URL}/api/v1/statuses" \
    -H "Authorization: Bearer ${MASTODON_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg s "$status_text" '{status: $s}')")

  local url
  url=$(echo "$response" | jq -r '.url // empty')
  if [[ -n "$url" ]]; then
    echo "✓ Posted: $url"
  else
    echo "✓ Posted (no URL in response)"
    echo "$response" | jq . 2>/dev/null || echo "$response"
  fi
}

# --- Argument parsing ---

PUBLISH=0
CHANNELS=("mastodon")
POSITIONAL=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)  PUBLISH=1; shift ;;
    --dry-run)  PUBLISH=0; shift ;;
    --channel)  IFS=',' read -ra CHANNELS <<< "$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    -*)         die "Unknown flag: $1" ;;
    *)          POSITIONAL+=("$1"); shift ;;
  esac
done

[[ ${#POSITIONAL[@]} -ge 1 ]] || { usage >&2; exit 1; }
TAG="${POSITIONAL[0]}"

# --- Preflight checks ---

command -v llm >/dev/null 2>&1 || die "'llm' not found in PATH. Install it: cargo install llm-cmd"
command -v jq >/dev/null 2>&1 || die "'jq' not found in PATH. Install it: brew install jq"

NOTES_FILE="$RELEASE_NOTES_DIR/$TAG.md"
[[ -f "$NOTES_FILE" ]] || die "Release notes not found: $NOTES_FILE"

# --- Read release notes ---

VERSION=$(sed -n 's/^version: *"\(.*\)"/\1/p' "$NOTES_FILE")
[[ -n "$VERSION" ]] || die "Could not extract version from $NOTES_FILE frontmatter"

BODY=$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' "$NOTES_FILE" | sed '/./,$!d')
[[ -n "$BODY" ]] || die "Release notes body is empty in $NOTES_FILE"

# --- Generate social post via LLM ---

POST_BODY=$(echo "$BODY" | llm -s "$(cat "$PROMPT_FILE")")
[[ -n "$POST_BODY" ]] || die "LLM returned empty output"

RELEASE_URL="${RELEASE_URL_BASE}${VERSION}"
POST="${POST_BODY}

${RELEASE_URL}"

# --- Enforce character limit ---

if [[ ${#POST} -gt $MASTODON_CHAR_LIMIT ]]; then
  echo "Warning: Post is ${#POST} chars (limit $MASTODON_CHAR_LIMIT). Truncating." >&2
  MAX_BODY_LEN=$(( MASTODON_CHAR_LIMIT - ${#RELEASE_URL} - 2 - 3 ))
  TRUNCATED="${POST_BODY:0:$MAX_BODY_LEN}"
  TRUNCATED="${TRUNCATED% *}..."
  POST="${TRUNCATED}

${RELEASE_URL}"
fi

# --- Dispatch ---

if [[ $PUBLISH -eq 0 ]]; then
  echo "=== Social media post preview ==="
  echo ""
  echo "$POST"
  echo ""
  echo "=== Metadata ==="
  echo "  Characters: ${#POST} / $MASTODON_CHAR_LIMIT"
  echo "  Channels:   ${CHANNELS[*]}"
  echo "  Tag:        $TAG"
  echo ""
  echo "Run with --publish to post."
  exit 0
fi

for channel in "${CHANNELS[@]}"; do
  case "$channel" in
    mastodon) post_mastodon "$POST" ;;
    *) die "Unknown channel: $channel" ;;
  esac
done
