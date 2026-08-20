"""Champion and lane statistic aggregation for match history."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, TypedDict, TypeIs

import structlog

from .participants import MatchParticipant
from .schemas import ChampionStatsItem, LaneStatsItem

logger = structlog.get_logger(__name__)

LANE_DISPLAY_NAMES: dict[str, str] = {
    "TOP": "Top",
    "JUNGLE": "Jungle",
    "MIDDLE": "Mid",
    "BOTTOM": "Bottom",
    "UTILITY": "Support",
}


def calculate_kda(kills: int, deaths: int, assists: int) -> float:
    """Calculate KDA ratio."""
    if deaths == 0:
        return float(kills + assists)
    return (kills + assists) / deaths


def or_zero(value: int | None) -> int:
    """Coerce a missing or falsey numeric field to 0."""
    return value or 0


def _is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow an unvalidated `advanced_stats` blob to a string-keyed object.

    `advanced_stats` is stored verbatim from Riot's `challenges` payload, so the
    runtime check is load-bearing; narrowing through it keeps the read typed.
    """
    return isinstance(value, dict)


def advanced_int(advanced_stats: object, key: str) -> int:
    """Safely read integer-like advanced_stats values."""
    if not _is_json_object(advanced_stats):
        return 0
    raw_value = advanced_stats.get(key, 0)
    if raw_value is None:
        return 0
    try:
        return int(raw_value)
    except TypeError, ValueError:
        logger.debug(
            "match_stat_coercion_failed",
            key=key,
            got_type=type(raw_value).__name__,
        )
        return 0


def page_window(start: int, count: int, total_count: int) -> tuple[int, int]:
    """Convert start/count pagination into page and page-count."""
    if count > 0:
        return start // count, (total_count + count - 1) // count
    return 0, 0


def _accumulate_group_stats(
    participants: Iterable[MatchParticipant],
    group_of: Callable[[MatchParticipant], str | None],
    first_seen: Callable[[MatchParticipant], dict[str, int]] | None = None,
) -> dict[str, dict[str, int]]:
    """Total wins and combat scores per group, however the caller groups them.

    `first_seen` supplies any fields copied off the first participant in a
    group rather than summed -- champion stats carry the champion id that way.
    A participant whose group key is empty is skipped: a lane is genuinely
    optional, and an empty champion name is a data defect that would otherwise
    become a nameless row in the response.
    """
    grouped: dict[str, dict[str, int]] = {}
    for participant in participants:
        group = group_of(participant)
        if not group:
            continue
        totals = grouped.get(group)
        if totals is None:
            totals = {
                **(first_seen(participant) if first_seen is not None else {}),
                "games": 0,
                "wins": 0,
                "kills": 0,
                "deaths": 0,
                "assists": 0,
            }
            grouped[group] = totals
        totals["games"] += 1
        if participant.win:
            totals["wins"] += 1
        totals["kills"] += participant.kills
        totals["deaths"] += participant.deaths
        totals["assists"] += participant.assists
    return grouped


def accumulate_champion_stats(
    participants: Iterable[MatchParticipant],
) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by champion name."""
    return _accumulate_group_stats(
        participants,
        lambda participant: participant.champion_name,
        lambda participant: {"champion_id": participant.champion_id},
    )


def accumulate_lane_stats(
    participants: Iterable[MatchParticipant],
) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by assigned lane."""
    return _accumulate_group_stats(
        participants, lambda participant: participant.team_position
    )


def averages_from_totals(
    data: dict[str, int],
) -> tuple[int, int, int, float, float, float, float, float]:
    """Turn accumulated combat totals into per-game averages."""
    games = data["games"]
    wins = data["wins"]
    losses = games - wins
    avg_kda = calculate_kda(data["kills"], data["deaths"], data["assists"])
    if games > 0:
        return (
            games,
            wins,
            losses,
            wins / games,
            data["kills"] / games,
            data["deaths"] / games,
            data["assists"] / games,
            avg_kda,
        )
    return games, wins, losses, 0.0, 0.0, 0.0, 0.0, avg_kda


def champion_stats_sort_key(champion: ChampionStatsItem) -> tuple[int, str]:
    return (-champion.games_played, champion.champion_name)


class CommonStatFields(TypedDict):
    """The eight figures every statistics row carries, whatever it groups by."""

    games_played: int
    wins: int
    losses: int
    win_rate: float
    avg_kills: float
    avg_deaths: float
    avg_assists: float
    avg_kda: float


def common_stat_fields(data: dict[str, int]) -> CommonStatFields:
    """Shape accumulated totals into the fields both response items share."""
    games, wins, losses, win_rate, kills, deaths, assists, kda = averages_from_totals(
        data
    )
    return {
        "games_played": games,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,
        "avg_kills": kills,
        "avg_deaths": deaths,
        "avg_assists": assists,
        "avg_kda": kda,
    }


def build_champion_stat_items(
    champion_data: dict[str, dict[str, int]],
) -> list[ChampionStatsItem]:
    """Build the complete ordered champion-statistics population."""
    champions = [
        ChampionStatsItem(
            champion_name=champ_name,
            champion_id=data["champion_id"],
            **common_stat_fields(data),
        )
        for champ_name, data in champion_data.items()
    ]
    champions.sort(key=champion_stats_sort_key)
    return champions


def build_lane_stat_items(lane_data: dict[str, dict[str, int]]) -> list[LaneStatsItem]:
    """Build per-lane statistics sorted by games played."""
    lanes = [
        LaneStatsItem(
            lane=LANE_DISPLAY_NAMES.get(lane, lane),
            **common_stat_fields(data),
        )
        for lane, data in lane_data.items()
    ]
    lanes.sort(key=lambda item: item.games_played, reverse=True)
    return lanes
