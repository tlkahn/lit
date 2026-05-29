#!/usr/bin/env bats

load test_helper

# ── Cycle 1: Argument parsing ────────────────────────────────────────────────

@test "release_parse_args: tag only sets TAG and defaults" {
  source_lib
  release_parse_args v0.9.2
  [ "$TAG" = "v0.9.2" ]
  [ "$DRY_RUN" = "0" ]
  [ "$SKIP_WEBSITE" = "0" ]
}

@test "release_parse_args: --dry-run sets DRY_RUN=1" {
  source_lib
  release_parse_args --dry-run v0.9.2
  [ "$TAG" = "v0.9.2" ]
  [ "$DRY_RUN" = "1" ]
}

@test "release_parse_args: --skip-website sets SKIP_WEBSITE=1" {
  source_lib
  release_parse_args --skip-website v0.9.2
  [ "$TAG" = "v0.9.2" ]
  [ "$SKIP_WEBSITE" = "1" ]
}

@test "release_parse_args: both flags together" {
  source_lib
  release_parse_args --dry-run --skip-website v0.9.2
  [ "$TAG" = "v0.9.2" ]
  [ "$DRY_RUN" = "1" ]
  [ "$SKIP_WEBSITE" = "1" ]
}

@test "release_parse_args: no args exits 1" {
  source_lib
  run release_parse_args
  [ "$status" -eq 1 ]
}

@test "release_parse_args: unknown flag exits 1" {
  source_lib
  run release_parse_args --bogus v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"--bogus"* ]]
}

# ── Cycle 2: Tag validation ──────────────────────────────────────────────────

@test "release_validate_tag: valid semver tag passes" {
  source_lib
  mock_command git 0 ""
  run release_validate_tag v0.9.2
  [ "$status" -eq 0 ]
}

@test "release_validate_tag: missing v prefix fails" {
  source_lib
  run release_validate_tag not-a-tag
  [ "$status" -eq 1 ]
  [[ "$output" == *"format"* ]]
}

@test "release_validate_tag: missing patch version fails" {
  source_lib
  run release_validate_tag v1.2
  [ "$status" -eq 1 ]
}

@test "release_validate_tag: valid format but tag missing in git fails" {
  source_lib
  mock_command git 1 ""
  run release_validate_tag v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* ]]
}

# ── Cycle 3: Tool checks ────────────────────────────────────────────────────

@test "release_check_tools: all present succeeds" {
  source_lib
  for tool in bun cargo codesign aws hugo gh jq; do
    mock_command "$tool"
  done
  PATH="$MOCK_BIN" run release_check_tools
  [ "$status" -eq 0 ]
}

@test "release_check_tools: one missing fails with name" {
  source_lib
  for tool in bun cargo codesign aws gh jq; do
    mock_command "$tool"
  done
  # hugo is missing
  PATH="$MOCK_BIN" run release_check_tools
  [ "$status" -eq 1 ]
  [[ "$output" == *"hugo"* ]]
}

@test "release_check_tools: multiple missing lists all" {
  source_lib
  for tool in bun cargo codesign; do
    mock_command "$tool"
  done
  # aws, hugo, gh, jq missing
  PATH="$MOCK_BIN" run release_check_tools
  [ "$status" -eq 1 ]
  [[ "$output" == *"aws"* ]]
  [[ "$output" == *"hugo"* ]]
  [[ "$output" == *"gh"* ]]
  [[ "$output" == *"jq"* ]]
}

# ── Cycle 4: Env var checks ─────────────────────────────────────────────────

@test "release_check_env: license keys missing fails" {
  source_lib
  unset LIT_TRIAL_SIGNING_KEY_B64
  unset LIT_LICENSE_VERIFYING_KEY_B64
  run release_check_env 0 1
  [ "$status" -eq 1 ]
  [[ "$output" == *"LIT_TRIAL_SIGNING_KEY_B64"* ]]
}

@test "release_check_env: license keys set passes in dry-run" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  run release_check_env 1 0
  [ "$status" -eq 0 ]
}

@test "release_check_env: notarization vars missing in non-dry-run fails" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  unset APPLE_ID
  unset APPLE_PASSWORD
  unset APPLE_TEAM_ID
  run release_check_env 0 1
  [ "$status" -eq 1 ]
  [[ "$output" == *"APPLE_ID"* ]]
}

@test "release_check_env: all required vars set passes" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  export OPENAI_API_KEY="sk-test"
  run release_check_env 0 0
  [ "$status" -eq 0 ]
}

