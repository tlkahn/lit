#!/usr/bin/env bash
# Local release script — replicates the CI build-release + update-website pipeline.
# Usage: bash scripts/release.sh [--dry-run] [--skip-website] <tag>
#
# Prerequisites:
#   Tools: bun, cargo, codesign, aws, hugo, gh, jq
#          (llm CLI also needed when website deploy is enabled)
#   Apple signing: "Developer ID Application" certificate in login keychain,
#                  or set APPLE_SIGNING_IDENTITY to the identity string.
#   AWS: credentials configured via ~/.aws/credentials, env vars, or SSO.
#   Git: access to private tlkahn/llm-rs dependency (SSH key or HTTPS token).
#
# Required environment variables:
#   LIT_LICENSE_VERIFYING_KEY_B64 base64-encoded license verifying key
#   APPLE_ID                     Apple ID for notarization (skip in --dry-run)
#   APPLE_PASSWORD               App-specific password    (skip in --dry-run)
#   APPLE_TEAM_ID                Apple Developer Team ID  (skip in --dry-run)
#
# Optional:
#   APPLE_SIGNING_IDENTITY       override auto-detection from keychain
#   OPENAI_API_KEY               for LLM-generated release notes (website deploy)
#   LLM_DEFAULT_MODEL            defaults to gpt-4o-mini
#
# The llm binary staging step from CI is intentionally skipped — llm is a Cargo
# library dependency (llm-rs), not a sidecar binary (not in externalBin).

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
release_checkout_tag "$TAG"
release_check_tools
release_check_env "$DRY_RUN" "$SKIP_WEBSITE"
release_detect_signing_id
release_sync_version "$TAG"

if [[ "$DRY_RUN" -eq 0 ]]; then
  release_get_s3_bucket
fi

release_install_deps
release_fetch_pdfium
release_prebuild_cli
release_codesign_pdfium
release_tauri_build
release_copy_dmg "$TAG"
release_generate_update_manifest "$TAG"
release_upload_update_artifacts "$TAG"
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
