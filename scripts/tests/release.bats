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
  export TAURI_SIGNING_PRIVATE_KEY="test-key"
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
  export TAURI_SIGNING_PRIVATE_KEY="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  export ANTHROPIC_API_KEY="sk-test"
  run release_check_env 0 0
  [ "$status" -eq 0 ]
}

@test "release_check_env: ANTHROPIC_API_KEY missing with website deploy fails" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  unset ANTHROPIC_API_KEY
  run release_check_env 0 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"ANTHROPIC_API_KEY"* ]]
}

@test "release_check_env: ANTHROPIC_API_KEY not required with --skip-website" {
  source_lib
  export LIT_TRIAL_SIGNING_KEY_B64="test-key"
  export LIT_LICENSE_VERIFYING_KEY_B64="test-key"
  export TAURI_SIGNING_PRIVATE_KEY="test-key"
  export APPLE_ID="test@example.com"
  export APPLE_PASSWORD="test-password"
  export APPLE_TEAM_ID="TEAM123"
  unset ANTHROPIC_API_KEY
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

# ── Cycle 6b: Version sync ─────────────────────────────────────────────────

@test "release_sync_version: strips v prefix and calls set-version.sh" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/scripts"
  cat > "$TEST_TEMP_DIR/scripts/set-version.sh" <<'SV_EOF'
#!/usr/bin/env bash
echo "$1" > "$REPO_ROOT/synced_version"
SV_EOF
  chmod +x "$TEST_TEMP_DIR/scripts/set-version.sh"
  export REPO_ROOT
  release_sync_version v0.13.0
  [ -f "$TEST_TEMP_DIR/synced_version" ]
  [ "$(cat "$TEST_TEMP_DIR/synced_version")" = "0.13.0" ]
}

# ── Cycle 6c: Version lockstep invariant ───────────────────────────────────
# Guards the single-source-of-truth contract that build.rs relies on: after
# set-version.sh patches the three files, the version in package.json,
# tauri.conf.json, and src-tauri/Cargo.toml must all be identical. build.rs
# makes LIT_GIT_VERSION mirror CARGO_PKG_VERSION on release builds, so any
# divergence here would let the About dialog drift from the bundle/DMG version.

@test "set-version.sh: patches package.json, tauri.conf.json, and Cargo.toml in lockstep" {
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/package.json"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/src-tauri/tauri.conf.json"
  cat > "$TEST_TEMP_DIR/src-tauri/Cargo.toml" <<'TOML'
[package]
name = "lit"
version = "0.0.0"

[dependencies]
foo = "0.0.0"
TOML

  export REPO_ROOT
  run bash "$SCRIPT_DIR/set-version.sh" 0.13.0
  [ "$status" -eq 0 ]

  [ "$(jq -r '.version' "$TEST_TEMP_DIR/package.json")" = "0.13.0" ]
  [ "$(jq -r '.version' "$TEST_TEMP_DIR/src-tauri/tauri.conf.json")" = "0.13.0" ]
  grep -q '^version = "0.13.0"$' "$TEST_TEMP_DIR/src-tauri/Cargo.toml"
}

# Guards that set-version.sh also patches src-tauri/Cargo.lock so the lockfile
# stays in sync with Cargo.toml. Otherwise `cargo build --locked` /
# `cargo check --locked` would fail on a lockfile mismatch after a release bump.
# Scoping is handled natively by `cargo update -p lit`.

@test "set-version.sh: bumps the lit package version in Cargo.lock" {
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/src"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/package.json"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/src-tauri/tauri.conf.json"
  cat > "$TEST_TEMP_DIR/src-tauri/Cargo.toml" <<'TOML'
[package]
name = "lit"
version = "0.0.0"
edition = "2021"
TOML
  echo '' > "$TEST_TEMP_DIR/src-tauri/src/lib.rs"

  # Generate initial lockfile so set-version.sh has something to update.
  (cd "$TEST_TEMP_DIR/src-tauri" && cargo generate-lockfile 2>/dev/null)

  export REPO_ROOT
  run bash "$SCRIPT_DIR/set-version.sh" 0.13.0
  [ "$status" -eq 0 ]

  # The lit package version is bumped in the lockfile.
  run awk '/^name = "lit"$/{getline; print; exit}' "$TEST_TEMP_DIR/src-tauri/Cargo.lock"
  [ "$output" = 'version = "0.13.0"' ]
}

