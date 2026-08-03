#!/usr/bin/env bash
# Testable function library for publish-cards.sh - sourced, no side effects at load time.

set -euo pipefail

SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
source "$SCRIPT_DIR/release-lib.sh"

PC_PREFIX="z"
PC_DOMAIN="lit.solar"
AWS_REGION="${AWS_REGION:-us-east-1}"

pc_parse_args() {
  PC_MODE=""
  PC_HTML_FILE=""
  PC_SLUG=""
  PC_FORCE=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        PC_FORCE=1; shift ;;
      --delete)
        PC_MODE="delete"
        shift
        if [[ $# -eq 0 ]]; then
          echo "Error: --delete requires a slug argument" >&2
          return 1
        fi
        PC_SLUG="$1"; shift ;;
      --*)
        echo "Error: unknown flag $1" >&2
        echo "Usage: publish-cards.sh [--force] <html_file> [slug]" >&2
        echo "       publish-cards.sh --delete <slug>" >&2
        return 1
        ;;
      *)
        if [[ -z "$PC_MODE" ]]; then
          PC_MODE="publish"
        fi
        if [[ -z "$PC_HTML_FILE" ]]; then
          PC_HTML_FILE="$1"
        elif [[ -z "$PC_SLUG" ]]; then
          PC_SLUG="$1"
        fi
        shift
        ;;
    esac
  done

  if [[ -z "$PC_MODE" ]]; then
    echo "Error: missing arguments" >&2
    echo "Usage: publish-cards.sh [--force] <html_file> [slug]" >&2
    echo "       publish-cards.sh --delete <slug>" >&2
    return 1
  fi

  if [[ "$PC_MODE" == "publish" && -z "$PC_HTML_FILE" ]]; then
    echo "Error: missing HTML file argument" >&2
    return 1
  fi
}

pc_check_tools() {
  local required=(aws curl)
  local missing=()
  for tool in "${required[@]}"; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: missing required tools: ${missing[*]}" >&2
    return 1
  fi
}

pc_validate_html_file() {
  if [[ ! -f "$PC_HTML_FILE" ]]; then
    echo "Error: file not found: $PC_HTML_FILE" >&2
    return 1
  fi
  if [[ ! -s "$PC_HTML_FILE" ]]; then
    echo "Error: file is empty: $PC_HTML_FILE" >&2
    return 1
  fi
}

pc_slugify() {
  local input="$1"
  local slug

  slug="${input%.html}"
  slug="$(echo "$slug" | tr '[:upper:]' '[:lower:]')"
  slug="$(echo "$slug" | tr ' _' '--')"
  slug="$(echo "$slug" | tr -cd 'a-z0-9-')"
  slug="$(echo "$slug" | sed 's/--*/-/g')"
  slug="$(echo "$slug" | sed 's/^-//; s/-$//')"

  if [[ -z "$slug" ]]; then
    echo "Error: slugified name is empty (from '$input')" >&2
    return 1
  fi
  echo "$slug"
}

pc_validate_slug() {
  local slug="$1"
  local canonical
  canonical="$(pc_slugify "$slug")" || return 1
  if [[ "$slug" != "$canonical" ]]; then
    echo "Error: slug '$slug' is not in canonical form (expected '$canonical')" >&2
    return 1
  fi
}

pc_check_existing() {
  local slug="$1"
  local result
  if result="$(aws s3api head-object --bucket "$S3_BUCKET" --key "${PC_PREFIX}/${slug}/index.html" 2>&1)"; then
    if [[ "${PC_FORCE:-0}" -eq 1 ]]; then
      return 0
    fi
    local last_modified
    last_modified="$(echo "$result" | grep -i 'LastModified' | head -1 || echo "(unknown)")"
    echo "Error: ${PC_PREFIX}/${slug}/index.html already exists (${last_modified})" >&2
    echo "Re-run with --force to overwrite." >&2
    return 1
  fi
  return 0
}

pc_upload() {
  local slug="$1"
  aws s3 cp "$PC_HTML_FILE" "s3://${S3_BUCKET}/${PC_PREFIX}/${slug}/index.html" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "max-age=300"
}

pc_get_distribution_id() {
  PC_DIST_ID="$(aws cloudfront list-distributions \
    --region "$AWS_REGION" \
    --query "DistributionList.Items[?Aliases.Items[0]=='${PC_DOMAIN}'].Id" \
    --output text)"
  if [[ -z "$PC_DIST_ID" || "$PC_DIST_ID" == "None" ]]; then
    echo "Error: could not find CloudFront distribution for ${PC_DOMAIN}" >&2
    return 1
  fi
  export PC_DIST_ID
}

pc_invalidate() {
  local slug="$1"
  aws cloudfront create-invalidation \
    --distribution-id "$PC_DIST_ID" \
    --paths "/${PC_PREFIX}/${slug}/*" > /dev/null
}

pc_verify() {
  local slug="$1"
  sleep 3
  local url="https://${PC_DOMAIN}/${PC_PREFIX}/${slug}/"
  local status
  status="$(curl -s -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$status" == "200" ]]; then
    echo "    $url => $status OK"
  else
    echo "    $url => $status (may need a few seconds for invalidation to propagate)"
  fi
}

pc_delete() {
  local slug="$1"
  local objects
  objects="$(aws s3 ls "s3://${S3_BUCKET}/${PC_PREFIX}/${slug}/" 2>&1 || true)"
  if [[ -z "$objects" ]]; then
    echo "Error: no objects found under ${PC_PREFIX}/${slug}/ - check the slug" >&2
    return 1
  fi
  aws s3 rm "s3://${S3_BUCKET}/${PC_PREFIX}/${slug}/" --recursive
  pc_get_distribution_id
  pc_invalidate "$slug"
}
