"""Fuzzy player search: parsing, query building, scoring and ranking.

Pure algorithm, no session: everything here works on a query string and
`Player` rows the caller already holds. `PlayerService.fuzzy_search_players`
owns the database round trip and the per-user tracking flags; this module
owns what a search means.
"""

from collections.abc import Sequence
from typing import Literal, TypedDict

import structlog
from rapidfuzz.distance.Levenshtein import distance as levenshtein_distance
from sqlalchemy import Select, and_, or_, select

from app.core.riot_api.constants import Platform

from .models import Player

logger = structlog.get_logger(__name__)

# What `parse_search_query` read out of the raw query string; every
# scoring branch below switches on it.
SearchType = Literal["full_id", "tag", "name", "all"]


class ScoredPlayer(TypedDict):
    """A fuzzy-search candidate together with the keys it is ranked by.

    ``name`` is the sort tiebreaker and is the empty string when the row has
    no game name, so it stays a plain ``str`` rather than an optional.
    """

    player: Player
    score: float
    name: str


def parse_search_query(query: str) -> tuple[SearchType, str | None, str | None]:
    """
    Parse search query to detect search type and extract components.

    Returns:
        Tuple of (search_type, game_name, tag_line)
    """
    if query.startswith("#"):
        # Tag-only search: "#EUNE"
        return "tag", None, query[1:].strip()

    if "#" in query:
        # Full ID search: "John Doe#EUNE"
        if query.count("#") == 1:
            game_name, tag_line = query.split("#", 1)
            return "full_id", game_name.strip(), tag_line.strip()
        # Multiple # - treat as invalid, search everything
        return "all", None, None

    # Name search: "John Doe"
    return "name", query.strip(), None


def validate_search_query(
    query: str,
    search_type: SearchType,
    game_name: str | None,
    tag_line: str | None,
) -> bool:
    """Validate search query and return False if invalid."""
    if len(query.strip()) < 1:
        logger.warning("Query too short", query=query)
        return False

    if search_type == "full_id" and (not game_name or not tag_line):
        logger.warning(
            "Invalid Full ID search: empty game_name or tag_line",
            query=query,
            search_type=search_type,
        )
        return False

    return True


def build_player_search_query(
    platform: Platform | None,
    search_type: SearchType,
    query_lower: str,
    game_name: str | None,
    tag_line: str | None,
) -> Select[tuple[Player]]:
    """Build SQLAlchemy query based on search type."""
    # `platform` arrives as the enum, whose values are the one spelling the
    # column is allowed to hold (`ck_players_platform_is_lowercase`), so
    # this compares rather than `ilike`-ing around a casing question that
    # the database already settled.
    platform_filter = [Player.platform == platform.value] if platform else []

    if search_type == "full_id" and game_name and tag_line:
        # Search for exact or partial Full ID (GameName # TagLine)
        return select(Player).where(
            *platform_filter,
            or_(
                # Exact match
                and_(
                    Player.game_name.ilike(game_name),
                    Player.tag_line.ilike(tag_line),
                ),
                # Partial matches
                Player.game_name.ilike(f"%{game_name}%"),
                Player.tag_line.ilike(f"%{tag_line}%"),
            ),
        )

    if search_type == "tag" and tag_line:
        # Search tags only
        return select(Player).where(
            *platform_filter,
            Player.tag_line.ilike(f"%{tag_line}%"),
        )

    # name or all - search game names
    search_term = game_name if game_name else query_lower
    return select(Player).where(
        *platform_filter,
        Player.game_name.ilike(f"%{search_term}%"),
    )


def score_player_match(
    player: Player,
    search_type: SearchType,
    query_lower: str,
    game_name: str | None,
    tag_line: str | None,
) -> float:
    """
    Calculate relevance score for a player match.

    Returns:
        Score where 1000.0 = exact match, 0.0-1.0 = fuzzy match quality
    """
    # Exact match = highest priority
    if (
        search_type == "full_id"
        and game_name
        and tag_line
        and player.game_name.lower() == game_name.lower()
        and player.tag_line.lower() == tag_line.lower()
    ):
        return 1000.0

    distance = _closest_field_distance(player, search_type, query_lower, tag_line)
    # Convert to score: 1 / (1 + distance)
    return 1.0 / (1.0 + distance) if distance is not None else 0.0


def _closest_field_distance(
    player: Player,
    search_type: SearchType,
    query_lower: str,
    tag_line: str | None,
) -> int | None:
    """Smallest edit distance over the fields this search type compares.

    None when the search type compares nothing on this player. The field
    sets are deliberately different: a tag search only ever looks at the
    tag, and a game-name search sees the tag only inside the full Riot ID.

    Split out from the caller only because the two together rank C on the
    complexity gate; the four one-caller helpers this replaced did the
    same work through four more frames.
    """
    composite = (
        f"{player.game_name}#{player.tag_line}".lower()
        if player.tag_line
        else player.game_name.lower()
    )
    # (applies?, query, target)
    candidates = [
        (
            bool(player.game_name) and search_type in ("name", "all"),
            query_lower,
            player.game_name.lower(),
        ),
        (
            bool(player.game_name) and search_type in ("name", "full_id", "all"),
            query_lower,
            composite,
        ),
        (
            bool(player.tag_line) and search_type in ("tag", "full_id"),
            tag_line.lower() if tag_line else query_lower,
            player.tag_line.lower(),
        ),
    ]
    distances = [
        levenshtein_distance(query, target)
        for applies, query, target in candidates
        if applies
    ]
    return min(distances) if distances else None


def score_and_sort_players(
    players: Sequence[Player],
    search_type: SearchType,
    query_lower: str,
    game_name: str | None,
    tag_line: str | None,
    limit: int,
) -> list[ScoredPlayer]:
    """Score players by relevance and return top matches."""
    scored_players: list[ScoredPlayer] = [
        {
            "player": player,
            "score": score_player_match(
                player, search_type, query_lower, game_name, tag_line
            ),
            "name": player.game_name or "",
        }
        for player in players
    ]

    scored_players.sort(key=lambda x: (-x["score"], x["name"].lower()))
    return scored_players[:limit]
