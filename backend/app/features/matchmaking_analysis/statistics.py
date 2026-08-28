"""The pure completion model of a matchmaking analysis run.

Arithmetic over already fetched winrates -- no session, client, or service
state. Duo partners are identified globally at completion time and excluded
from ally averages, just like the analyzed player.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal
from statistics import fmean, median

from .errors import MatchmakingAnalysisRuntimeError
from .models import MatchmakingAnalysisResultsJSON, MatchmakingPerMatchJSON
from .ranks import (
    PlayerRankJSON,
    RankSummary,
    classify_duo_matches,
    duo_partner_puuids,
)


def trimmed_mean(values: Sequence[float]) -> float:
    """Mean with 10% trimmed from each end -- a floor'd count, so below ten
    values nothing is trimmed and this is the plain mean.

    Mirrored by `trimmedMean` in the frontend's scope-aggregates.ts; the
    fixtures duplicated across both test suites must stay identical.
    """
    k = int(len(values) * 0.1)
    kept = sorted(values)[k : len(values) - k]
    return fmean(kept)


@dataclass(frozen=True)
class PlayerPerformance:
    """One participant's form over their trailing ranked matches.

    KDA is the median of their per-game KDAs -- single stomps or zero-death
    games skew a mean badly at this sample size. The two team-normalized
    ratios are means over the games that carry them.
    """

    kda: float
    kill_participation: float | None
    damage_share: float | None


@dataclass
class SideSamples:
    """One side's per-player winrate and form samples for a spine match."""

    winrates: dict[str, float]
    performances: dict[str, PlayerPerformance]


@dataclass(frozen=True)
class SidePerformance:
    """One side's per-metric means over the players who carry each metric."""

    kda: float | None
    kill_participation: float | None
    damage_share: float | None


def player_performance_from_rows(
    rows: Sequence[tuple[Decimal, Decimal | None, Decimal | None]],
) -> PlayerPerformance | None:
    """Fold one player's trailing (kda, kill_participation, damage_share) rows.

    Casts to float at this boundary: the columns are NUMERIC, and a Decimal in
    the results payload fails JSON serialization at finalize. The None-skip
    serves pre-column rows; modern writes store absent keys as 0, accepted.
    """
    if not rows:
        return None
    kdas = [float(kda) for kda, _, _ in rows]
    kps = [float(kp) for _, kp, _ in rows if kp is not None]
    shares = [float(share) for _, _, share in rows if share is not None]
    return PlayerPerformance(
        kda=median(kdas),
        kill_participation=fmean(kps) if kps else None,
        damage_share=fmean(shares) if shares else None,
    )


def side_performance(players: list[PlayerPerformance]) -> SidePerformance:
    """Average each metric over the players that have it, independently:
    a player whose stored games predate the ratio columns still counts
    toward the side's KDA."""

    def _mean_of(values: list[float]) -> float | None:
        return fmean(values) if values else None

    return SidePerformance(
        kda=_mean_of([p.kda for p in players]),
        kill_participation=_mean_of(
            [p.kill_participation for p in players if p.kill_participation is not None]
        ),
        damage_share=_mean_of(
            [p.damage_share for p in players if p.damage_share is not None]
        ),
    )


@dataclass(frozen=True)
class SpineMatchStats:
    """One spine match's per-player samples, keyed by puuid per side.

    Aggregation happens at completion time, once the whole spine is known:
    the duo partners can only be identified globally, and they are excluded
    from ally averages just like the analyzed player.
    """

    match_id: str
    ally_puuids: list[str]
    enemy_puuids: list[str]
    win: bool | None
    ally_winrates: dict[str, float]
    enemy_winrates: dict[str, float]
    ally_performances: dict[str, PlayerPerformance]
    enemy_performances: dict[str, PlayerPerformance]


@dataclass(frozen=True)
class _MatchAggregates:
    """One spine match's side averages after the ally-side exclusions."""

    team_avg: float | None
    enemy_avg: float | None
    team: SidePerformance
    enemy: SidePerformance


