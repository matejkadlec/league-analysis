"""Champion and lane statistic aggregation for match history."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import TypedDict

import structlog

from app.core.riot_api.constants import TeamPosition
from app.core.schemas import is_json_object

from .participants import MatchParticipant
from .schemas import ChampionStatsItem, LaneDisplayName, LaneStatsItem

logger = structlog.get_logger(__name__)

LANE_DISPLAY_NAMES: dict[str, LaneDisplayName] = {
    TeamPosition.TOP.value: "Top",
    TeamPosition.JUNGLE.value: "Jungle",
    TeamPosition.MIDDLE.value: "Mid",
    TeamPosition.BOTTOM.value: "Bottom",
    TeamPosition.UTILITY.value: "Support",
}


def calculate_kda(kills: int, deaths: int, assists: int) -> float:
    """Calculate KDA ratio."""
    if deaths == 0:
        return float(kills + assists)
    return (kills + assists) / deaths


def or_zero(value: int | None) -> int:
    """Coerce a missing or falsey numeric field to 0."""
    return value or 0


def advanced_int(advanced_stats: object, key: str) -> int:
    """Safely read integer-like advanced_stats values."""
    if not is_json_object(advanced_stats):
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


def page_of(start: int, count: int) -> int:
    """The zero-based page a start/count window lands on.

    The page count that used to come back with it is a `computed_field` on
    `PaginatedResponse` now. The `count > 0` guard stays here rather than at
    each call site: this is arithmetic on a caller-supplied page size.
    """
    return start // count if count > 0 else 0


def _accumulate_group_stats(
    participants: Iterable[MatchParticipant],
    group_of: Callable[[MatchParticipant], str | None],
    first_seen: Callable[[MatchParticipant], dict[str, int]] | None = None,
) -> dict[str, dict[str, int]]:
    """Total wins and combat scores per group, however the caller groups them.

    `first_seen` supplies any fields copied off the first participant in a
    group rather than summed -- champion stats carry the champion id that way.
    A participant whose group key is empty is skipped.
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
        participants,
        lambda participant: (
            participant.team_position
            if participant.team_position in LANE_DISPLAY_NAMES
            else None
        ),
    )


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
    games = data["games"]
    wins = data["wins"]

    def per_game(total: int) -> float:
        """Nobody has averages over no games; that is 0.0, not a division."""
        return total / games if games else 0.0

    return {
        "games_played": games,
        "wins": wins,
        "losses": games - wins,
        "win_rate": per_game(wins),
        "avg_kills": per_game(data["kills"]),
        "avg_deaths": per_game(data["deaths"]),
        "avg_assists": per_game(data["assists"]),
        "avg_kda": calculate_kda(data["kills"], data["deaths"], data["assists"]),
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
            lane=LANE_DISPLAY_NAMES[lane],
            **common_stat_fields(data),
        )
        for lane, data in lane_data.items()
        if lane in LANE_DISPLAY_NAMES
    ]
    lanes.sort(key=lambda item: item.games_played, reverse=True)
    return lanes
