#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/publish-cards-lib.sh"

pc_parse_args "$@"
pc_check_tools
release_get_s3_bucket

case "$PC_MODE" in
  publish)
    pc_validate_html_file
    if [[ -n "$PC_SLUG" ]]; then
      pc_validate_slug "$PC_SLUG"
      SLUG="$PC_SLUG"
    else
      SLUG="$(pc_slugify "$(basename "$PC_HTML_FILE")")"
    fi
    echo "==> Publishing to https://${PC_DOMAIN}/${PC_PREFIX}/${SLUG}/"
    pc_check_existing "$SLUG"
    pc_upload "$SLUG"
    pc_get_distribution_id
    pc_invalidate "$SLUG"
    echo "==> Verifying"
    pc_verify "$SLUG"
    echo "==> Published: https://${PC_DOMAIN}/${PC_PREFIX}/${SLUG}/"
    ;;
  delete)
    echo "==> Deleting ${PC_PREFIX}/${PC_SLUG}/"
    pc_delete "$PC_SLUG"
    echo "==> Deleted: ${PC_PREFIX}/${PC_SLUG}/"
    ;;
esac
