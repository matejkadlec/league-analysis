#!/usr/bin/env bash
# Fail when any scanned block is above rank B (CC > 10).
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root/backend"

exec uv run xenon --max-absolute B app
