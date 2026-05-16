#!/bin/bash
# Converts release-notes/*.md (frontmatter + markdown body) into Hugo data YAML files.
# Usage: convert-release-notes.sh <output-dir>
set -euo pipefail

OUTPUT_DIR="${1:?Usage: $0 <output-dir>}"
mkdir -p "$OUTPUT_DIR"

for file in release-notes/*.md; do
  [ -f "$file" ] || continue

  version=$(sed -n 's/^version: *"\(.*\)"/\1/p' "$file")
  tag=$(sed -n 's/^tag: *"\(.*\)"/\1/p' "$file")
  date=$(sed -n 's/^date: *"\(.*\)"/\1/p' "$file")

  body=$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' "$file" | sed '/./,$!d')

  out_name=$(echo "$tag" | tr '.' '_').yaml

  {
    echo "version: \"$version\""
    echo "tag: \"$tag\""
    echo "date: \"$date\""
    echo "body: |"
    echo "$body" | sed 's/^/  /'
  } > "$OUTPUT_DIR/$out_name"
done
