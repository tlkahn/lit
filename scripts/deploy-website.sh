#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

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
  echo "==> Updating download button for $TAG"
  VERSION="${TAG#v}"
  URL="https://github.com/tlkahn/lit-releases/releases/download/${TAG}/Lit_${TAG}_aarch64.dmg"
  LABEL="Download ${TAG} for Mac"

  sed -i '' "s|^download_url:.*|download_url: \"$URL\"|"       "$WEBSITE_DIR/content/_index.md"
  sed -i '' "s|^download_label:.*|download_label: \"$LABEL\"|" "$WEBSITE_DIR/content/_index.md"
  sed -i '' "s|^  downloadURL = .*|  downloadURL = '$URL'|"    "$WEBSITE_DIR/hugo.toml"
  sed -i '' "s|^  version = .*|  version = '$VERSION'|"        "$WEBSITE_DIR/hugo.toml"

  echo "==> Pushing content update to website repo"
  (cd "$WEBSITE_DIR" &&
    git add content/_index.md hugo.toml &&
    if ! git diff --cached --quiet; then
      git commit -m "Update download button to $TAG"
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
aws s3 sync "$WEBSITE_DIR/public/" "s3://$BUCKET" --delete --region "$AWS_REGION"

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