@test "set-version.sh: tolerates a missing Cargo.lock" {
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/package.json"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/src-tauri/tauri.conf.json"
  cat > "$TEST_TEMP_DIR/src-tauri/Cargo.toml" <<'TOML'
[package]
name = "lit"
version = "0.0.0"
TOML

  export REPO_ROOT
  run bash "$SCRIPT_DIR/set-version.sh" 0.13.0
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_TEMP_DIR/src-tauri/Cargo.lock" ]
}

# ── Cycle 6d: git describe flag agreement ──────────────────────────────────
# release-lib.sh's release_sync_version derives the version via
# `git describe --tags --abbrev=0` (nearest tag, no commit suffix). build.rs's
# dev fallback must use the SAME flag so that a binary's About dialog
# (LIT_GIT_VERSION) never shows a `-N-gSHA` suffix that the bundle metadata
# lacks. Guard both: the nearest-tag describe yields a clean tag, and build.rs
# uses --abbrev=0 (not --always).

@test "git describe --tags --abbrev=0 yields a clean tag with no commit-sha suffix" {
  REPO_ROOT="$TEST_TEMP_DIR"
  cd "$TEST_TEMP_DIR"
  git init -q
  git config user.email "t@example.com"
  git config user.name "Test"
  git commit -q --allow-empty -m "first"
  git tag v0.12.0
  git commit -q --allow-empty -m "second"
  git commit -q --allow-empty -m "third"

  # --always would append "-N-gSHA"; --abbrev=0 must not.
  desc="$(git describe --tags --abbrev=0)"
  [ "$desc" = "v0.12.0" ]
  [[ "$desc" != *-g* ]]
}

@test "build.rs derives the dev fallback version with --abbrev=0, not --always" {
  grep -q -- '--abbrev=0' "$SCRIPT_DIR/../src-tauri/build.rs"
  ! grep -q -- '"--always"' "$SCRIPT_DIR/../src-tauri/build.rs"
}

# ── Cycle 6e: install.sh syncs version before build ────────────────────────
# The local install path (bash scripts/install.sh) must derive the app version
# from git the SAME way CI does — `git describe --tags --abbrev=0` (nearest tag,
# no -N-gSHA suffix), falling back to v0.0.0 — strip the leading `v`, and call
# scripts/set-version.sh BEFORE `bun tauri build`. Otherwise the built .app
# bundle carries CFBundleShortVersionString = 0.0.0 while the About dialog shows
# the correct git-derived LIT_GIT_VERSION, so Finder Get Info and update checks
# disagree.

@test "install.sh: derives version via git describe --tags --abbrev=0 with v0.0.0 fallback" {
  grep -q -- 'git describe --tags --abbrev=0' "$SCRIPT_DIR/install.sh"
  grep -q 'v0.0.0' "$SCRIPT_DIR/install.sh"
}

@test "install.sh: calls set-version.sh before bun tauri build" {
  local set_version_line build_line
  set_version_line="$(grep -n 'set-version.sh' "$SCRIPT_DIR/install.sh" | head -1 | cut -d: -f1)"
  build_line="$(grep -n 'bun tauri build' "$SCRIPT_DIR/install.sh" | head -1 | cut -d: -f1)"
  [ -n "$set_version_line" ]
  [ -n "$build_line" ]
  [ "$set_version_line" -lt "$build_line" ]
}

