#!/usr/bin/env bash
# Deterministic regressions for trusted hooks, local-file provisioning, and the
# quality-gate worktree integrity guard.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
guard="$repository_root/scripts/guard-git-worktree-test.sh"
installer="$repository_root/scripts/install-git-hooks.sh"
provisioner="$repository_root/scripts/provision-worktree-local-files.sh"
pre_commit_hook="$repository_root/.githooks/pre-commit"
post_checkout_hook="$repository_root/.githooks/post-checkout"
temporary_root="$(mktemp -d)"

while IFS= read -r git_local_env_var; do
  unset "$git_local_env_var"
done < <(git rev-parse --local-env-vars)

cleanup() {
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

fail() {
  printf 'Worktree tooling regression failed: %s\n' "$1" >&2
  exit 1
}

assert_mode() {
  local expected="$1"
  local path="$2"
  local actual

  actual="$(stat -c '%a' "$path")"
  [[ "$actual" == "$expected" ]] || fail "expected $path mode $expected, got $actual"
}

for executable in "$guard" "$installer" "$provisioner" "$pre_commit_hook" "$post_checkout_hook"; do
  [[ -x "$executable" && -f "$executable" && ! -L "$executable" ]] \
    || fail "required executable is missing or unsafe: $executable"
  bash -n "$executable"
done
grep -Fqx 'exec uv run --project "$repository_root/backend" pre-commit run --hook-stage pre-commit' "$pre_commit_hook" \
  || fail 'the pre-commit hook must keep pre-commit at the linked-worktree root.'

new_fixture() {
  local name="$1"
  local hooks_path="${2:-}"
  local fixture="$temporary_root/$name"

  git init --quiet "$fixture"
  git -C "$fixture" config user.name "League Analysis worktree regression"
  git -C "$fixture" config user.email "league-analysis-worktree@example.invalid"
  if [[ -n "$hooks_path" ]]; then
    git -C "$fixture" config --local core.hooksPath "$hooks_path"
  fi
  mkdir -p -- "$fixture/.githooks" "$fixture/scripts"
  cp -- "$pre_commit_hook" "$fixture/.githooks/pre-commit"
  cp -- "$post_checkout_hook" "$fixture/.githooks/post-checkout"
  cp -- "$installer" "$fixture/scripts/install-git-hooks.sh"
  cp -- "$provisioner" "$fixture/scripts/provision-worktree-local-files.sh"
  chmod 755 -- \
    "$fixture/.githooks/pre-commit" \
    "$fixture/.githooks/post-checkout" \
    "$fixture/scripts/install-git-hooks.sh" \
    "$fixture/scripts/provision-worktree-local-files.sh"
  printf '.env\n.worktree-local-file.*\n' > "$fixture/.gitignore"
  printf 'fixture\n' > "$fixture/tracked.txt"
  git -C "$fixture" add .githooks .gitignore scripts tracked.txt
  git -C "$fixture" commit --quiet -m "Add worktree fixture"
  "$fixture/scripts/install-git-hooks.sh" >/dev/null

  printf '%s\n' "$fixture"
}

common_git_dir() {
  git -C "$1" rev-parse --path-format=absolute --git-common-dir
}

trusted_hook_dir() {
  printf '%s/league-analysis-trusted-hooks/current\n' "$(common_git_dir "$1")"
}

# The guard succeeds in a primary checkout and preserves the wrapped status.
guard_primary="$temporary_root/guard-primary"
git init --quiet "$guard_primary"
git -C "$guard_primary" config --local core.bare false
"$guard" --repository "$guard_primary" -- true
set +e
"$guard" --repository "$guard_primary" -- bash -c 'exit 23'
wrapped_status=$?
set -e
[[ "$wrapped_status" -eq 23 ]] || fail "guard changed wrapped exit status 23 to $wrapped_status"

# Every protected local marker is compared before and after execution.
git -C "$guard_primary" config --local league-analysis.trustedhookspath trusted-before
guard_mutation_output="$temporary_root/guard-mutation-output"
if "$guard" --repository "$guard_primary" -- \
  git -C "$guard_primary" config --local league-analysis.trustedhookspath trusted-after \
  >"$guard_mutation_output" 2>&1; then
  fail "guard accepted a trusted-hook marker mutation"
fi
grep -Fq 'local league-analysis.trustedhookspath changed' "$guard_mutation_output" \
  || fail "guard did not diagnose the trusted-hook marker mutation"

# Primary and linked worktree identity must share a common directory but have
# distinct per-worktree Git directories, and both must pass the guard.
identity_primary="$temporary_root/identity-primary"
identity_linked="$temporary_root/identity-linked"
git init --quiet "$identity_primary"
git -C "$identity_primary" config user.name "League Analysis identity regression"
git -C "$identity_primary" config user.email "league-analysis-identity@example.invalid"
printf 'identity\n' > "$identity_primary/tracked.txt"
git -C "$identity_primary" add tracked.txt
git -C "$identity_primary" commit --quiet -m "Add identity fixture"
git -C "$identity_primary" worktree add --quiet -b identity-linked "$identity_linked" HEAD
primary_git_dir="$(git -C "$identity_primary" rev-parse --path-format=absolute --git-dir)"
linked_git_dir="$(git -C "$identity_linked" rev-parse --path-format=absolute --git-dir)"
primary_common_dir="$(common_git_dir "$identity_primary")"
linked_common_dir="$(common_git_dir "$identity_linked")"
[[ "$primary_git_dir" != "$linked_git_dir" && "$primary_common_dir" == "$linked_common_dir" ]] \
  || fail "primary and linked worktree identity was not distinguished"
"$guard" --repository "$identity_primary" -- true
"$guard" --repository "$identity_linked" -- true

# Rewriting one linked worktree to another worktree's Git file must fail
# closed and identify the changed per-worktree directory.
identity_second="$temporary_root/identity-second"
git -C "$identity_primary" worktree add --quiet -b identity-second "$identity_second" HEAD
identity_output="$temporary_root/identity-output"
if "$guard" --repository "$identity_linked" -- \
  bash -c 'cp -- "$2/.git" "$1/.git"' bash "$identity_linked" "$identity_second" \
  >"$identity_output" 2>&1; then
  fail "guard accepted a linked-worktree Git-directory rewrite"
fi
grep -Fq 'git directory changed' "$identity_output" \
  || fail "guard did not diagnose a linked-worktree Git-directory rewrite"

# TERM must stop the complete guarded process group, retain signal semantics,
# and prevent a delayed descendant from mutating state.
signal_fixture="$temporary_root/signal-fixture"
signal_descendant_marker="$temporary_root/signal-descendant-survived"
git init --quiet "$signal_fixture"
git -C "$signal_fixture" config --local core.bare false
set +e
"$guard" --repository "$signal_fixture" -- \
  bash -c '(trap "" TERM; sleep 0.5; : > "$1") & kill -TERM "$PPID"; sleep 30' \
  bash "$signal_descendant_marker" >/dev/null 2>&1
signal_status=$?
set -e
[[ "$signal_status" -eq 143 ]] || fail "guard returned $signal_status instead of 143 after TERM"
sleep 1
[[ ! -e "$signal_descendant_marker" ]] || fail "a guarded descendant survived TERM"

# Installing hooks creates a private atomic snapshot and shared trusted ignore
# rules without using worktree-controlled hook files at checkout time.
source_fixture="$(new_fixture source-copy)"
source_trusted_hook_dir="$(trusted_hook_dir "$source_fixture")"
source_common_git_dir="$(common_git_dir "$source_fixture")"
source_exclude_file="$source_common_git_dir/info/exclude"
[[ -L "$source_trusted_hook_dir" ]] || fail "trusted hook selector is not a symlink"
[[ "$(git -C "$source_fixture" config --local --get core.hooksPath)" == "$source_trusted_hook_dir" ]] \
  || fail "trusted hooks path was not installed"
[[ "$(git -C "$source_fixture" config --local --get league-analysis.trustedhookspath)" == "$source_trusted_hook_dir" ]] \
  || fail "trusted hook ownership marker was not installed"
assert_mode 600 "$source_exclude_file"
for trusted_file in pre-commit post-checkout provision-worktree-local-files.sh; do
  [[ -x "$source_trusted_hook_dir/$trusted_file" ]] || fail "trusted snapshot is missing $trusted_file"
  assert_mode 700 "$source_trusted_hook_dir/$trusted_file"
done
for trusted_pattern in .env .worktree-local-file.'*'; do
  grep -Fqx -- "$trusted_pattern" "$source_exclude_file" \
    || fail "trusted shared exclusion is missing $trusted_pattern"
done
chmod 644 -- "$source_exclude_file"
"$source_fixture/scripts/install-git-hooks.sh" >/dev/null
assert_mode 600 "$source_exclude_file"

# A clean worktree creation copies only the allowlisted root .env, keeps the
# source mode unchanged, sets mode 600, and records private provenance.
printf 'LOCAL_CONFIG=fixture-source\n' > "$source_fixture/.env"
chmod 644 -- "$source_fixture/.env"
copied_worktree="$temporary_root/source-copy-linked"
git -C "$source_fixture" worktree add --quiet -b source-copy-linked "$copied_worktree" HEAD
cmp -- "$source_fixture/.env" "$copied_worktree/.env" \
  || fail "new worktree .env does not match the primary fixture"
assert_mode 644 "$source_fixture/.env"
assert_mode 600 "$copied_worktree/.env"
for ignored_path in .env .worktree-local-file.trusted-ignore-check; do
  git -C "$copied_worktree" check-ignore --quiet --no-index -- "$ignored_path" \
    || fail "$ignored_path is not effectively ignored"
done
copied_git_dir="$(git -C "$copied_worktree" rev-parse --path-format=absolute --git-dir)"
copied_marker="$copied_git_dir/league-analysis-provisioned-local-files/.env"
[[ -d "$copied_marker" && ! -L "$copied_marker" ]] || fail "provisioned .env has no private provenance"
assert_mode 700 "$copied_marker"
assert_mode 600 "$copied_marker/identity"

# A target regular file is never overwritten and is never marked provisioned.
existing_target="$temporary_root/existing-target-linked"
git -C "$source_fixture" worktree add --quiet --no-checkout -b existing-target-linked "$existing_target" HEAD
printf 'LOCAL_CONFIG=target-specific\n' > "$existing_target/.env"
chmod 640 -- "$existing_target/.env"
git -C "$existing_target" checkout --quiet existing-target-linked
[[ "$(<"$existing_target/.env")" == 'LOCAL_CONFIG=target-specific' ]] \
  || fail "existing target .env was overwritten"
assert_mode 640 "$existing_target/.env"
existing_target_git_dir="$(git -C "$existing_target" rev-parse --path-format=absolute --git-dir)"
[[ ! -e "$existing_target_git_dir/league-analysis-provisioned-local-files/.env" ]] \
  || fail "user-created .env was marked as provisioned"

# Existing and broken target symlinks are preserved without dereferencing.
symlink_target="$temporary_root/symlink-target-linked"
git -C "$source_fixture" worktree add --quiet --no-checkout -b symlink-target-linked "$symlink_target" HEAD
ln -s -- "$temporary_root/does-not-exist" "$symlink_target/.env"
git -C "$symlink_target" checkout --quiet symlink-target-linked
[[ -L "$symlink_target/.env" && "$(readlink -- "$symlink_target/.env")" == "$temporary_root/does-not-exist" ]] \
  || fail "target .env symlink was overwritten or dereferenced"

# A later branch that exposes .env removes only a copy with matching private
# provenance; the user-created target above remains intact.
source_primary_branch="$(git -C "$source_fixture" branch --show-current)"
git -C "$source_fixture" checkout --quiet -b expose-local-file
printf '!.env\n.worktree-local-file.*\n' > "$source_fixture/.gitignore"
git -C "$source_fixture" add .gitignore
# This disposable fixture has no backend environment; its later commit exists
# only to exercise post-checkout behavior, not the repository pre-commit gate.
git -c core.hooksPath=/dev/null -C "$source_fixture" commit --quiet -m "Expose local fixture"
git -C "$source_fixture" checkout --quiet "$source_primary_branch"
git -C "$source_fixture" branch expose-user-local-file expose-local-file
git -C "$copied_worktree" checkout --quiet expose-local-file
[[ ! -e "$copied_worktree/.env" && ! -L "$copied_worktree/.env" ]] \
  || fail "provisioned .env remained after branch rules exposed it"
[[ ! -e "$copied_marker" && ! -L "$copied_marker" ]] \
  || fail "removed provisioned .env retained stale provenance"
git -C "$existing_target" checkout --quiet expose-user-local-file
[[ "$(<"$existing_target/.env")" == 'LOCAL_CONFIG=target-specific' ]] \
  || fail "provisioner removed a user-created .env without provenance"

# Missing shared ignore rules fail safely and leave no target or temporary
# secret-bearing file behind.
untrusted_fixture="$(new_fixture missing-trusted-ignore)"
printf 'LOCAL_CONFIG=fixture-source\n' > "$untrusted_fixture/.env"
untrusted_exclude_file="$(common_git_dir "$untrusted_fixture")/info/exclude"
printf '# intentionally empty fixture exclusions\n' > "$untrusted_exclude_file"
untrusted_target="$temporary_root/missing-trusted-ignore-linked"
git -C "$untrusted_fixture" worktree add --quiet -b missing-trusted-ignore-linked "$untrusted_target" HEAD
[[ ! -e "$untrusted_target/.env" && ! -L "$untrusted_target/.env" ]] \
  || fail "provisioner copied .env without trusted shared ignores"
if compgen -G "$untrusted_target/.worktree-local-file.*" >/dev/null; then
  fail "failed provisioning left a temporary local file"
fi

# A symlink source is not eligible for copying.
source_symlink_fixture="$(new_fixture source-symlink)"
printf 'not-a-secret-fixture\n' > "$temporary_root/source-symlink-value"
ln -s -- "$temporary_root/source-symlink-value" "$source_symlink_fixture/.env"
source_symlink_target="$temporary_root/source-symlink-linked"
git -C "$source_symlink_fixture" worktree add --quiet -b source-symlink-linked "$source_symlink_target" HEAD
[[ ! -e "$source_symlink_target/.env" && ! -L "$source_symlink_target/.env" ]] \
  || fail "provisioner followed a symlink source"

# A malicious branch cannot replace the installed post-checkout hook or
# provisioner because Git executes the trusted snapshot under the shared dir.
malicious_fixture="$(new_fixture malicious-branch)"
printf 'LOCAL_CONFIG=fixture-source\n' > "$malicious_fixture/.env"
malicious_primary_branch="$(git -C "$malicious_fixture" branch --show-current)"
malicious_marker="$temporary_root/malicious-hook-executed"
git -C "$malicious_fixture" checkout --quiet -b malicious-checkout
printf '#!/usr/bin/env bash\nprintf %%s malicious > "$MALICIOUS_MARKER"\n' > "$malicious_fixture/.githooks/post-checkout"
printf '#!/usr/bin/env bash\nprintf %%s malicious > "$MALICIOUS_MARKER"\n' > "$malicious_fixture/scripts/provision-worktree-local-files.sh"
chmod 755 -- "$malicious_fixture/.githooks/post-checkout" "$malicious_fixture/scripts/provision-worktree-local-files.sh"
git -C "$malicious_fixture" add .githooks/post-checkout scripts/provision-worktree-local-files.sh
git -c core.hooksPath=/dev/null -C "$malicious_fixture" commit --quiet -m "Add untrusted checkout code"
git -C "$malicious_fixture" checkout --quiet "$malicious_primary_branch"
malicious_target="$temporary_root/malicious-target"
MALICIOUS_MARKER="$malicious_marker" git -C "$malicious_fixture" worktree add --quiet "$malicious_target" malicious-checkout
[[ ! -e "$malicious_marker" ]] || fail "branch-controlled checkout code executed"
cmp -- "$malicious_fixture/.env" "$malicious_target/.env" \
  || fail "trusted provisioner did not run for the malicious-branch fixture"

# An unrelated custom hook manager is an owner boundary and remains untouched.
custom_fixture="$(new_fixture custom-hook-manager custom-hooks)"
[[ "$(git -C "$custom_fixture" config --local --get core.hooksPath)" == 'custom-hooks' ]] \
  || fail "installer overwrote an unrelated custom hooks path"

printf 'Worktree tooling regression checks passed.\n'
