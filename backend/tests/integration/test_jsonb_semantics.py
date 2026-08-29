"""What JSONB stores, and what it gives back.

Python `None`, SQL NULL and JSON `null` are three different values in a JSONB
column, and only the database can tell them apart. A mocked session returns
whatever the fixture handed it and sees none of this.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.users.models import User
from app.features.auth.users.user_card_preference import UserCardPreference
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.players.models import Player
from app.features.playstyle_analysis.models import (
    AnalysisStatus,
    DetectedTag,
    PlaystyleAnalysis,
)
from app.features.playstyle_analysis.service import PlaystyleAnalysisService
from app.features.settings.schemas import (
    CardId,
    CardPreferenceUpdate,
)
from app.features.settings.service import SettingsService

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

TOP_CHAMPIONS_PAYLOAD: dict[str, Any] = {
    "minimumGames": 12,
    "minimumWinRate": 54.5,
    "minimumKda": 2.3,
    "includedRoles": ["TOP", "JUNGLE"],
}
REVISED_PAYLOAD: dict[str, Any] = {
    "minimumGames": 3,
    "minimumWinRate": 0.0,
    "minimumKda": 0.0,
    "includedRoles": [],
}
DETECTED_TAG: DetectedTag = {
    "threshold_met": True,
    "description": "Farms well",
    "value": 8.25,
    "sentiment": "positive",
    "display_name": "Farmer",
}


async def test_an_empty_analysis_writes_json_null_that_is_not_sql_null(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """`none_as_null` is off, so a `None` written to JSONB lands as JSON `null`.

    Python reads both back as `None`, which is why no unit test sees this, but
    `IS NULL` matches only one of them -- and revision 0022's backfilled rows
    are the other one.
    """
    service = PlaystyleAnalysisService(database_session)
    await service._save_empty_analysis(stored_player.puuid)

    stored = await database_session.execute(
        select(
            PlaystyleAnalysis.summary_stats,
            PlaystyleAnalysis.summary_stats.is_(None),
            text("summary_stats = 'null'::jsonb"),
            PlaystyleAnalysis.tags,
        ).where(PlaystyleAnalysis.puuid == stored_player.puuid)
    )
    assert stored.one() == (None, False, True, {})


async def test_the_analysis_upsert_replaces_the_whole_tags_document(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """A re-analysis must not leave a tag the newer run did not detect."""
    service = PlaystyleAnalysisService(database_session)
    await service._save_analysis(
        stored_player.puuid, {"FARMER": DETECTED_TAG, "STALE": DETECTED_TAG}, None
    )
    saved = await service._save_analysis(
        stored_player.puuid, {"FARMER": DETECTED_TAG}, None
    )

    stored = await database_session.execute(
        select(PlaystyleAnalysis.tags, PlaystyleAnalysis.status).where(
            PlaystyleAnalysis.puuid == stored_player.puuid
        )
    )
    assert stored.all() == [({"FARMER": DETECTED_TAG}, AnalysisStatus.COMPLETED)]
    assert saved.tags == {"FARMER": DETECTED_TAG}


async def test_a_repeat_card_preference_replaces_the_stored_settings(
    database_session: AsyncSession, stored_user: User
) -> None:
    """The conflict target is (user, card, version); one viewer keeps one document."""
    service = SettingsService(database_session)
    for payload in (TOP_CHAMPIONS_PAYLOAD, REVISED_PAYLOAD):
        await service.update_card_preference(
            stored_user.id,
            CardId.TOP_CHAMPIONS,
            CardPreferenceUpdate(version=1, settings=payload),
        )

    stored = await database_session.execute(
        select(UserCardPreference.settings).where(
            UserCardPreference.user_id == stored_user.id
        )
    )
    assert stored.scalars().all() == [
        {
            "minimum_games": 3,
            "minimum_win_rate": 0.0,
            "minimum_kda": 0.0,
            "included_roles": [],
        }
    ]


async def test_the_matchmaking_params_default_stores_a_json_null_end_date(
    database_session: AsyncSession, stored_player: Player, stored_user: User
) -> None:
    """Every run persisted before this column was a 10-match latest-window run.

    `end_date` is JSON `null` inside a NOT NULL document, which is a different
    value from the SQL NULL an absent key yields.
    """
    await database_session.execute(
        insert(MatchmakingAnalysis).values(
            puuid=stored_player.puuid, user_id=stored_user.id
        )
    )

    stored = await database_session.execute(
        select(
            MatchmakingAnalysis.params,
            text("params -> 'end_date' = 'null'::jsonb"),
            text("params -> 'match_count_typo' IS NULL"),
        ).where(MatchmakingAnalysis.puuid == stored_player.puuid)
    )
    assert stored.one() == ({"match_count": 10, "end_date": None}, True, True)