# ── Cycle 6f: SYNC marker enforcement ─────────────────────────────────────
# Three test files mirror pure functions from build.rs with SYNC markers.
# This test enforces byte-for-byte equality of the function bodies between
# build.rs and their test-file mirrors.

@test "mirrored function bodies match build.rs (SYNC markers)" {
  local build_rs="$SCRIPT_DIR/../src-tauri/build.rs"
  local tests_dir="$SCRIPT_DIR/../src-tauri/tests"

  local -a names=("resolve_dev_version" "resolve_git_path" "git_rerun_paths" "ensure_placeholders_in")
  local -a files=(
    "$tests_dir/resolve_dev_version.rs"
    "$tests_dir/git_rerun_paths.rs"
    "$tests_dir/git_rerun_paths.rs"
    "$tests_dir/ensure_placeholders.rs"
  )

  for i in "${!names[@]}"; do
    local name="${names[$i]}"
    local test_file="${files[$i]}"

    local build_body test_body
    build_body="$(sed -n "/^\/\/ SYNC:begin:${name}$/,/^\/\/ SYNC:end:${name}$/{ /^\/\/ SYNC:/d; p; }" "$build_rs")"
    test_body="$(sed -n "/^\/\/ SYNC:begin:${name}$/,/^\/\/ SYNC:end:${name}$/{ /^\/\/ SYNC:/d; p; }" "$test_file")"

    [ -n "$build_body" ] || { echo "SYNC:begin:${name} not found in build.rs"; return 1; }
    [ -n "$test_body" ] || { echo "SYNC:begin:${name} not found in ${test_file##*/}"; return 1; }

    if [ "$build_body" != "$test_body" ]; then
      echo "SYNC mismatch for ${name}:"
      diff <(echo "$build_body") <(echo "$test_body") || true
      return 1
    fi
  done
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

# ── Cycle 12b: Update manifest + artifact upload ────────────────────────────

@test "release_generate_update_manifest: exports RELEASE_UPDATE_TARBALL and writes latest.json" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  local macos_dir="$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  mkdir -p "$macos_dir"
  touch "$macos_dir/signed.app.tar.gz"
  echo "SIGDATA" > "$macos_dir/signed.app.tar.gz.sig"
  release_generate_update_manifest v0.9.2
  [ "$RELEASE_UPDATE_TARBALL" = "$macos_dir/signed.app.tar.gz" ]
  [ -f "$TEST_TEMP_DIR/latest.json" ]
  [ "$(jq -r '.version' "$TEST_TEMP_DIR/latest.json")" = "0.9.2" ]
  [ "$(jq -r '.platforms."darwin-aarch64".signature' "$TEST_TEMP_DIR/latest.json")" = "SIGDATA" ]
}

@test "release_generate_update_manifest: fails when no signature is found" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  run release_generate_update_manifest v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"No .app.tar.gz.sig"* ]]
}

@test "release_upload_update_artifacts: uploads the tarball shared by the manifest step, not an independent find" {
  # Regression: the upload must use the exact artifact whose signature is in
  # latest.json (shared via RELEASE_UPDATE_TARBALL), never a separately-resolved
  # find result that could point at a stale/unsigned tarball.
  source_lib
  mock_command aws
  REPO_ROOT="$TEST_TEMP_DIR"
  S3_BUCKET="my-bucket"
  local macos_dir="$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  mkdir -p "$macos_dir"
  # A decoy in the find location that an independent `find | head -1` could pick.
  touch "$macos_dir/decoy.app.tar.gz"
  # The real, signed artifact lives elsewhere and is passed via the shared var.
  mkdir -p "$TEST_TEMP_DIR/shared"
  touch "$TEST_TEMP_DIR/shared/real.app.tar.gz"
  export RELEASE_UPDATE_TARBALL="$TEST_TEMP_DIR/shared/real.app.tar.gz"
  release_upload_update_artifacts v0.9.2
  assert_mock_called_with "real.app.tar.gz"
  ! grep -q "decoy.app.tar.gz" "$MOCK_LOG"
}

