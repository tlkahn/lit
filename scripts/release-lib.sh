#!/usr/bin/env bash
# Testable function library for release.sh — sourced, no side effects at load time.

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

release_parse_args() {
  TAG=""
  DRY_RUN=0
  SKIP_WEBSITE=0

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)   DRY_RUN=1; shift ;;
      --skip-website) SKIP_WEBSITE=1; shift ;;
      --*)
        echo "Error: unknown flag $1" >&2
        return 1
        ;;
      *)
        TAG="$1"; shift ;;
    esac
  done

  if [[ -z "$TAG" ]]; then
    echo "Error: tag argument required (e.g. v0.9.2)" >&2
    return 1
  fi
}

release_validate_tag() {
  local tag="$1"
  if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: tag '$tag' does not match expected format vX.Y.Z" >&2
    return 1
  fi
  if ! git rev-parse "$tag" >/dev/null 2>&1; then
    echo "Error: tag '$tag' not found in git" >&2
    return 1
  fi
}

release_check_tools() {
  local required=(bun cargo codesign aws hugo gh jq)
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

release_check_env() {
  local dry_run="${1:-0}"
  local skip_website="${2:-0}"
  local missing=()

  for var in LIT_TRIAL_SIGNING_KEY_B64 LIT_LICENSE_VERIFYING_KEY_B64; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("$var")
    fi
  done

  if [[ "$dry_run" -eq 0 ]]; then
    for var in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
      if [[ -z "${!var:-}" ]]; then
        missing+=("$var")
      fi
    done
    if [[ "$skip_website" -eq 0 && -z "${OPENAI_API_KEY:-}" ]]; then
      missing+=("OPENAI_API_KEY")
    fi
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "Error: missing required environment variables: ${missing[*]}" >&2
    return 1
  fi
}

release_detect_signing_id() {
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
    return 0
  fi

  local identities
  identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  local matches
  matches="$(echo "$identities" | grep '"Developer ID Application' || true)"
  local count
  count="$(echo "$matches" | grep -c 'Developer ID Application' || true)"

  if [[ "$count" -eq 0 ]]; then
    echo "Error: No Developer ID Application identity found in keychain" >&2
    return 1
  elif [[ "$count" -gt 1 ]]; then
    echo "Error: Multiple Developer ID Application identities found:" >&2
    echo "$matches" >&2
    echo "Set APPLE_SIGNING_IDENTITY to choose one." >&2
    return 1
  fi

  APPLE_SIGNING_IDENTITY="$(echo "$matches" | sed -n 's/.*"\(Developer ID Application[^"]*\)".*/\1/p')"
  export APPLE_SIGNING_IDENTITY
  echo "Auto-detected signing identity: $APPLE_SIGNING_IDENTITY"
}

release_get_s3_bucket() {
  local raw
  raw="$(aws cloudformation describe-stacks \
    --region us-east-1 \
    --stack-name lit-production \
    --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" \
    --output text)" || {
    echo "Error: failed to query S3 bucket from CloudFormation" >&2
    return 1
  }
  S3_BUCKET="$(echo "$raw" | tr -d '"' | tr -d "'")"
  export S3_BUCKET
}

release_install_deps() {
  echo "── Installing dependencies..."
  bun install --frozen-lockfile
}

release_fetch_pdfium() {
  echo "── Fetching pdfium..."
  bash "$REPO_ROOT/scripts/fetch-pdfium.sh"
}

release_prebuild_cli() {
  echo "── Pre-building lit-cli..."
  (
    cd "$REPO_ROOT/src-tauri"
    touch binaries/lit-cli-aarch64-apple-darwin
    cargo build --release --bin lit-cli --target aarch64-apple-darwin
    cp target/aarch64-apple-darwin/release/lit-cli binaries/lit-cli-aarch64-apple-darwin
  )
}

release_codesign_pdfium() {
  echo "── Codesigning libpdfium..."
  codesign --sign "$APPLE_SIGNING_IDENTITY" \
    --timestamp --force --options runtime \
    "$REPO_ROOT/src-tauri/libs/libpdfium.dylib"
}

release_tauri_build() {
  echo "── Building Tauri app..."
  bun tauri build --target aarch64-apple-darwin \
    --config '{"build":{"beforeBuildCommand":"bun run build"}}'
}

release_copy_dmg() {
  local tag="$1"
  echo "── Copying DMG..."
  local dmg
  dmg="$(find "$REPO_ROOT/src-tauri/target/aarch64-apple-darwin" -name '*.dmg' -type f 2>/dev/null | head -1)"
  if [[ -z "$dmg" ]]; then
    echo "Error: No DMG found in src-tauri/target/aarch64-apple-darwin/" >&2
    return 1
  fi
  cp "$dmg" "$REPO_ROOT/Lit_${tag}_aarch64.dmg"
  echo "DMG: $REPO_ROOT/Lit_${tag}_aarch64.dmg"
}

release_upload_dmg() {
  local tag="$1"
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    echo "── [DRY RUN] Would upload Lit_${tag}_aarch64.dmg to S3"
    return 0
  fi
  echo "── Uploading DMG to S3..."
  aws s3 cp "$REPO_ROOT/Lit_${tag}_aarch64.dmg" "s3://${S3_BUCKET}/releases/Lit_${tag}_aarch64.dmg"
}

release_deploy_website() {
  local tag="$1"
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    echo "── [DRY RUN] Skipping website deploy"
    return 0
  fi
  if [[ "${SKIP_WEBSITE:-0}" -eq 1 ]]; then
    echo "── Skipping website deploy (--skip-website)"
    return 0
  fi
  echo "── Deploying website..."
  bash "$REPO_ROOT/scripts/deploy-website.sh" "$tag"
}
