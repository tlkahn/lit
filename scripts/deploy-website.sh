#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/release-lib.sh"
cd "$SCRIPT_DIR/.."

AWS_REGION="us-east-1"
STACK_NAME="lit-production"
DOMAIN="lit.solar"
WEBSITE_REPO="https://github.com/tlkahn/tlkahn.github.io.git"
WEBSITE_DIR=".website-build"

FREE_DISTRIBUTION=0
TAG=""
for arg in "$@"; do
  case "$arg" in
    --free-distribution) FREE_DISTRIBUTION=1 ;;
    *) TAG="$arg" ;;
  esac
done

if [[ "$FREE_DISTRIBUTION" -eq 1 && -z "$TAG" ]]; then
  echo "Error: --free-distribution requires a tag (the version whose free-distribution DMG was already built and uploaded via 'release.sh --free-distribution <tag>')" >&2
  exit 1
fi

cleanup() { rm -rf "$WEBSITE_DIR"; }
trap cleanup EXIT

echo "==> Cloning website repo"
rm -rf "$WEBSITE_DIR"
git clone --depth 1 "$WEBSITE_REPO" "$WEBSITE_DIR"

if [ -n "$TAG" ] && [ "$FREE_DISTRIBUTION" -eq 0 ]; then
  if ! command -v llm >/dev/null 2>&1; then
    echo "==> Installing llm CLI"
    cargo install llm-cmd
  fi
  echo "==> Generating release notes for $TAG"
  bash "$SCRIPT_DIR/generate-release-notes.sh" --force "$TAG" || echo "    (generation failed, will use existing notes if any)"
fi

echo "==> Converting release notes to Hugo data"
rm -rf "$WEBSITE_DIR/content/releases"
bash "$SCRIPT_DIR/convert-release-notes.sh" "$WEBSITE_DIR/data/releases"
if ls "$WEBSITE_DIR/data/releases/"*.yaml 1>/dev/null 2>&1; then
  NOTES_COPIED=$(ls "$WEBSITE_DIR/data/releases/"*.yaml | wc -l | tr -d ' ')
  echo "    Converted $NOTES_COPIED notes"
else
  NOTES_COPIED=0
  echo "    No release notes found"
fi

if [ -n "$TAG" ] && [ "$FREE_DISTRIBUTION" -eq 1 ]; then
  echo "==> Enabling free-distribution mode for $TAG"
  URL="https://lit.solar/free-distribution/Lit_free_aarch64.dmg"
  DMG_SHA256_FILE="$REPO_ROOT/Lit_${TAG}_aarch64.dmg.sha256"
  if [[ ! -f "$DMG_SHA256_FILE" ]]; then
    echo "Error: $DMG_SHA256_FILE not found. Run 'release.sh --free-distribution $TAG' first so the checksum exists." >&2
    exit 1
  fi
  RELEASE_DMG_SHA256="$(awk '{print $1}' "$DMG_SHA256_FILE")"
  export RELEASE_DMG_SHA256

  INDEX="$WEBSITE_DIR/content/_index.md"
  TOML="$WEBSITE_DIR/hugo.toml"
  # download_label / version are left untouched: the template only shows
  # download_label when freeDistribution is false, and version isn't tied
  # to this artifact. Both get restored correctly the next time a normal
  # (non-free) tag is deployed.
  sed "s|^download_url:.*|download_url: \"$URL\"|" "$INDEX" > "$INDEX.tmp" && mv "$INDEX.tmp" "$INDEX"
  sed "s|^  downloadURL = .*|  downloadURL = '$URL'|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"
  sed "s|^  freeDistribution = .*|  freeDistribution = true|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"

  release_inject_checksum "$INDEX" "$TOML"

  echo "==> Pushing content update to website repo"
  (cd "$WEBSITE_DIR" &&
    git add content/_index.md hugo.toml data/releases/
    git rm -r --cached content/releases/ 2>/dev/null || true
    if ! git diff --cached --quiet; then
      git commit -m "Enable free-distribution download for $TAG"
      git push
    else
      echo "    (no content changes)"
    fi)
elif [ -n "$TAG" ]; then
  echo "==> Updating download button for $TAG"
  VERSION="${TAG#v}"
  URL="https://lit.solar/releases/Lit_${TAG}_aarch64.dmg"
  LABEL="Download ${TAG} for Mac"

  INDEX="$WEBSITE_DIR/content/_index.md"
  TOML="$WEBSITE_DIR/hugo.toml"
  sed "s|^download_url:.*|download_url: \"$URL\"|" "$INDEX" > "$INDEX.tmp" && mv "$INDEX.tmp" "$INDEX"
  sed "s|^download_label:.*|download_label: \"$LABEL\"|" "$INDEX" > "$INDEX.tmp" && mv "$INDEX.tmp" "$INDEX"
  sed "s|^  downloadURL = .*|  downloadURL = '$URL'|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"
  sed "s|^  version = .*|  version = '$VERSION'|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"
  # A normal (non-free) release deploy always ends any free-distribution
  # campaign still marked live in hugo.toml, so operators don't have to
  # remember a separate "turn it off" step.
  sed "s|^  freeDistribution = .*|  freeDistribution = false|" "$TOML" > "$TOML.tmp" && mv "$TOML.tmp" "$TOML"

  release_inject_checksum "$INDEX" "$TOML"

  echo "==> Pushing content update to website repo"
  (cd "$WEBSITE_DIR" &&
    git add content/_index.md hugo.toml data/releases/
    git rm -r --cached content/releases/ 2>/dev/null || true
    if ! git diff --cached --quiet; then
      git commit -m "Update download button and release notes for $TAG"
      git push
    else
      echo "    (no content changes)"
    fi)
elif [ "$NOTES_COPIED" -gt 0 ]; then
  echo "==> Pushing release notes to website repo"
  (cd "$WEBSITE_DIR" &&
    git add data/releases/
    git rm -r --cached content/releases/ 2>/dev/null || true
    if ! git diff --cached --quiet; then
      git commit -m "Update release notes"
      git push
    else
      echo "    (no content changes)"
    fi)
fi

echo "==> Building Hugo site"
hugo --minify -s "$WEBSITE_DIR"

BUCKET=$(aws cloudformation describe-stacks \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" \
  --output text)
echo "==> Syncing to s3://$BUCKET"
# releases/Lit*, releases/latest.json, free-distribution/Lit*, and z/*
# (published cardbox pages) are uploaded directly by release.sh or
# publish-cards.sh, not produced by the Hugo build in $WEBSITE_DIR/public/
# - exclude them so --delete doesn't wipe them out.
aws s3 sync "$WEBSITE_DIR/public/" "s3://$BUCKET" --delete --exclude "releases/Lit*" --exclude "releases/latest.json" --exclude "free-distribution/Lit*" --exclude "z/*" --region "$AWS_REGION"

DIST_ID=$(aws cloudfront list-distributions \
  --region "$AWS_REGION" \
  --query "DistributionList.Items[?Aliases.Items[0]=='$DOMAIN'].Id" \
  --output text)
echo "==> Invalidating CloudFront ($DIST_ID)"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --region "$AWS_REGION" > /dev/null

echo "==> Verifying"
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
if [ "$STATUS" = "200" ]; then
  echo "    https://$DOMAIN/ => $STATUS OK"
else
  echo "    https://$DOMAIN/ => $STATUS (may need a few seconds for invalidation to propagate)"
fi
