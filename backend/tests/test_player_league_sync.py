"""Player league persistence regressions for current LEAGUE-V4 payloads."""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.models import LeagueEntryDTO
from app.features.players import service as player_service_module
from app.features.players.leagues import PlayerLeague
from app.features.players.leagues_schemas import PlayerLeagueResponse
from app.features.players.models import Player
from app.features.players.service import PlayerService


def _league_entry(*, league_id: str | None, league_points: int = 42) -> LeagueEntryDTO:
    return LeagueEntryDTO(
        league_id=league_id,
        queue_type="RANKED_SOLO_5x5",
        tier="GOLD",
        rank="II",
        league_points=league_points,
        wins=12,
        losses=8,
        veteran=False,
        inactive=False,
        fresh_blood=True,
        hot_streak=False,
    )


class _LeagueSession:
    def __init__(self) -> None:
        self.added: list[object] = []

    def add(self, value: object) -> None:
        self.added.append(value)


async def test_missing_league_id_is_persisted_as_null_without_losing_rank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _LeagueSession()
    service = PlayerService(cast(AsyncSession, session))
    service.get_player_league = AsyncMock(return_value=None)
    client = SimpleNamespace(
        get_league_entries_by_puuid=AsyncMock(
            return_value=[_league_entry(league_id=None)]
        )
    )
    monkeypatch.setattr(
        player_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
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
    assert snapshot.league_id is None
    assert snapshot.queue_type == "RANKED_SOLO_5x5"
    assert snapshot.tier == "GOLD"
    assert snapshot.rank == "II"
    assert snapshot.league_points == 42
    assert snapshot.wins == 12
    assert snapshot.losses == 8


async def test_missing_league_id_does_not_replace_an_unchanged_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _LeagueSession()
    service = PlayerService(cast(AsyncSession, session))
    service.get_player_league = AsyncMock(
        return_value=SimpleNamespace(
            league_id="existing-league-id",
            tier="GOLD",
            rank="II",
            league_points=42,
            wins=12,
            losses=8,
        )
    )
    client = SimpleNamespace(
        get_league_entries_by_puuid=AsyncMock(
            return_value=[_league_entry(league_id=None)]
        )
    )
    monkeypatch.setattr(
        player_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )

    updated = await service.update_player_league(
        Player(puuid="sanitized-puuid", platform="eun1"),
        cast(RiotAPIClient, client),
    )

    assert updated is False
    assert session.added == []


def test_player_league_contract_and_schema_allow_an_omitted_upstream_id() -> None:
    assert PlayerLeague.__table__.c.league_id.nullable is True
    assert PlayerLeagueResponse.model_fields["league_id"].is_required() is False