def _aggregate_match(s: SpineMatchStats, excluded: set[str]) -> _MatchAggregates:
    """Side averages excluding the players matchmaking never chose: the
    analyzed player and their inferred duo partners, ally side only."""
    team_wrs = [wr for p, wr in s.ally_winrates.items() if p not in excluded]
    enemy_wrs = list(s.enemy_winrates.values())
    return _MatchAggregates(
        team_avg=fmean(team_wrs) if team_wrs else None,
        enemy_avg=fmean(enemy_wrs) if enemy_wrs else None,
        team=side_performance(
            [perf for p, perf in s.ally_performances.items() if p not in excluded]
        ),
        enemy=side_performance(list(s.enemy_performances.values())),
    )


def _per_match_payload(
    aggregated: list[tuple[SpineMatchStats, _MatchAggregates]],
    duo_by_match: dict[str, bool],
) -> list[MatchmakingPerMatchJSON]:
    """Both-sided spine matches with their duo flag, for the scope split."""

    def _rounded(value: float | None, digits: int) -> float | None:
        return None if value is None else round(value, digits)

    return [
        {
            "match_id": s.match_id,
            "duo": duo_by_match[s.match_id],
            "win": s.win,
            "ally_puuids": s.ally_puuids,
            "enemy_puuids": s.enemy_puuids,
            "team_avg": round(a.team_avg, 4),
            "enemy_avg": round(a.enemy_avg, 4),
            "team_kda": _rounded(a.team.kda, 2),
            "enemy_kda": _rounded(a.enemy.kda, 2),
            "team_kill_participation": _rounded(a.team.kill_participation, 4),
            "enemy_kill_participation": _rounded(a.enemy.kill_participation, 4),
            "team_damage_share": _rounded(a.team.damage_share, 4),
            "enemy_damage_share": _rounded(a.enemy.damage_share, 4),
        }
        for s, a in aggregated
        if a.team_avg is not None and a.enemy_avg is not None
    ]


def build_completion_results(
    spine_stats: list[SpineMatchStats],
    *,
    matches_analyzed: int,
    matches_requested: int,
    rank_summary: RankSummary,
    player_ranks: dict[str, PlayerRankJSON],
    rank_period_accurate: int,
    rank_current_day: int,
    analyzed_puuid: str,
) -> MatchmakingAnalysisResultsJSON:
    """Summarise a finished run, or refuse to call an empty one finished.

    A run that measured nothing is a failure, not a 0.0%-vs-0.0% verdict. The
    headline averages keep their full per-side lists, while `per_match` keeps
    only both-sided matches -- the SoloQ/DuoQ scope split needs comparable pairs.
    """
    spine_allies = [(s.match_id, s.ally_puuids) for s in spine_stats]
    excluded = duo_partner_puuids(spine_allies, analyzed_puuid=analyzed_puuid) | {
        analyzed_puuid
    }
    aggregated = [(s, _aggregate_match(s, excluded)) for s in spine_stats]
    team_avgs = [a.team_avg for _, a in aggregated if a.team_avg is not None]
    enemy_avgs = [a.enemy_avg for _, a in aggregated if a.enemy_avg is not None]
    if not team_avgs or not enemy_avgs:
        raise MatchmakingAnalysisRuntimeError(
            "no_matches_analyzed",
            "No ranked match history could be read for this lobby. "
            "Please try again later.",
        )
    return {
        "team_avg_winrate": round(trimmed_mean(team_avgs), 4),
        "enemy_avg_winrate": round(trimmed_mean(enemy_avgs), 4),
        "matches_analyzed": matches_analyzed,
        "matches_requested": matches_requested,
        "spine_matches_found": len(spine_stats),
        "ally_avg_rank_value": rank_summary.ally_avg_rank_value,
        "enemy_avg_rank_value": rank_summary.enemy_avg_rank_value,
        "ally_tier_counts": rank_summary.ally_tier_counts,
        "enemy_tier_counts": rank_summary.enemy_tier_counts,
        "per_match": _per_match_payload(
            aggregated,
            classify_duo_matches(spine_allies, analyzed_puuid=analyzed_puuid),
        ),
        "player_ranks": player_ranks,
        "rank_freshness": {
            "period_accurate": rank_period_accurate,
            "current_day": rank_current_day,
        },
    }