@test "release_upload_update_artifacts: falls back to find when RELEASE_UPDATE_TARBALL is unset" {
  source_lib
  mock_command aws
  unset RELEASE_UPDATE_TARBALL
  REPO_ROOT="$TEST_TEMP_DIR"
  S3_BUCKET="my-bucket"
  local macos_dir="$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  mkdir -p "$macos_dir"
  touch "$macos_dir/found.app.tar.gz"
  release_upload_update_artifacts v0.9.2
  assert_mock_called_with "found.app.tar.gz"
}

@test "release_upload_update_artifacts: fails when no tarball can be resolved" {
  source_lib
  unset RELEASE_UPDATE_TARBALL
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  run release_upload_update_artifacts v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"No .app.tar.gz found"* ]]
}

@test "release_upload_update_artifacts: skipped when DRY_RUN=1" {
  source_lib
  export DRY_RUN=1
  REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/shared"
  touch "$TEST_TEMP_DIR/shared/real.app.tar.gz"
  export RELEASE_UPDATE_TARBALL="$TEST_TEMP_DIR/shared/real.app.tar.gz"
  run release_upload_update_artifacts v0.9.2
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

# ── Cycle 15: Checksum computation ─────────────────────────────────────────

@test "release_compute_checksums: computes DMG SHA-256 and exports it" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  echo "fake-dmg-content" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg"
  local expected
  expected="$(shasum -a 256 "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg" | awk '{print $1}')"
  release_compute_checksums v0.9.2
  [ "$RELEASE_DMG_SHA256" = "$expected" ]
}

@test "release_compute_checksums: writes sidecar file in shasum -c format" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  echo "fake-dmg-content" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg"
  release_compute_checksums v0.9.2
  [ -f "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg.sha256" ]
  # Verify the sidecar is in shasum -c compatible format
  (cd "$TEST_TEMP_DIR" && shasum -c "Lit_v0.9.2_aarch64.dmg.sha256")
}

@test "release_compute_checksums: fails when DMG not found" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  run release_compute_checksums v0.9.2
  [ "$status" -eq 1 ]
  [[ "$output" == *"not found"* ]] || [[ "$output" == *"No DMG"* ]]
}

@test "release_compute_checksums: hashes each file exactly once" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  local real_shasum
  real_shasum="$(command -v shasum)"
  cat > "$MOCK_BIN/shasum" <<MOCK_EOF
#!/usr/bin/env bash
echo "shasum \$@" >> "$MOCK_LOG"
"$real_shasum" "\$@"
MOCK_EOF
  chmod +x "$MOCK_BIN/shasum"
  echo "fake-dmg-content" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg"
  echo "fake-tarball-content" > "$TEST_TEMP_DIR/update.app.tar.gz"
  export RELEASE_UPDATE_TARBALL="$TEST_TEMP_DIR/update.app.tar.gz"
  release_compute_checksums v0.9.2
  local count
  count="$(grep -c '^shasum ' "$MOCK_LOG")"
  [ "$count" -eq 2 ]
}

# ── Cycle 16: Tarball checksum ─────────────────────────────────────────────

@test "release_compute_checksums: computes tarball SHA-256 when RELEASE_UPDATE_TARBALL is set" {
  source_lib
  REPO_ROOT="$TEST_TEMP_DIR"
  echo "fake-dmg-content" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg"
  echo "fake-tarball-content" > "$TEST_TEMP_DIR/update.app.tar.gz"
  export RELEASE_UPDATE_TARBALL="$TEST_TEMP_DIR/update.app.tar.gz"
  local expected
  expected="$(shasum -a 256 "$TEST_TEMP_DIR/update.app.tar.gz" | awk '{print $1}')"
  release_compute_checksums v0.9.2
  [ "$RELEASE_TARBALL_SHA256" = "$expected" ]
  [ -f "$TEST_TEMP_DIR/update.app.tar.gz.sha256" ]
}

