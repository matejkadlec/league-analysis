#!/usr/bin/env bash
# GitHub-only live comparison of locked production dependency audits.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly repository_root
base_revision="${1:-HEAD^}"

exec python3 "$repository_root/scripts/dependency-audit.py" "$base_revision"
