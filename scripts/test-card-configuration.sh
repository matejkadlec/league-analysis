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

contains "$document" '| Unknown card ID on a legacy read |'
contains "$document" 'version-coexistent'
contains "$document" 'version-conflict response'
contains "$document" 'totalKills + totalAssists'
contains "$document" 'Do not average per-match KDA'
contains "$document" 'greater than or equal to their configured minimum'
contains "$document" 'Equality at the default 0% and 0 KDA thresholds remains'
contains "$document" 'eligible, as does a one-game aggregate at the default minimum-games value.'
absent "$document" '3. Apply `minimumGames`'
contains "$document" '| Known card ID with a future version on a legacy read, with no supported row |'
absent "$document" '| Unknown card ID or future version |'
contains "$document" '| Legacy record with an unknown or removed setting |'
contains "$document" '| Write with an unknown or removed setting |'
contains "$document" 'Reject the entire update atomically.'
absent "$document" '| Unknown or removed setting | Ignore only'

contains "$document" 'intentional LGA-25 display-label change'
contains "$document" 'actual-sample-size label instead of `Recent 10 games`'
absent "$document" 'so only the order of tied rows may change'

contains "$document" 'Normalize exactly one entry per card.'
contains "$document" 'The current v1 row takes precedence'
contains "$document" '| Write with an unknown card ID or unsupported version |'
contains "$document" 'Reject the entire update atomically before persistence.'
absent "$document" '| Unknown card ID | Do not apply or normalize it.'

contains "$document" 'at most 10,000 matches'
contains "$document" 'Recent Performance KDA uses aggregate participant totals:'
contains "$document" 'For Recent Performance, do not average'
absent "$document" 'KDA is an average of per-match KDA values'
contains "$document" 'directional difference strictly exceeds'
contains "$document" 'equality at the configured tolerance is stable'
contains "$document" '`overallMetric * relativeMetricTrendDelta` as its tolerance'
absent "$document" 'directional difference meets or exceeds'
contains "$document" 'already-implemented deterministic tie ordering'
contains "$document" 'canonical champion name in ascending lexicographic order'
absent "$document" 'all matching matches, exactly as the card does today'
contains "$document" 'displays a mixed/custom state'
contains "$document" 'Changing another setting preserves both'
contains "$document" 'Minimum games is an owner-approved aggregate threshold'
absent "$document" 'landing page explicitly calls out win-rate, KDA, games-played'

printf 'Card configuration regression passed.\n'
