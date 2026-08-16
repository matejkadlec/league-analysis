#!/usr/bin/env bash
# Run the repository's own architecture rules through pre-commit.
#
# Only `repo: local` hooks are handed to pre-commit, and they are handed over
# in a generated configuration that names nothing else. pre-commit clones every
# remote repository in a configuration before it looks at which hooks were
# asked for, so pointing it at .pre-commit-config.yaml would download hook
# environments while the gate runs. The hook definitions still live in
# .pre-commit-config.yaml alone: this script selects, it never restates them.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root
source_configuration="$repository_root/.pre-commit-config.yaml"
readonly source_configuration

precommit_binary="${PRE_COMMIT_BINARY:-}"
if [[ -z "$precommit_binary" ]]; then
  precommit_binary="$(command -v pre-commit || true)"
fi
if [[ -n "$precommit_binary" ]]; then
  precommit=("$precommit_binary")
  # pre-commit depends on PyYAML, so the interpreter installed beside it can
  # always read the configuration this script filters.
  precommit_python=("$(dirname "$(readlink -f "$precommit_binary")")/python3")
elif command -v uv >/dev/null 2>&1; then
  precommit=(uv run --project "$repository_root/backend" --locked pre-commit)
  precommit_python=(uv run --project "$repository_root/backend" --locked python3)
else
  printf 'ERROR: pre-commit is required and is not installed.\n' >&2
  printf 'It ships in the gate container; run the gate through compose.gate.yml.\n' >&2
  exit 1
fi

staging_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-local-hooks.XXXXXX")"
cleanup() {
  rm -rf -- "$staging_directory"
}
trap cleanup EXIT
generated_configuration="$staging_directory/local-hooks.yaml"

cd "$repository_root"
"${precommit_python[@]}" - "$source_configuration" "$generated_configuration" <<'GENERATE_CONFIGURATION'
"""Copy the gate's `repo: local` hooks into a configuration of their own."""
import sys

import yaml

source_path, target_path = sys.argv[1], sys.argv[2]

# Rules with no dependency of their own. The gate is their only enforcement
# outside a developer machine that opted into .githooks/pre-commit.
GATE_HOOKS = (
    "forbid-credential-filenames",
    "forbid-non-kebab-frontend-filenames",
    "forbid-core-importing-features",
    "forbid-metadata-create-all",
    "forbid-direct-axios",
    "forbid-direct-fetch",
    "forbid-hardcoded-ddragon-url",
    "forbid-icon-library-objective-icons",
    "forbid-nextjs-middleware",
    "check-docs-links",
)

# Local hooks ./test.sh already runs as steps of its own, against the locked
# project rather than through pre-commit. Naming them, instead of ignoring
# every unlisted hook, is what makes a new local hook a decision: it either
# runs here or it is claimed by a step, and nothing else passes silently.
COVERED_BY_A_GATE_STEP = (
    "backend-bandit",
    "backend-pyright",
    "backend-vulture",
    "backend-deptry",
    "backend-xenon",
    "frontend-lint",
    "frontend-typecheck",
    "shellcheck",
    "actionlint",
)

with open(source_path, encoding="utf-8") as handle:
    configuration = yaml.safe_load(handle)

selected = []
unclassified = []
for repository in configuration["repos"]:
    if repository["repo"] != "local":
        continue
    for hook in repository["hooks"]:
        if hook["id"] in GATE_HOOKS:
            selected.append(hook)
        elif hook["id"] not in COVERED_BY_A_GATE_STEP:
            unclassified.append(hook["id"])

missing = [
    hook_id
    for hook_id in GATE_HOOKS
    if hook_id not in {hook["id"] for hook in selected}
]
if unclassified or missing:
    for hook_id in unclassified:
        print(
            f"ERROR: local hook '{hook_id}' is not claimed by a gate step; add "
            f"it to GATE_HOOKS or to COVERED_BY_A_GATE_STEP in "
            f"scripts/run-local-precommit-hooks.sh.",
            file=sys.stderr,
        )
    for hook_id in missing:
        print(
            f"ERROR: local hook '{hook_id}' is expected by the gate but is no "
            f"longer in {source_path}.",
            file=sys.stderr,
        )
    raise SystemExit(1)

generated = {"repos": [{"repo": "local", "hooks": selected}]}
# The stage and the corpus-wide exclusions are properties of the rules, not of
# the file they are declared in, so they travel with the hooks.
for key in ("default_stages", "default_language_version", "exclude"):
    if key in configuration:
        generated[key] = configuration[key]

with open(target_path, "w", encoding="utf-8") as handle:
    yaml.safe_dump(generated, handle, sort_keys=False)
GENERATE_CONFIGURATION

"${precommit[@]}" run \
  --all-files \
  --hook-stage pre-commit \
  --config "$generated_configuration"
