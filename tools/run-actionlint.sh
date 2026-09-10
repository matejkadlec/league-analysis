#!/usr/bin/env bash
# Validate tracked GitHub workflows with the pinned actionlint release.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root expected_version='1.7.12'
actionlint_binary="${ACTIONLINT_BINARY:-}"

if [[ -z "$actionlint_binary" ]]; then
  actionlint_binary="$(command -v actionlint || true)"
fi
if [[ -z "$actionlint_binary" ]]; then
  cache_directory="${XDG_CACHE_HOME:-$HOME/.cache}/league-analysis/actionlint-${expected_version}"
  actionlint_binary="$cache_directory/actionlint"
  "$repository_root/tools/install-actionlint.sh" "$cache_directory" >/dev/null
fi

[[ -x "$actionlint_binary" ]] || {
  printf 'ERROR: actionlint is not executable: %s\n' "$actionlint_binary" >&2
  exit 1
}
actionlint_version="$($actionlint_binary -version | head -n 1)"
[[ "$actionlint_version" == "$expected_version" ]] || {
  printf 'ERROR: actionlint %s is required.\n' "$expected_version" >&2
  exit 1
}

workflows=()
if [[ $# -gt 0 ]]; then
  workflows=("$@")
else
  mapfile -d '' -t workflows < <(
    git -C "$repository_root" ls-files --cached --others --exclude-standard -z -- \
      '.github/workflows/*.yml' '.github/workflows/*.yaml'
  )
fi
[[ ${#workflows[@]} -gt 0 ]] || {
  printf 'ERROR: no tracked GitHub workflows were found.\n' >&2
  exit 1
}
cd "$repository_root"
"$actionlint_binary" "${workflows[@]}"
