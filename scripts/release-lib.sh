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

release_checkout_tag() {
  local tag="$1"
  RELEASE_ORIGINAL_REF="$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse HEAD)"
  export RELEASE_ORIGINAL_REF
  echo "── Checking out tag $tag (was on $RELEASE_ORIGINAL_REF)..."
  git checkout "$tag" --detach
  trap 'echo "── Restoring $RELEASE_ORIGINAL_REF..."; git checkout "$RELEASE_ORIGINAL_REF" -- && bash "$REPO_ROOT/scripts/set-version.sh" 0.0.0 >/dev/null 2>&1 || true' EXIT
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

  for var in LIT_LICENSE_VERIFYING_KEY_B64 TAURI_SIGNING_PRIVATE_KEY; do
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
    if [[ "$skip_website" -eq 0 && -z "${ANTHROPIC_API_KEY:-}" ]]; then
      missing+=("ANTHROPIC_API_KEY")
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

release_sync_version() {
  local tag="$1"
  local version="${tag#v}"
  echo "── Syncing version $version from tag $tag..."
  bash "$REPO_ROOT/scripts/set-version.sh" "$version"
}

release_install_deps() {
  echo "── Installing dependencies..."
  bun install --frozen-lockfile
}

release_fetch_pdfium() {
  echo "── Fetching pdfium..."
  bash "$REPO_ROOT/scripts/fetch-pdfium.sh"
}

release_codesign_pdfium() {
  echo "── Codesigning libpdfium..."
  codesign --sign "$APPLE_SIGNING_IDENTITY" \
    --timestamp --force --options runtime \
    "$REPO_ROOT/src-tauri/libs/libpdfium.dylib"
}

release_tauri_build() {
  echo "── Cleaning stale DMGs..."
  find "$REPO_ROOT/src-tauri/target/aarch64-apple-darwin" -name '*.dmg' -type f -delete 2>/dev/null || true
  echo "── Building Tauri app..."
  bun tauri build --target aarch64-apple-darwin \
    --config '{"build":{"beforeBuildCommand":"bun run build"}}'
}

release_copy_dmg() {
  local tag="$1"
  echo "── Copying DMG..."
  local dmg_dir="$REPO_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
  local dmg
  dmg="$(find "$dmg_dir" -name '*.dmg' -type f 2>/dev/null | head -1)"
  if [[ -z "$dmg" ]]; then
    echo "Error: No DMG found in $dmg_dir" >&2
    return 1
  fi
  cp "$dmg" "$REPO_ROOT/Lit_${tag}_aarch64.dmg"
  echo "DMG: $REPO_ROOT/Lit_${tag}_aarch64.dmg"
}

release_generate_update_manifest() {
  local tag="$1"
  echo "── Generating update manifest (latest.json)..."
  local macos_dir="$REPO_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  local sig_file
  sig_file="$(find "$macos_dir" -name '*.app.tar.gz.sig' -type f 2>/dev/null | head -1)"
  if [[ -z "$sig_file" ]]; then
    echo "Error: No .app.tar.gz.sig found in $macos_dir (is bundle.createUpdaterArtifacts enabled and TAURI_SIGNING_PRIVATE_KEY set?)" >&2
    return 1
  fi
  local tarball="${sig_file%.sig}"
  if [[ ! -f "$tarball" ]]; then
    echo "Error: No .app.tar.gz found next to signature ($tarball)" >&2
    return 1
  fi
  # Share the resolved tarball with release_upload_update_artifacts so both
  # operate on the same build artifact (the one whose signature is in latest.json).
  RELEASE_UPDATE_TARBALL="$tarball"
  export RELEASE_UPDATE_TARBALL
  local signature version pub_date notes url
  signature="$(cat "$sig_file")"
  version="${tag#v}"
  pub_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  notes="See the assets here for the version ${tag} release."
  url="https://lit.solar/releases/Lit_${tag}_aarch64.app.tar.gz"
  jq -n \
    --arg version "$version" \
    --arg notes "$notes" \
    --arg pub_date "$pub_date" \
    --arg signature "$signature" \
    --arg url "$url" \
    '{version: $version, notes: $notes, pub_date: $pub_date, platforms: {"darwin-aarch64": {signature: $signature, url: $url}}}' \
    > "$REPO_ROOT/latest.json"
  echo "Manifest: $REPO_ROOT/latest.json"
}

release_upload_update_artifacts() {
  local tag="$1"
  local macos_dir="$REPO_ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  # Prefer the tarball resolved by release_generate_update_manifest so the uploaded
  # artifact matches the signature written into latest.json. Fall back to an
  # independent find so this function remains runnable standalone.
  local tarball="${RELEASE_UPDATE_TARBALL:-}"
  if [[ -z "$tarball" ]]; then
    tarball="$(find "$macos_dir" -name '*.app.tar.gz' -type f 2>/dev/null | head -1)"
  fi
  if [[ -z "$tarball" ]]; then
    echo "Error: No .app.tar.gz found in $macos_dir" >&2
    return 1
  fi
  if [[ ! -f "$tarball" ]]; then
    echo "Error: update tarball not found ($tarball)" >&2
    return 1
  fi
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    echo "── [DRY RUN] Would upload Lit_${tag}_aarch64.app.tar.gz and latest.json to S3"
    return 0
  fi
  echo "── Uploading update artifacts to S3..."
  aws s3 cp "$tarball" "s3://${S3_BUCKET}/releases/Lit_${tag}_aarch64.app.tar.gz"
  aws s3 cp "$REPO_ROOT/latest.json" "s3://${S3_BUCKET}/releases/latest.json" --cache-control "max-age=300"
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

release_compute_checksums() {
  local tag="$1"
  local dmg="$REPO_ROOT/Lit_${tag}_aarch64.dmg"
  if [[ ! -f "$dmg" ]]; then
    echo "Error: DMG not found at $dmg" >&2
    return 1
  fi
  echo "── Computing SHA-256 checksums..."
  RELEASE_DMG_SHA256="$(shasum -a 256 "$dmg" | awk '{print $1}')"
  export RELEASE_DMG_SHA256
  printf '%s  Lit_%s_aarch64.dmg\n' "$RELEASE_DMG_SHA256" "$tag" > "$dmg.sha256"
  echo "DMG SHA-256: $RELEASE_DMG_SHA256"

  if [[ -n "${RELEASE_UPDATE_TARBALL:-}" && -f "$RELEASE_UPDATE_TARBALL" ]]; then
    RELEASE_TARBALL_SHA256="$(shasum -a 256 "$RELEASE_UPDATE_TARBALL" | awk '{print $1}')"
    export RELEASE_TARBALL_SHA256
    local tarball_basename
    tarball_basename="$(basename "$RELEASE_UPDATE_TARBALL")"
    printf '%s  %s\n' "$RELEASE_TARBALL_SHA256" "$tarball_basename" > "${RELEASE_UPDATE_TARBALL}.sha256"
    echo "Tarball SHA-256: $RELEASE_TARBALL_SHA256"
  fi
}

release_upload_checksums() {
  local tag="$1"
  if [[ "${DRY_RUN:-0}" -eq 1 ]]; then
    echo "── [DRY RUN] Would upload .sha256 checksum files to S3"
    return 0
  fi
  echo "── Uploading checksums to S3..."
  aws s3 cp "$REPO_ROOT/Lit_${tag}_aarch64.dmg.sha256" "s3://${S3_BUCKET}/releases/Lit_${tag}_aarch64.dmg.sha256"
  if [[ -n "${RELEASE_UPDATE_TARBALL:-}" && -f "${RELEASE_UPDATE_TARBALL}.sha256" ]]; then
    aws s3 cp "${RELEASE_UPDATE_TARBALL}.sha256" "s3://${S3_BUCKET}/releases/$(basename "${RELEASE_UPDATE_TARBALL}").sha256"
  fi
}

release_inject_checksum() {
  local index_file="$1"
  local toml_file="$2"
  if [[ -z "${RELEASE_DMG_SHA256:-}" ]]; then
    return 0
  fi
  echo "==> Injecting DMG checksum"
  sed "s|^download_sha256:.*|download_sha256: \"$RELEASE_DMG_SHA256\"|" "$index_file" > "$index_file.tmp" && mv "$index_file.tmp" "$index_file"
  if ! grep -q "download_sha256: \"$RELEASE_DMG_SHA256\"" "$index_file"; then
    echo "Warning: download_sha256 placeholder not found in $index_file — checksum not injected" >&2
  fi
  sed "s|^  downloadSHA256 = .*|  downloadSHA256 = '$RELEASE_DMG_SHA256'|" "$toml_file" > "$toml_file.tmp" && mv "$toml_file.tmp" "$toml_file"
  if ! grep -q "downloadSHA256 = '$RELEASE_DMG_SHA256'" "$toml_file"; then
    echo "Warning: downloadSHA256 placeholder not found in $toml_file — checksum not injected" >&2
  fi
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

release_clean_artifacts() {
  local tag="$1"
  echo "── Cleaning build artifacts from repo root..."
  rm -f "$REPO_ROOT/Lit_"*"_aarch64.dmg"
  rm -f "$REPO_ROOT/Lit_"*"_aarch64.dmg.sha256"
  rm -f "$REPO_ROOT/latest.json"
}
