"""Pure rank arithmetic and duo classification for matchmaking analysis.

No session, no client, no service state -- everything here is testable
without constructing a `MatchmakingAnalysisService`.
"""

from collections import Counter
from dataclasses import dataclass
from statistics import fmean

from app.core.enums import Tier

UNRANKED = "UNRANKED"

# LP-equivalent scale: each tier spans 400 points (4 divisions x 100 LP).
# MASTER and above have no divisions and uncapped LP, so they continue the
# scale from the shared floor: DIAMOND I 100 LP == MASTER 0 LP == 2800.
_TIER_INDEX = {tier.value: index for index, tier in enumerate(Tier)}
_DIVISION_OFFSET = {"IV": 0, "III": 100, "II": 200, "I": 300}
MASTER_FLOOR = _TIER_INDEX[Tier.MASTER.value] * 400

# The frontend formatter `rankValueToDisplay` mirrors this scale; the shared
# fixtures in `test_matchmaking_ranks.py` / `rank-display.test.ts` guard drift.


def rank_value(tier: str, rank: str | None, league_points: int) -> int:
    """Map a league entry to one comparable LP-equivalent scalar."""
    tier_index = _TIER_INDEX[tier]
    if tier_index * 400 >= MASTER_FLOOR:
        return MASTER_FLOOR + league_points
    division_offset = _DIVISION_OFFSET[rank] if rank else 0
    return tier_index * 400 + division_offset + league_points


@dataclass(frozen=True)
class RankSummary:
    """Per-side rank aggregates over the unique players of one run."""

    ally_avg_rank_value: float | None
    enemy_avg_rank_value: float | None
    ally_tier_counts: dict[str, int]
    enemy_tier_counts: dict[str, int]


def _side_summary(
    puuids: set[str],
    tiers: dict[str, str],
    values: dict[str, int | None],
) -> tuple[float | None, dict[str, int]]:
    counts = Counter(tiers.get(puuid, UNRANKED) for puuid in puuids)
    ranked = [value for puuid in puuids if (value := values.get(puuid)) is not None]
    average = round(fmean(ranked), 1) if ranked else None
    return average, dict(counts)


def summarize_ranks(
    ally_puuids: set[str],
    enemy_puuids: set[str],
    tiers: dict[str, str],
    values: dict[str, int | None],
) -> RankSummary:
    """Aggregate cached per-player ranks into per-side averages and buckets.

    A player seen as ally in one spine match and enemy in another counts once
    per side. Unranked players sit in the UNRANKED bucket and are excluded
    from the averages -- never averaged in as 0.
    """
    ally_avg, ally_counts = _side_summary(ally_puuids, tiers, values)
    enemy_avg, enemy_counts = _side_summary(enemy_puuids, tiers, values)
    return RankSummary(
        ally_avg_rank_value=ally_avg,
        enemy_avg_rank_value=enemy_avg,
        ally_tier_counts=ally_counts,
        enemy_tier_counts=enemy_counts,
    )


def classify_duo_matches(
    spine_allies: list[tuple[str, list[str]]],
) -> dict[str, bool]:
    """Flag each spine match as a likely duo game.

    ``spine_allies`` pairs each spine match id with the analyzed player's
    teammates (their own puuid excluded). A match counts as duo when any
    teammate recurs on the analyzed player's side in >= 2 spine matches.

    # ponytail: co-occurrence heuristic -- match-v5 carries no party data, so
    # false positives are possible at small windows; tighten from stored
    # per_match data if it matters.
    """
    appearances = Counter(
        puuid for _match_id, allies in spine_allies for puuid in set(allies)
    )
    return {
        match_id: any(appearances[puuid] >= 2 for puuid in allies)
        for match_id, allies in spine_allies
    }
