"""Player league persistence regressions for current LEAGUE-V4 payloads."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.enums import Tier
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.models import LeagueEntryDTO
from app.features.players import service as player_service_module
from app.features.players.leagues import PlayerLeague
from app.features.players.leagues_schemas import PlayerLeagueResponse
from app.features.players.models import Player
from app.features.players.service import PlayerService


def _league_entry(league_points: int = 42) -> LeagueEntryDTO:
    return LeagueEntryDTO(
        queue_type="RANKED_SOLO_5x5",
        tier="GOLD",
        rank="II",
        league_points=league_points,
        wins=12,
        losses=8,
    )


class _LeagueSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)


async def test_a_live_entry_is_stored_as_one_ranked_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _LeagueSession()
    service = PlayerService(cast(AsyncSession, session))
    service.get_player_league = AsyncMock(return_value=None)
    client = SimpleNamespace(
        get_league_entries_by_puuid=AsyncMock(return_value=[_league_entry()])
    )
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )

    updated = await service.update_player_league(
        Player(puuid="sanitized-puuid", platform="eun1"),
        cast(RiotAPIClient, client),
    )

    assert updated is True
    assert len(session.added) == 1
    snapshot = session.added[0]
    assert isinstance(snapshot, PlayerLeague)
    assert snapshot.queue_type == "RANKED_SOLO_5x5"
    assert snapshot.tier == "GOLD"
    assert snapshot.rank == "II"
    assert snapshot.league_points == 42
    assert snapshot.wins == 12
    assert snapshot.losses == 8


async def test_an_unchanged_entry_does_not_add_a_second_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _LeagueSession()
    service = PlayerService(cast(AsyncSession, session))
    service.get_player_league = AsyncMock(
        return_value=SimpleNamespace(
            tier="GOLD",
            rank="II",
            league_points=42,
            wins=12,
            losses=8,
        )
    )
    client = SimpleNamespace(
        get_league_entries_by_puuid=AsyncMock(return_value=[_league_entry()])
    )
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )

    updated = await service.update_player_league(
        Player(puuid="sanitized-puuid", platform="eun1"),
        cast(RiotAPIClient, client),
    )

    assert updated is False
    assert session.added == []


def test_a_challenger_snapshot_survives_the_response_model() -> None:
    """Master and above have no divisions, so their LP has no ceiling.

    `PlayerLeagueResponse.league_points` carried `le=100`, which holds for Iron
    through Diamond and for nothing above them. It is a response model, so the
    bound rejected the row on the way out: `GET /players/{puuid}/league` would
    have answered 500 for every player above Diamond, and the writer stores
    Riot's own value with no clamp to keep it under.
    """
    snapshot = PlayerLeagueResponse(
        puuid="sanitized-puuid",
        queue_type="RANKED_SOLO_5x5",
        tier=Tier.CHALLENGER,
        rank="I",
        league_points=1247,
        wins=300,
        losses=200,
        created_at=datetime(2026, 8, 21, tzinfo=UTC),
        win_rate=60.0,
        total_games=500,
        display_rank="Challenger",
    )

    assert snapshot.league_points == 1247