@test "release_check_env: OPENAI_API_KEY missing with website deploy fails" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  unset OPENAI_API_KEY
  run release_check_env 0 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"OPENAI_API_KEY"* ]]
}

@test "release_check_env: OPENAI_API_KEY not required with --skip-website" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  unset OPENAI_API_KEY
  run release_check_env 0 1
  [ "$status" -eq 0 ]
}

# ── Cycle 5: Signing identity detection ─────────────────────────────────────

@test "release_detect_signing_id: uses APPLE_SIGNING_IDENTITY if set" {
  source_lib
  export APPLE_SIGNING_IDENTITY="Developer ID Application: Test (ABC123)"
  release_detect_signing_id
  [ "$APPLE_SIGNING_IDENTITY" = "Developer ID Application: Test (ABC123)" ]
}

@test "release_detect_signing_id: auto-detects single identity" {
  source_lib
  unset APPLE_SIGNING_IDENTITY
  mock_command_stdin security 0 '  1) ABCDEF1234 "Developer ID Application: Test User (TEAM123)"
     1 valid identities found'
  release_detect_signing_id
  [[ "$APPLE_SIGNING_IDENTITY" == *"Developer ID Application"* ]]
}

@test "release_detect_signing_id: fails with zero matches" {
  source_lib
  unset APPLE_SIGNING_IDENTITY
  mock_command_stdin security 0 '     0 valid identities found'
  run release_detect_signing_id
  [ "$status" -eq 1 ]
  [[ "$output" == *"No Developer ID"* ]]
}

@test "release_detect_signing_id: fails with multiple matches" {
  source_lib
  unset APPLE_SIGNING_IDENTITY
  mock_command_stdin security 0 '  1) ABCDEF1234 "Developer ID Application: User A (TEAM1)"
  2) GHIJKL5678 "Developer ID Application: User B (TEAM2)"
     2 valid identities found'
  run release_detect_signing_id
  [ "$status" -eq 1 ]
  [[ "$output" == *"Multiple"* ]]
}

# ── Cycle 6: S3 bucket resolution ───────────────────────────────────────────

@test "release_get_s3_bucket: sets S3_BUCKET from cloudformation" {
  source_lib
  mock_command_stdin aws 0 '"my-website-bucket"'
  release_get_s3_bucket
  [ "$S3_BUCKET" = "my-website-bucket" ]
}

@test "release_get_s3_bucket: fails on aws error" {
  source_lib
  mock_command aws 1 ""
  run release_get_s3_bucket
  [ "$status" -eq 1 ]
}

# ── Cycle 7: Build helper functions ─────────────────────────────────────────

@test "release_install_deps: calls bun install --frozen-lockfile" {
  source_lib
  mock_command bun
  release_install_deps
  assert_mock_called_with "bun install --frozen-lockfile"
}

@test "release_fetch_pdfium: calls fetch-pdfium.sh" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/scripts"
  cat > "$TEST_TEMP_DIR/scripts/fetch-pdfium.sh" <<'EOF'
#!/usr/bin/env bash
echo "fetch-pdfium called" > "$TEST_TEMP_DIR/fetch_pdfium.called"
EOF
  chmod +x "$TEST_TEMP_DIR/scripts/fetch-pdfium.sh"
  release_fetch_pdfium
  [ -f "$TEST_TEMP_DIR/fetch_pdfium.called" ]
}

# ── Cycle 8: lit-cli pre-build ───────────────────────────────────────────────

@test "release_prebuild_cli: calls cargo build with correct args" {
  source_lib
  mock_command cargo
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/binaries"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/lit-cli"
  release_prebuild_cli
  assert_mock_called_with "cargo build --release --bin lit-cli --target aarch64-apple-darwin"
}

@test "release_prebuild_cli: copies binary to binaries dir" {
  source_lib
  mock_command cargo
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/binaries"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release"
  echo "fake-binary" > "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/lit-cli"
  release_prebuild_cli
  [ -f "$TEST_TEMP_DIR/src-tauri/binaries/lit-cli-aarch64-apple-darwin" ]
}

# ── Cycle 9: Codesign pdfium ────────────────────────────────────────────────

@test "release_codesign_pdfium: calls codesign with correct args" {
  source_lib
  mock_command codesign
  REPO_ROOT="$TEST_TEMP_DIR"
  export APPLE_SIGNING_IDENTITY="Developer ID Application: Test (ABC123)"
  release_codesign_pdfium
  assert_mock_called_with "codesign --sign Developer ID Application: Test (ABC123) --timestamp --force --options runtime $TEST_TEMP_DIR/src-tauri/libs/libpdfium.dylib"
}