# ── Cycle 17: Checksum upload ──────────────────────────────────────────────

@test "release_upload_checksums: uploads .sha256 files via aws s3 cp" {
  source_lib
  mock_command aws
  REPO_ROOT="$TEST_TEMP_DIR"
  S3_BUCKET="my-bucket"
  echo "abc123  Lit_v0.9.2_aarch64.dmg" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg.sha256"
  release_upload_checksums v0.9.2
  assert_mock_called_with "aws s3 cp"
  assert_mock_called_with "Lit_v0.9.2_aarch64.dmg.sha256"
}

@test "release_upload_checksums: uploads tarball sidecar when present" {
  source_lib
  mock_command aws
  REPO_ROOT="$TEST_TEMP_DIR"
  S3_BUCKET="my-bucket"
  echo "abc123  Lit_v0.9.2_aarch64.dmg" > "$TEST_TEMP_DIR/Lit_v0.9.2_aarch64.dmg.sha256"
  echo "def456  update.app.tar.gz" > "$TEST_TEMP_DIR/update.app.tar.gz.sha256"
  export RELEASE_UPDATE_TARBALL="$TEST_TEMP_DIR/update.app.tar.gz"
  release_upload_checksums v0.9.2
  assert_mock_called_with "update.app.tar.gz.sha256"
}

@test "release_upload_checksums: skipped when DRY_RUN=1" {
  source_lib
  export DRY_RUN=1
  export REPO_ROOT="$TEST_TEMP_DIR"
  run release_upload_checksums v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
}

# ── Cycle 19: release_inject_checksum ──────────────────────────────────────

@test "release_inject_checksum: injects SHA256 into _index.md and hugo.toml" {
  source_lib
  local INDEX="$TEST_TEMP_DIR/_index.md"
  local TOML="$TEST_TEMP_DIR/hugo.toml"
  cat > "$INDEX" <<'EOF'
---
download_sha256: ""
---
EOF
  cat > "$TOML" <<'EOF'
[params]
  downloadSHA256 = ''
EOF

  export RELEASE_DMG_SHA256="abc123def456"
  release_inject_checksum "$INDEX" "$TOML"

  grep -q 'download_sha256: "abc123def456"' "$INDEX"
  grep -q "downloadSHA256 = 'abc123def456'" "$TOML"
}

@test "release_inject_checksum: no-op when RELEASE_DMG_SHA256 is empty" {
  source_lib
  local INDEX="$TEST_TEMP_DIR/_index.md"
  local TOML="$TEST_TEMP_DIR/hugo.toml"
  cat > "$INDEX" <<'EOF'
---
download_sha256: ""
---
EOF
  cat > "$TOML" <<'EOF'
[params]
  downloadSHA256 = ''
EOF

  unset RELEASE_DMG_SHA256
  release_inject_checksum "$INDEX" "$TOML"

  grep -q 'download_sha256: ""' "$INDEX"
  grep -q "downloadSHA256 = ''" "$TOML"
}

# ── Cycle 20: release_inject_checksum warnings ────────────────────────────

@test "release_inject_checksum: warns when download_sha256 line missing from _index.md" {
  source_lib
  local INDEX="$TEST_TEMP_DIR/_index.md"
  local TOML="$TEST_TEMP_DIR/hugo.toml"
  cat > "$INDEX" <<'EOF'
---
title: "Home"
---
EOF
  cat > "$TOML" <<'EOF'
[params]
  downloadSHA256 = ''
EOF

  export RELEASE_DMG_SHA256="abc123def456"
  run release_inject_checksum "$INDEX" "$TOML"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Warning: download_sha256 placeholder not found"* ]]
}

