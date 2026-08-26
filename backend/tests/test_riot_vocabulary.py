"""The closed Riot vocabularies stay one list across enums, CHECKs, and aliases."""

from pathlib import Path
from typing import get_args

from app.core.enums import UNRANKED, Division, LobbyTier, Tier, lobby_tier_values
from app.core.riot_api.constants import (
    TEAM_IDS,
    TEAM_POSITIONS,
    LeagueQueueType,
    Platform,
    TeamId,
    TeamPosition,
)
from app.core.runs import ints_in_sql, nullable_values_in_sql, values_in_sql
from app.features.matches.match_stats import LANE_DISPLAY_NAMES
from app.features.settings.schemas import CardRole

REVISION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260826_0033_riot_vocabulary_checks.py"
)


def test_lobby_tier_is_tier_plus_unranked() -> None:
    assert lobby_tier_values() == (*tuple(tier.value for tier in Tier), UNRANKED)
    assert get_args(LobbyTier) == lobby_tier_values()


def test_card_role_is_team_position() -> None:
    assert CardRole is TeamPosition
    assert {position.value for position in TeamPosition} == TEAM_POSITIONS


def test_lane_display_names_cover_every_team_position() -> None:
    assert set(LANE_DISPLAY_NAMES) == TEAM_POSITIONS
    assert set(LANE_DISPLAY_NAMES.values()) == {
        "Top",
        "Jungle",
        "Mid",
        "Bottom",
        "Support",
    }


def test_check_sql_matches_the_python_vocabularies() -> None:
    """The Alembic revision inlines these strings; this is the drift tripwire."""
    namespace: dict[str, object] = {}
    exec(REVISION.read_text(encoding="utf-8"), namespace)
    expected = {
        "PLATFORM_SQL": values_in_sql("platform", [p.value for p in Platform]),
        "TIER_SQL": values_in_sql("tier", [t.value for t in Tier]),
        "RANK_SQL": nullable_values_in_sql("rank", [d.value for d in Division]),
        "QUEUE_TYPE_SQL": values_in_sql(
            "queue_type", [q.value for q in LeagueQueueType]
        ),
        "TEAM_ID_SQL": ints_in_sql("team_id", TEAM_IDS),
        "TEAM_POSITION_SQL": nullable_values_in_sql(
            "team_position", sorted(TEAM_POSITIONS)
        ),
    }
    for name, sql in expected.items():
        assert namespace[name] == sql
    assert (TeamId.BLUE.value, TeamId.RED.value) == TEAM_IDS
