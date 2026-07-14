#!/usr/bin/env bash
# Runs the "ui" vitest project (jsdom/CodeMirror-heavy component, editor, and
# hook tests) as separate vitest processes, one per directory, instead of one
# combined run. A single combined run piles up jsdom+CodeMirror environments
# in the same worker pool until memory pressure hangs the run indefinitely
# (see doc/reports/2026-07-14-issue-886-block-anchor-fragment-fix.md). Each
# group here starts a fresh process, so memory resets between groups.
set -uo pipefail

groups=(
  "src/components"
  "src/editor"
  "src/hooks"
  "src/App.test.tsx"
)

status=0
for g in "${groups[@]}"; do
  echo ""
  echo "=== vitest (ui): $g ==="
  bunx vitest run --project ui "$g" || status=1
done

exit "$status"
