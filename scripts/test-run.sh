#!/usr/bin/env bash
# Regression coverage for run.sh selected-port cleanup without touching live ports.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_script="$repository_root/run.sh"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-run-test.XXXXXX")"
listener_pids=()

fail() {
  printf 'run.sh regression failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  local pid
  for pid in "${listener_pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf -- "$test_directory"
}
trap cleanup EXIT

[[ -x "$run_script" ]] || fail 'run.sh must be executable.'
bash -n "$run_script"

cat > "$test_directory/lsof" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

port=""
for argument in "$@"; do
  case "$argument" in
    -tiTCP:*)
      port="${argument#-tiTCP:}"
      ;;
  esac
done

printf 'lsof:%s\n' "$port" >> "$LGA_RUN_TEST_CALL_LOG"

if [[ "${LGA_RUN_TEST_LISTENER_LOOKUP:-lsof}" == "fuser" ]]; then
  exit 0
fi

case "$port" in
  3000) pid="$LGA_RUN_TEST_PORT_3000_PID" ;;
  3001) pid="$LGA_RUN_TEST_PORT_3001_PID" ;;
  8000) pid="$LGA_RUN_TEST_PORT_8000_PID" ;;
  8001) pid="$LGA_RUN_TEST_PORT_8001_PID" ;;
  *) exit 0 ;;
esac

state="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
if [[ -n "$state" && ! "$state" =~ ^[[:space:]]*Z ]]; then
  printf '%s\n' "$pid"
fi
EOF

cat > "$test_directory/fuser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

port="${!#}"
printf 'fuser:%s\n' "$port" >> "$LGA_RUN_TEST_CALL_LOG"

case "$port" in
  3000) pid="$LGA_RUN_TEST_PORT_3000_PID" ;;
  3001) pid="$LGA_RUN_TEST_PORT_3001_PID" ;;
  8000) pid="$LGA_RUN_TEST_PORT_8000_PID" ;;
  8001) pid="$LGA_RUN_TEST_PORT_8001_PID" ;;
  *) exit 1 ;;
esac

state="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
if [[ -n "$state" && ! "$state" =~ ^[[:space:]]*Z ]]; then
  printf '%s\n' "$pid"
fi
EOF

cat > "$test_directory/psql" <<'EOF'
#!/usr/bin/env bash
printf 'psql\n' >> "$LGA_RUN_TEST_CALL_LOG"
exit 1
EOF
chmod 700 "$test_directory/lsof" "$test_directory/fuser" "$test_directory/psql"

pid_is_alive() {
  local pid="$1"
  local state
  state="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
  [[ -n "$state" && ! "$state" =~ ^[[:space:]]*Z ]]
}

start_fake_listener() {
  local variable_name="$1"
  sleep 600 &
  listener_pids+=("$!")
  printf -v "$variable_name" '%s' "$!"
}

is_expected_port() {
  local expected_ports="$1"
  local port="$2"
  local expected_port
  for expected_port in $expected_ports; do
    [[ "$expected_port" == "$port" ]] && return 0
  done
  return 1
}

run_case() {
  local name="$1"
  local expected_ports="$2"
  local listener_lookup="$3"
  shift 3
  local case_directory="$test_directory/$name"
  local call_log="$case_directory/calls.log"
  local status
  local port
  local pid
  local port_3000_pid
  local port_3001_pid
  local port_8000_pid
  local port_8001_pid

  mkdir -p "$case_directory"
  cp "$run_script" "$case_directory/run.sh"
  chmod 700 "$case_directory/run.sh"

  start_fake_listener port_3000_pid
  start_fake_listener port_3001_pid
  start_fake_listener port_8000_pid
  start_fake_listener port_8001_pid
  export LGA_RUN_TEST_PORT_3000_PID="$port_3000_pid"
  export LGA_RUN_TEST_PORT_3001_PID="$port_3001_pid"
  export LGA_RUN_TEST_PORT_8000_PID="$port_8000_pid"
  export LGA_RUN_TEST_PORT_8001_PID="$port_8001_pid"
  export LGA_RUN_TEST_CALL_LOG="$call_log"

  set +e
  LGA_RUN_TEST_LISTENER_LOOKUP="$listener_lookup" PATH="$test_directory:$PATH" "$case_directory/run.sh" "$@" > "$case_directory/output.log" 2>&1
  status=$?
  set -e

  [[ "$status" -eq 1 ]] || fail "$name should stop at the fake PostgreSQL check."
  grep -Fxq 'psql' "$call_log" || fail "$name did not reach the PostgreSQL check after cleanup."

  for port in 3000 3001 8000 8001; do
    pid="$(printenv "LGA_RUN_TEST_PORT_${port}_PID")"
    if is_expected_port "$expected_ports" "$port"; then
      ! pid_is_alive "$pid" || fail "$name did not stop the listener for port $port."
      grep -Fxq "lsof:$port" "$call_log" || fail "$name did not inspect port $port."
      grep -Fxq "fuser:$port" "$call_log" || fail "$name did not inspect port $port with fuser."
    else
      pid_is_alive "$pid" || fail "$name stopped an unselected port $port."
      if grep -Fxq "lsof:$port" "$call_log"; then
        fail "$name inspected unselected port $port."
      fi
    fi
  done
}

run_case default '3000 8000' lsof
run_case frontend_override '3001 8000' lsof 3001
run_case custom_ports '3001 8001' lsof 3001 8001
run_case fuser_fallback '3001 8001' fuser 3001 8001

printf 'run.sh port cleanup regression passed.\n'
