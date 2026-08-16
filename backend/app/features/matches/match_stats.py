"""Champion and lane statistic aggregation for match history."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, TypeIs

from .participants import MatchParticipant
from .schemas import ChampionStatsItem, LaneStatsItem

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
        return 0


def page_window(start: int, count: int, total_count: int) -> tuple[int, int]:
    """Convert start/count pagination into page and page-count."""
    if count > 0:
        return start // count, (total_count + count - 1) // count
    return 0, 0


def accumulate_champion_stats(
    participants: Iterable[MatchParticipant],
) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by champion name."""
    champion_data: dict[str, dict[str, int]] = {}
    for participant in participants:
        champ_name = participant.champion_name
        if champ_name not in champion_data:
            champion_data[champ_name] = {
                "champion_id": participant.champion_id,
                "games": 0,
                "wins": 0,
                "kills": 0,
                "deaths": 0,
                "assists": 0,
            }
        champion_data[champ_name]["games"] += 1
        if participant.win:
            champion_data[champ_name]["wins"] += 1
        champion_data[champ_name]["kills"] += participant.kills
        champion_data[champ_name]["deaths"] += participant.deaths
        champion_data[champ_name]["assists"] += participant.assists
    return champion_data


def accumulate_lane_stats(
    participants: Iterable[MatchParticipant],
) -> dict[str, dict[str, int]]:
    """Aggregate combat stats grouped by assigned lane."""
    lane_data: dict[str, dict[str, int]] = {}
    for participant in participants:
        lane = participant.team_position
        if not lane:
            continue
        if lane not in lane_data:
            lane_data[lane] = {
                "games": 0,
                "wins": 0,
                "kills": 0,
                "deaths": 0,
                "assists": 0,
            }
        lane_data[lane]["games"] += 1
        if participant.win:
            lane_data[lane]["wins"] += 1
        lane_data[lane]["kills"] += participant.kills
        lane_data[lane]["deaths"] += participant.deaths
        lane_data[lane]["assists"] += participant.assists
    return lane_data


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


def build_champion_stat_items(
    champion_data: dict[str, dict[str, int]],
) -> list[ChampionStatsItem]:
    """Build the complete ordered champion-statistics population."""
    champions: list[ChampionStatsItem] = []
    for champ_name, data in champion_data.items():
        games, wins, losses, win_rate, avg_kills, avg_deaths, avg_assists, avg_kda = (
            averages_from_totals(data)
        )
        champions.append(
            ChampionStatsItem(
                champion_name=champ_name,
                champion_id=data["champion_id"],
                games_played=games,
                wins=wins,
                losses=losses,
                win_rate=win_rate,
                avg_kills=avg_kills,
                avg_deaths=avg_deaths,
                avg_assists=avg_assists,
                avg_kda=avg_kda,
            )
        )
    champions.sort(key=champion_stats_sort_key)
    return champions


def build_lane_stat_items(lane_data: dict[str, dict[str, int]]) -> list[LaneStatsItem]:
    """Build per-lane statistics sorted by games played."""
    lanes: list[LaneStatsItem] = []
    for lane, data in lane_data.items():
        games, wins, losses, win_rate, avg_kills, avg_deaths, avg_assists, avg_kda = (
            averages_from_totals(data)
        )
        lanes.append(
            LaneStatsItem(
                lane=LANE_DISPLAY_NAMES.get(lane, lane),
                games_played=games,
                wins=wins,
                losses=losses,
                win_rate=win_rate,
                avg_kills=avg_kills,
                avg_deaths=avg_deaths,
                avg_assists=avg_assists,
                avg_kda=avg_kda,
            )
        )
    lanes.sort(key=lambda item: item.games_played, reverse=True)
    return lanes