@test "release_inject_checksum: warns when downloadSHA256 line missing from hugo.toml" {
  source_lib
  local INDEX="$TEST_TEMP_DIR/_index.md"
  local TOML="$TEST_TEMP_DIR/hugo.toml"
  cat > "$INDEX" <<'EOF'
---
download_sha256: ""
---
EOF
  cat > "$TOML" <<'EOF'
[params]
  version = '0.1.0'
EOF

  export RELEASE_DMG_SHA256="abc123def456"
  run release_inject_checksum "$INDEX" "$TOML"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Warning: downloadSHA256 placeholder not found"* ]]
}

@test "release_inject_checksum: no warning when placeholders exist" {
  source_lib
  local INDEX="$TEST_TEMP_DIR/_index.md"
  local TOML="$TEST_TEMP_DIR/hugo.toml"
  cat > "$INDEX" <<'EOF'
---
download_sha256: ""
---
EOF
  cat > "$TOML" <<'EOF'
[params]
  downloadSHA256 = ''
EOF

  export RELEASE_DMG_SHA256="abc123def456"
  run release_inject_checksum "$INDEX" "$TOML"
  [ "$status" -eq 0 ]
  [[ "$output" != *"Warning:"* ]]
}

# ── Cycle 14: Orchestrator integration ───────────────────────────────────────

@test "release.sh: dry-run calls stages in order" {
  # Mock all external tools
  for tool in bun cargo codesign aws hugo gh jq git security shasum; do
    mock_command "$tool"
  done

  # bun tauri build must recreate the DMG that release_tauri_build deletes
  cat > "$MOCK_BIN/bun" <<BUNEOF
#!/usr/bin/env bash
echo "bun \$@" >> "$MOCK_LOG"
if [[ "\$*" == *"tauri build"* ]]; then
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Lit_0.1.0_aarch64.dmg"
fi
exit 0
BUNEOF
  chmod +x "$MOCK_BIN/bun"

  # shasum must produce realistic output for release_compute_checksums
  cat > "$MOCK_BIN/shasum" <<'SHASUMEOF'
#!/usr/bin/env bash
echo "shasum $@" >> "$MOCK_LOG"
echo "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  $3"
SHASUMEOF
  chmod +x "$MOCK_BIN/shasum"

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
  export TAURI_SIGNING_PRIVATE_KEY="test-key"

  # Create directory structure the script expects
  export REPO_ROOT="$TEST_TEMP_DIR"
  mkdir -p "$TEST_TEMP_DIR/scripts"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/libs"
  mkdir -p "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Lit_0.1.0_aarch64.dmg"
  touch "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lit.app.tar.gz"
  echo "SIGDATA" > "$TEST_TEMP_DIR/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Lit.app.tar.gz.sig"
  cp "$SCRIPT_DIR/release-lib.sh" "$TEST_TEMP_DIR/scripts/"
  cp "$SCRIPT_DIR/release.sh" "$TEST_TEMP_DIR/scripts/"
  cp "$SCRIPT_DIR/set-version.sh" "$TEST_TEMP_DIR/scripts/"
  touch "$TEST_TEMP_DIR/scripts/fetch-pdfium.sh"
  touch "$TEST_TEMP_DIR/scripts/deploy-website.sh"

  # set-version.sh needs these files to exist
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/package.json"
  echo '{"version":"0.0.0"}' > "$TEST_TEMP_DIR/src-tauri/tauri.conf.json"
  cat > "$TEST_TEMP_DIR/src-tauri/Cargo.toml" <<'TOML'
[package]
name = "lit"
version = "0.0.0"
TOML

  run bash "$TEST_TEMP_DIR/scripts/release.sh" --dry-run v0.9.2
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]] || [[ "$output" == *"dry"* ]] || [[ "$output" == *"Dry"* ]]
  [[ "$output" == *"Syncing version"* ]]
  assert_mock_called_with "bun install --frozen-lockfile"
  assert_mock_called_with "bun tauri build"
  [[ "$output" == *"Computing SHA-256"* ]]
  [[ "$output" == *"Would upload .sha256"* ]]
}
