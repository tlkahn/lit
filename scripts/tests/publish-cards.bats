#!/usr/bin/env bats

load test_helper

source_pc_lib() {
  source "$SCRIPT_DIR/publish-cards-lib.sh"
}

# ── pc_parse_args ──────────────────────────────────────────────────────────────

@test "pc_parse_args: publish with file only" {
  source_pc_lib
  pc_parse_args my-cards.html
  [ "$PC_MODE" = "publish" ]
  [ "$PC_HTML_FILE" = "my-cards.html" ]
  [ -z "$PC_SLUG" ]
  [ "$PC_FORCE" = "0" ]
}

@test "pc_parse_args: publish with file and slug" {
  source_pc_lib
  pc_parse_args my-cards.html custom-slug
  [ "$PC_MODE" = "publish" ]
  [ "$PC_HTML_FILE" = "my-cards.html" ]
  [ "$PC_SLUG" = "custom-slug" ]
}

@test "pc_parse_args: publish with --force" {
  source_pc_lib
  pc_parse_args --force my-cards.html
  [ "$PC_MODE" = "publish" ]
  [ "$PC_HTML_FILE" = "my-cards.html" ]
  [ "$PC_FORCE" = "1" ]
}

@test "pc_parse_args: --delete sets delete mode" {
  source_pc_lib
  pc_parse_args --delete my-slug
  [ "$PC_MODE" = "delete" ]
  [ "$PC_SLUG" = "my-slug" ]
}

@test "pc_parse_args: no args fails" {
  source_pc_lib
  run pc_parse_args
  [ "$status" -eq 1 ]
  [[ "$output" == *"missing"* ]]
}

@test "pc_parse_args: unknown flag fails" {
  source_pc_lib
  run pc_parse_args --bogus file.html
  [ "$status" -eq 1 ]
  [[ "$output" == *"--bogus"* ]]
}

@test "pc_parse_args: --delete without slug fails" {
  source_pc_lib
  run pc_parse_args --delete
  [ "$status" -eq 1 ]
  [[ "$output" == *"--delete requires a slug"* ]]
}

# ── pc_slugify ─────────────────────────────────────────────────────────────────

@test "pc_slugify: 'My Doc Notes.html' -> 'my-doc-notes'" {
  source_pc_lib
  result="$(pc_slugify "My Doc Notes.html")"
  [ "$result" = "my-doc-notes" ]
}

@test "pc_slugify: underscores become dashes" {
  source_pc_lib
  result="$(pc_slugify "my_doc_notes")"
  [ "$result" = "my-doc-notes" ]
}

@test "pc_slugify: unsafe chars dropped" {
  source_pc_lib
  result="$(pc_slugify "hello@world!123.html")"
  [ "$result" = "helloworld123" ]
}

@test "pc_slugify: dash collapsing" {
  source_pc_lib
  result="$(pc_slugify "a---b--c")"
  [ "$result" = "a-b-c" ]
}

@test "pc_slugify: all-unsafe name errors" {
  source_pc_lib
  run pc_slugify "!!!@@@.html"
  [ "$status" -eq 1 ]
  [[ "$output" == *"empty"* ]]
}

@test "pc_validate_slug: rejects non-canonical slug" {
  source_pc_lib
  run pc_validate_slug "My Slug"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not in canonical form"* ]]
}

@test "pc_validate_slug: accepts canonical slug" {
  source_pc_lib
  run pc_validate_slug "my-slug"
  [ "$status" -eq 0 ]
}

# ── pc_check_existing ──────────────────────────────────────────────────────────

@test "pc_check_existing: object exists without --force fails and mentions --force" {
  source_pc_lib
  mock_command_stdin aws 0 '{"LastModified": "2026-01-15T10:00:00Z"}'
  S3_BUCKET="my-bucket"
  PC_FORCE=0
  run pc_check_existing "my-slug"
  [ "$status" -eq 1 ]
  [[ "$output" == *"--force"* ]]
}

