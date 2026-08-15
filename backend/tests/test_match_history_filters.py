"""Regression coverage for Match History filtering before pagination."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.features.matches.models import Match
from app.features.matches.router import parse_match_queue_ids
from app.features.matches.service import (
    MatchService,
    build_match_history_conditions,
    normalize_match_queue_ids,
)


def test_queue_parser_supports_one_stable_union_and_legacy_scalar() -> None:
    assert parse_match_queue_ids(None, "420, 440,420") == (420, 440)
    assert parse_match_queue_ids(450, None) == (450,)
    assert parse_match_queue_ids(None, None) is None
    assert normalize_match_queue_ids(450, None) == (450,)
    assert normalize_match_queue_ids(450, [420, 440]) == (420, 440)


@pytest.mark.parametrize("queues", ["", "420,", "ARAM", "0", "-1"])
def test_queue_parser_rejects_invalid_unions(queues: str) -> None:
    with pytest.raises(HTTPException) as error:
        parse_match_queue_ids(None, queues)

    assert error.value.status_code == 422


def test_queue_parser_rejects_ambiguous_scalar_and_union() -> None:
    with pytest.raises(HTTPException) as error:
        parse_match_queue_ids(420, "440")

    assert error.value.status_code == 422


def test_history_conditions_search_every_participant_before_pagination() -> None:
    statement = select(Match.__table__.c.match_id).where(
        *build_match_history_conditions(
            puuid="selected-puuid",
            queue_ids=[420, 440],
            search="Kai%Sa_#EUW",
        )
    )
    compiled = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert compiled.count("EXISTS") == 2
    assert "matches.queue_id IN (420, 440)" in compiled
    assert "player_participant.puuid = 'selected-puuid'" in compiled
    assert "searchable_participant.champion_name" in compiled
    assert "searchable_participant.game_name" in compiled
    assert "searchable_participant.tag_line" in compiled
    assert "concat(searchable_participant.game_name, '#'," in compiled
    assert "Kai/%%Sa/_#EUW" in compiled


@pytest.mark.asyncio
async def test_empty_page_retains_filtered_total_for_client_clamping() -> None:
    service = MatchService(SimpleNamespace())  # type: ignore[arg-type]
    service._get_matches_from_db = AsyncMock(return_value=[])  # type: ignore[method-assign]
    service._count_matches_from_db = AsyncMock(return_value=63)  # type: ignore[method-assign]
    service._count_analyzed_matches_from_db = AsyncMock(return_value=40)  # type: ignore[method-assign]

    response = await service.get_player_matches_with_data(
        puuid="selected-puuid",
        start=75,
        count=25,
        queue_ids=[420, 440],
        search="Ahri",
    )

    assert response.matches == []
    assert response.total == 63
    assert response.total_analyzed == 40
    assert response.page == 3
    assert response.pages == 3
    service._get_matches_from_db.assert_awaited_once_with(
        puuid="selected-puuid",
        start=75,
        count=25,
        queue_ids=(420, 440),
        search="Ahri",
        exclude_aram=False,
    )
    service._count_matches_from_db.assert_awaited_once_with(
        puuid="selected-puuid",
        queue_ids=(420, 440),
        search="Ahri",
        exclude_aram=False,
    )
