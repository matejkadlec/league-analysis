#!/usr/bin/env bash
# Scan the repository for secret values with the pinned gitleaks release.
#
# Two passes, because neither one alone is enough. The working-tree pass is the
# one a contributor can act on; the history pass catches a secret that was
# added and removed again inside the same branch, which the tree no longer
# shows. Both read the repository's own .gitleaks.toml.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root expected_version='8.30.1'
gitleaks_configuration="$repository_root/.gitleaks.toml"
readonly gitleaks_configuration
gitleaks_binary="${GITLEAKS_BINARY:-}"

if [[ -z "$gitleaks_binary" ]]; then
  gitleaks_binary="$(command -v gitleaks || true)"
fi
if [[ -z "$gitleaks_binary" ]]; then
  printf 'ERROR: gitleaks %s is required and is not installed.\n' "$expected_version" >&2
  printf 'It ships in the gate container; run the gate through compose.gate.yml.\n' >&2
  exit 1
fi
[[ -x "$gitleaks_binary" ]] || {
  printf 'ERROR: gitleaks is not executable: %s\n' "$gitleaks_binary" >&2
  exit 1
}
version_output="$("$gitleaks_binary" version)"
[[ "${version_output#v}" == "$expected_version" ]] || {
  printf 'ERROR: gitleaks %s is required.\n' "$expected_version" >&2
  exit 1
}
[[ -f "$gitleaks_configuration" ]] || {
  printf 'ERROR: the gitleaks configuration is missing: %s\n' "$gitleaks_configuration" >&2
  exit 1
}

# `gitleaks dir` takes exactly one path and silently scans the working
# directory when it is given more than one, so the files to scan are staged
# into a directory of their own. That also keeps the scan off everything git
# ignores: node_modules, .next and a populated .venv are megabytes of vendored
# strings that trip the default ruleset and belong to no commit.
scan_sources=()
while IFS= read -r -d '' path; do
  # A file staged for deletion is still listed but no longer on disk.
  [[ -e "$path" ]] || continue
  scan_sources+=("$path")
done < <(git -C "$repository_root" ls-files --cached --others --exclude-standard -z)
[[ ${#scan_sources[@]} -gt 0 ]] || {
  printf 'ERROR: no repository files were found to scan.\n' >&2
  exit 1
}

staging_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-gitleaks.XXXXXX")"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT

cd "$repository_root"
printf '%s\0' "${scan_sources[@]}" \
  | tar --create --null --files-from - --file - \
  | tar --extract --directory "$staging_directory" --file -

printf 'gitleaks: %s tracked and untracked working-tree files\n' "${#scan_sources[@]}"
(
  cd "$staging_directory"
  "$gitleaks_binary" dir \
    --config "$gitleaks_configuration" \
    --no-banner \
    --redact \
    --verbose \
    .
)

printf 'gitleaks: reachable commit history\n'
"$gitleaks_binary" git \
  --config "$gitleaks_configuration" \
  --no-banner \
  --redact \
  --verbose \
  .
