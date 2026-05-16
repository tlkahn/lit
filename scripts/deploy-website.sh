#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

AWS_REGION="us-east-1"
STACK_NAME="lit-production"
DOMAIN="lit.solar"
WEBSITE_REPO="https://github.com/tlkahn/tlkahn.github.io.git"
WEBSITE_DIR=".website-build"
TAG="${1:-}"

cleanup() { rm -rf "$WEBSITE_DIR"; }
trap cleanup EXIT

echo "==> Cloning website repo"
rm -rf "$WEBSITE_DIR"
git clone --depth 1 "$WEBSITE_REPO" "$WEBSITE_DIR"

if [ -n "$TAG" ]; then
  if ! command -v llm >/dev/null 2>&1; then
    echo "==> Building llm CLI from submodule"
    (cd llm-rs && cargo build --release -p llm-cli)
    export PATH="$PWD/llm-rs/target/release:$PATH"
  fi
  echo "==> Generating release notes for $TAG"
  bash "$SCRIPT_DIR/generate-release-notes.sh" --force "$TAG" || echo "    (generation failed, will use existing notes if any)"
fi

echo "==> Copying release notes"
mkdir -p "$WEBSITE_DIR/content/releases"
if ls release-notes/*.md 1>/dev/null 2>&1; then
  cp release-notes/*.md "$WEBSITE_DIR/content/releases/"
  NOTES_COPIED=$(ls release-notes/*.md | wc -l | tr -d ' ')
  echo "    Copied $NOTES_COPIED notes"
else
  NOTES_COPIED=0
  echo "    No release notes found"
fi

if [ -n "$TAG" ]; then
  echo "==> Updating download button for $TAG"
  VERSION="${TAG#v}"
  URL="https://lit.solar/releases/Lit_${TAG}_aarch64.dmg"
  LABEL="Download ${TAG} for Mac"

  sed -i '' "s|^download_url:.*|download_url: \"$URL\"|"       "$WEBSITE_DIR/content/_index.md"
  sed -i '' "s|^download_label:.*|download_label: \"$LABEL\"|" "$WEBSITE_DIR/content/_index.md"
  sed -i '' "s|^  downloadURL = .*|  downloadURL = '$URL'|"    "$WEBSITE_DIR/hugo.toml"
  sed -i '' "s|^  version = .*|  version = '$VERSION'|"        "$WEBSITE_DIR/hugo.toml"

  echo "==> Pushing content update to website repo"
  (cd "$WEBSITE_DIR" &&
    git add content/_index.md hugo.toml content/releases/ &&
    if ! git diff --cached --quiet; then
      git commit -m "Update download button and release notes for $TAG"
      git push
    else
      echo "    (no content changes)"
    fi)
elif [ "$NOTES_COPIED" -gt 0 ]; then
  echo "==> Pushing release notes to website repo"
  (cd "$WEBSITE_DIR" &&
    git add content/releases/ &&
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
aws s3 sync "$WEBSITE_DIR/public/" "s3://$BUCKET" --delete --exclude "releases/*" --region "$AWS_REGION"

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
