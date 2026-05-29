#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

setup() {
  TEST_TEMP_DIR="$(mktemp -d)"
  MOCK_BIN="$TEST_TEMP_DIR/bin"
  MOCK_LOG="$TEST_TEMP_DIR/mock.log"
  mkdir -p "$MOCK_BIN"
  touch "$MOCK_LOG"
  export PATH="$MOCK_BIN:$PATH"
  export MOCK_LOG
  export TEST_TEMP_DIR
}

teardown() {
  rm -rf "$TEST_TEMP_DIR"
}

mock_command() {
  local cmd="$1"
  local exit_code="${2:-0}"
  local stdout="${3:-}"
  cat > "$MOCK_BIN/$cmd" <<MOCK_EOF
#!/usr/bin/env bash
echo "$cmd \$@" >> "$MOCK_LOG"
if [ -n "$stdout" ]; then
  echo "$stdout"
fi
exit $exit_code
MOCK_EOF
  chmod +x "$MOCK_BIN/$cmd"
}

mock_command_stdin() {
  local cmd="$1"
  local exit_code="${2:-0}"
  local stdout="$3"
  cat > "$MOCK_BIN/$cmd" <<'MOCK_EOF'
#!/usr/bin/env bash
MOCK_EOF
  echo "echo \"\$@\" >> \"$MOCK_LOG\"" >> "$MOCK_BIN/$cmd"
  if [ -n "$stdout" ]; then
    echo "cat <<'STDOUT_EOF'" >> "$MOCK_BIN/$cmd"
    echo "$stdout" >> "$MOCK_BIN/$cmd"
    echo "STDOUT_EOF" >> "$MOCK_BIN/$cmd"
  fi
  echo "exit $exit_code" >> "$MOCK_BIN/$cmd"
  chmod +x "$MOCK_BIN/$cmd"
}

source_lib() {
  source "$SCRIPT_DIR/release-lib.sh"
}

assert_mock_called_with() {
  local pattern="$1"
  grep -q "$pattern" "$MOCK_LOG" || {
    echo "Expected mock call matching: $pattern"
    echo "Actual calls:"
    cat "$MOCK_LOG"
    return 1
  }
}
