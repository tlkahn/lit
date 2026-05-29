#!/usr/bin/env bash
# Local release script — replicates the CI build-release + update-website pipeline.
# Usage: bash scripts/release.sh [--dry-run] [--skip-website] <tag>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export REPO_ROOT="${REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"

source "$SCRIPT_DIR/release-lib.sh"

release_parse_args "$@"

echo "════════════════════════════════════════════════════════"
echo "  Lit Release — $TAG"
[[ "$DRY_RUN" -eq 1 ]] && echo "  Mode: DRY RUN (build only, no upload/deploy)"
[[ "$SKIP_WEBSITE" -eq 1 ]] && echo "  Mode: skip website deploy"
echo "════════════════════════════════════════════════════════"

release_validate_tag "$TAG"
release_check_tools
release_check_env "$DRY_RUN"
release_detect_signing_id

if [[ "$DRY_RUN" -eq 0 ]]; then
  release_get_s3_bucket
fi

release_install_deps
release_fetch_pdfium
release_prebuild_cli
release_codesign_pdfium
release_tauri_build
release_copy_dmg "$TAG"
release_upload_dmg "$TAG"
release_deploy_website "$TAG"

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Release $TAG complete!"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "  DRY RUN — no artifacts were uploaded or deployed."
  echo "  DMG: $REPO_ROOT/Lit_${TAG}_aarch64.dmg"
else
  echo "  DMG uploaded to: s3://$S3_BUCKET/releases/Lit_${TAG}_aarch64.dmg"
  if [[ "$SKIP_WEBSITE" -eq 0 ]]; then
    echo "  Website deployed with release notes."
  fi
fi
echo "════════════════════════════════════════════════════════"
