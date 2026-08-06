#!/usr/bin/env bash
# Guard the reviewed LGA-23 contract against the resolved contradictions.
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
document="$repository_root/docs/card-configuration.md"
index="$repository_root/docs/README.md"

fail() {
  printf 'Card configuration regression failed: %s\n' "$1" >&2
  exit 1
}

contains() {
  local path="$1"
  local text="$2"
  grep -Fq -- "$text" "$path" || fail "$path is missing: $text"
}

absent() {
  local path="$1"
  local text="$2"
  if grep -Fq -- "$text" "$path"; then
    fail "$path still contains: $text"
  fi
}

contains "$index" 'Configurable card catalog (LGA-23 approved contract)'
contains "$index" 'Owner-approved v1 catalog'
absent "$index" '| Configurable card catalog (LGA-23 proposal) |'

contains "$document" 'up to five eligible rows'
contains "$document" 'never pads or fabricates rows'
absent "$document" 'exactly five visible rows'

contains "$document" 'type CardSettingsById'
contains "$document" 'settings: CardSettingsById[TCardId];'
absent "$document" 'interface CardPreferenceV1<TCardId extends CardId, TSettings>'

contains "$document" '| Unknown card ID |'
contains "$document" 'version-coexistent'
contains "$document" 'version-conflict response'
contains "$document" 'totalKills + totalAssists'
contains "$document" 'Do not average per-match KDA'
contains "$document" '| Known card ID with a future version |'
absent "$document" '| Unknown card ID or future version |'
contains "$document" '| Legacy record with an unknown or removed setting |'
contains "$document" '| Write with an unknown or removed setting |'
contains "$document" 'Reject the entire update atomically.'
absent "$document" '| Unknown or removed setting | Ignore only'

contains "$document" 'at most 10,000 matches'
contains "$document" 'old tie sequence was unspecified'
contains "$document" 'canonical champion name in ascending lexicographic order'
absent "$document" 'all matching matches, exactly as the card does today'
contains "$document" 'displays a mixed/custom state'
contains "$document" 'Changing another setting preserves both'
contains "$document" 'Minimum games is an owner-approved aggregate threshold'
absent "$document" 'landing page explicitly calls out win-rate, KDA, games-played'

printf 'Card configuration regression passed.\n'