@test "pc_check_existing: object exists with PC_FORCE=1 passes" {
  source_pc_lib
  mock_command_stdin aws 0 '{"LastModified": "2026-01-15T10:00:00Z"}'
  S3_BUCKET="my-bucket"
  PC_FORCE=1
  run pc_check_existing "my-slug"
  [ "$status" -eq 0 ]
}

@test "pc_check_existing: head-object 404 (exit 1) passes" {
  source_pc_lib
  mock_command aws 1 ""
  S3_BUCKET="my-bucket"
  PC_FORCE=0
  run pc_check_existing "my-slug"
  [ "$status" -eq 0 ]
}

# ── pc_upload ──────────────────────────────────────────────────────────────────

@test "pc_upload: calls aws s3 cp with correct key, content-type, and cache-control" {
  source_pc_lib
  mock_command aws
  S3_BUCKET="my-bucket"
  PC_HTML_FILE="$TEST_TEMP_DIR/test.html"
  echo "<html></html>" > "$PC_HTML_FILE"
  pc_upload "my-slug"
  assert_mock_called_with "aws s3 cp $TEST_TEMP_DIR/test.html s3://my-bucket/z/my-slug/index.html"
  assert_mock_called_with "text/html; charset=utf-8"
  assert_mock_called_with "max-age=300"
}

# ── pc_get_distribution_id / pc_invalidate ─────────────────────────────────────

@test "pc_get_distribution_id: resolves distribution from mocked stdout" {
  source_pc_lib
  mock_command_stdin aws 0 "EDFDVBD6EXAMPLE"
  pc_get_distribution_id
  [ "$PC_DIST_ID" = "EDFDVBD6EXAMPLE" ]
}

@test "pc_get_distribution_id: empty lookup fails" {
  source_pc_lib
  mock_command_stdin aws 0 ""
  run pc_get_distribution_id
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not find"* ]]
}

@test "pc_invalidate: invalidation path is /z/<slug>/*" {
  source_pc_lib
  mock_command aws
  PC_DIST_ID="EDFDVBD6EXAMPLE"
  pc_invalidate "my-slug"
  assert_mock_called_with "aws cloudfront create-invalidation --distribution-id EDFDVBD6EXAMPLE --paths /z/my-slug/*"
}

# ── pc_delete ──────────────────────────────────────────────────────────────────

@test "pc_delete: calls aws s3 rm --recursive on the right prefix" {
  source_pc_lib
  # First call (s3 ls) returns objects, second+ calls succeed
  cat > "$MOCK_BIN/aws" <<MOCK_EOF
#!/usr/bin/env bash
echo "aws \$@" >> "$MOCK_LOG"
if [[ "\$*" == *"s3 ls"* ]]; then
  echo "2026-01-15 10:00:00  12345 index.html"
elif [[ "\$*" == *"list-distributions"* ]]; then
  echo "EDFDVBD6EXAMPLE"
fi
exit 0
MOCK_EOF
  chmod +x "$MOCK_BIN/aws"
  S3_BUCKET="my-bucket"
  pc_delete "my-slug"
  assert_mock_called_with "aws s3 rm s3://my-bucket/z/my-slug/ --recursive"
}

@test "pc_delete: missing prefix fails" {
  source_pc_lib
  mock_command_stdin aws 0 ""
  S3_BUCKET="my-bucket"
  run pc_delete "typoed-slug"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no objects found"* ]]
}

# ── Guard: deploy-website.sh excludes z/* ──────────────────────────────────────

@test "deploy-website.sh: aws s3 sync excludes z/*" {
  grep -q 'aws s3 sync' "$SCRIPT_DIR/deploy-website.sh"
  grep 'aws s3 sync' "$SCRIPT_DIR/deploy-website.sh" | grep -q -- '--exclude "z/\*"'
}