# ── Cycle 10: Tauri build ───────────────────────────────────────────────────

@test "release_tauri_build: calls bun tauri build with target and config override" {
  source_lib
  mock_command bun
  release_tauri_build
  assert_mock_called_with 'bun tauri build --target aarch64-apple-darwin --config'
}

# ── Cycle 11: DMG copy ──────────────────────────────────────────────────────

@test "release_copy_dmg: finds and copies DMG with tag name" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Lit_0.1.0_aarch64.dmg"
  release_copy_dmg v0.9.2
  [ -f "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg" ]
}

@test "release_copy_dmg: fails if no DMG found" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin"
  run release_copy_dmg v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"No DMG"* ]]
}

# ── Cycle 12: DMG upload ────────────────────────────────────────────────────

@test "release_upload_dmg: calls aws s3 cp" {
  source_lib
  mock_command aws
  REPO_ROOT="$TEST_TEMP_DIR"
  S3_BUCKET="my-bucket"
  touch "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg"
  release_upload_dmg v0.9.2
  assert_mock_called_with "aws s3 cp"
}

@test "release_upload_dmg: skipped when DRY_RUN=1" {
  source_lib
  export DRY_RUN=1
  export REPO_ROOT="$TEST_TEMP_DIR"
  run release_upload_dmg v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
}

# ── Cycle 13: Website deploy ────────────────────────────────────────────────

@test "release_deploy_website: calls deploy-website.sh with tag" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/scripts"
  cat > "$TEST_TEMP_DIR/scripts/deploy-website.sh" <<'EOF'
#!/usr/bin/env bash
echo "$@" > "$TEST_TEMP_DIR/deploy_website.args"
EOF
  chmod +x "$TEST_TEMP_DIR/scripts/deploy-website.sh"
  export TEST_TEMP_DIR
  release_deploy_website v0.9.2
  [ -f "$TEST_TEMP_DIR/deploy_website.args" ]
  grep -q "v0.9.2" "$TEST_TEMP_DIR/deploy_website.args"
}

@test "release_deploy_website: skipped when SKIP_WEBSITE=1" {
  source_lib
  export SKIP_WEBSITE=1
  export REPO_ROOT="$TEST_TEMP_DIR"
  run release_deploy_website v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"Skipping"* ]] || [[ "$output" == *"skip"* ]]
}

@test "release_deploy_website: skipped when DRY_RUN=1" {
  source_lib
  export DRY_RUN=1
  export REPO_ROOT="$TEST_TEMP_DIR"
  run release_deploy_website v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"Skipping"* ]] || [[ "$output" == *"DRY RUN"* ]]
}

# ── Cycle 14: Orchestrator integration ───────────────────────────────────────

@test "release.sh: dry-run calls stages in order" {
  # Mock all external tools
  for tool in bun cargo codesign aws hugo gh jq git security; do
    mock_command "$tool"
  done

  # git tag verification needs to succeed
  cat > "$MOCK_BIN/git" <<'EOF'
#!/usr/bin/env bash
echo "git $@" >> "$MOCK_LOG"
if [[ "$*" == *"rev-parse"* ]]; then
  exit 0
fi
exit 0
EOF
  chmod +x "$MOCK_BIN/git"

  # security for signing identity detection
  cat > "$MOCK_BIN/security" <<'EOF'
#!/usr/bin/env bash
echo "security $@" >> "$MOCK_LOG"
cat <<'SECURITY_EOF'
  1) ABCDEF1234 "Developer ID Application: Test User (TEAM123)"
     1 valid identities found
SECURITY_EOF
EOF
  chmod +x "$MOCK_BIN/security"

  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"

  # Create directory structure the script expects
  export REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/scripts"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/binaries"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/libs"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/lit-cli"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Lit_0.1.0_aarch64.dmg"
  cp "$SCRIPT_DIR/release-lib.sh" "$TEST_TEMP_DIR/scripts/"
  cp "$SCRIPT_DIR/release.sh" "$TEST_TEMP_DIR/scripts/"
  touch "$TEST_TEMP_DIR/scripts/fetch-pdfium.sh"
  touch "$TEST_TEMP_DIR/scripts/deploy-website.sh"

  run bash "$TEST_TEMP_DIR/scripts/release.sh" --dry-run v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]] || [[ "$output" == *"dry"* ]] || [[ "$output" == *"Dry"* ]]
  assert_mock_called_with "bun install --frozen-lockfile"
  assert_mock_called_with "cargo build --release --bin lit-cli --target aarch64-apple-darwin"
  assert_mock_called_with "bun tauri build"
}
