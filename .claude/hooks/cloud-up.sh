#!/usr/bin/env bash
# Claude Code SessionStart hook (async, startup and resume), and the command a
# cloud session runs by hand when it needs the setup before the hook finished.
# In a cloud session it prepares the clone, under one lock:
#   1. points Git at the tracked hooks (`core.hooksPath .githooks`) when unset,
#      so commits run .githooks/pre-commit;
#   2. installs the Node version `.nvmrc` pins when the image lacks it;
#   3. runs the environment's `lga-cloud-up` helper (PostgreSQL 18, `uv sync`,
#      `npm ci`, the local `.env`);
#   4. installs the Chromium build the pinned @playwright/test needs.
# The lock makes a second run wait for the first: two `npm ci` runs in
# frontend/ at once can leave a broken install behind a valid stamp. A run that
# waited repeats the steps, which then find everything in place.
# The helper belongs to the cloud environment, not to this repository, so the
# hook exits at once on a local machine or wherever the helper is missing.
# Output: logs/lga-cloud-up.log (gitignored); its last line is `exit <status>`.
set -uo pipefail

[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0
command -v lga-cloud-up >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$root" || exit 0
mkdir -p logs
log="logs/lga-cloud-up.log"
lock="${TMPDIR:-/tmp}/lga-cloud-up.lock"

set_hooks_path() {
  if [[ -z "$(git config --get core.hooksPath || true)" ]]; then
    git config core.hooksPath .githooks || return 1
    printf 'core.hooksPath set to .githooks\n'
  fi
}

install_pinned_node() {
  local pinned
  pinned="$(tr -d '[:space:]' < .nvmrc)"
  if [[ -z "${NVM_DIR:-}" || ! -s "$NVM_DIR/nvm.sh" ]]; then
    NVM_DIR="$(cat "$HOME/.config/league-analysis/nvm-dir" 2>/dev/null || echo /opt/nvm)"
  fi
  export NVM_DIR
  [[ -s "$NVM_DIR/nvm.sh" ]] || return 0
  # nvm reads unset variables, so it runs without nounset.
  set +u
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh" || { set -u; return 1; }
  if ! nvm ls "$pinned" >/dev/null 2>&1; then
    printf 'Installing Node %s pinned by .nvmrc\n' "$pinned"
    nvm install "$pinned" || { set -u; return 1; }
  fi
  set -u
}

install_pinned_chromium() {
  (
    # shellcheck disable=SC1091
    source tools/use-project-node.sh || exit 1
    cd frontend || exit 1
    # The image sets PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD; this one install must
    # download. It does nothing when the pinned build is already present.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='' npx --no-install playwright install chromium
  )
}

cloud_up() {
  set_hooks_path || return 1
  install_pinned_node || return 1
  lga-cloud-up || return 1
  install_pinned_chromium || return 1
}

(
  flock 9 || exit 1
  {
    printf 'lga-cloud-up started %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cloud_up
    printf 'exit %s\n' "$?"
  } >"$log" 2>&1
) 9>"$lock"
exit 0
