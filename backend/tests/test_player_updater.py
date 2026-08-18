"""Player Updater execution and recovery regressions."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.db_rate_limiter import DBRateLimiter
from app.features.jobs.error_handling import RateLimitSignal
from app.features.jobs.implementations import player_updater as player_updater_module
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.players import service as player_service_module
from app.features.players.models import Player
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService


class _FakeRiotClient:
    def __init__(self, **_kwargs: object) -> None:
        return None

    async def __aenter__(self) -> _FakeRiotClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def get_api_calls(self) -> list[object]:
        return []


@pytest.mark.asyncio
async def test_player_updater_continues_after_a_recoverable_player_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    players = [
        SimpleNamespace(puuid="sanitized-one"),
        SimpleNamespace(puuid="sanitized-two"),
    ]
    player_models = {
        player.puuid: SimpleNamespace(
            puuid=player.puuid,
            game_name="Sanitized",
            tag_line="TEST",
            profile_icon_id=1,
            summoner_level=1,
        )
        for player in players
    }

    def load_player_model(_model: object, puuid: str) -> SimpleNamespace:
        return player_models[puuid]

    db = SimpleNamespace(
        get=AsyncMock(side_effect=load_player_model),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    player_service = SimpleNamespace(
        get_globally_tracked_players=AsyncMock(return_value=players),
        update_player_profile=AsyncMock(
            side_effect=[RuntimeError("temporary player failure"), False]
        ),
    )
    rate_limiter = SimpleNamespace(
        acquire=AsyncMock(return_value=True),
        record_request=AsyncMock(),
        release=AsyncMock(),
    )
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return player_service

    def build_rate_limiter(*_args: object) -> SimpleNamespace:
        return rate_limiter

    monkeypatch.setattr(
        player_updater_module,
        "PlayerService",
        build_player_service,
    )
    monkeypatch.setattr(
        player_updater_module,
        "DBRateLimiter",
        build_rate_limiter,
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()

    await job.execute(cast(AsyncSession, db))

    assert player_service.update_player_profile.await_count == 2
    assert job.execution_log["errors"][0]["operation"] == "player profile update"
    assert job.execution_log["errors"][0]["context"] == {"puuid": "sanitized-one"}
    db.rollback.assert_awaited_once()
    db.commit.assert_awaited_once()
    assert rate_limiter.record_request.await_count == 2
    rate_limiter.release.assert_awaited_once()


@pytest.mark.asyncio
async def test_player_updater_reports_local_capacity_as_rate_limited() -> None:
    job = PlayerUpdaterJob(job_config_id=7)
    db = SimpleNamespace(
        get=AsyncMock(return_value=SimpleNamespace(puuid="sanitized-puuid"))
    )
    rate_limiter = SimpleNamespace(acquire=AsyncMock(return_value=False))

    with pytest.raises(RateLimitSignal):
        await job._update_player_profile(
            db=cast(AsyncSession, db),
            player=cast(PlayerResponse, SimpleNamespace(puuid="sanitized-puuid")),
            player_service=cast(PlayerService, object()),
            riot_client=cast(RiotAPIClient, object()),
            rate_limiter=cast(DBRateLimiter, rate_limiter),
        )


@pytest.mark.asyncio
async def test_optional_account_identity_does_not_erase_known_riot_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    player = SimpleNamespace(
        puuid="sanitized-puuid",
        platform="eun1",
        game_name="Known Name",
        tag_line="SAFE",
        profile_icon_id=29,
        summoner_level=100,
    )
    riot_client = SimpleNamespace(
        get_summoner_by_puuid=AsyncMock(
            return_value=SimpleNamespace(profile_icon_id=29, summoner_level=100)
        ),
        get_account_by_puuid=AsyncMock(
            return_value=SimpleNamespace(game_name=None, tag_line=None)
        ),
    )

    changed = await PlayerService(cast(AsyncSession, object())).update_player_profile(
        cast(Player, player), cast(RiotAPIClient, riot_client)
    )

    assert not changed
    assert (player.game_name, player.tag_line) == ("Known Name", "SAFE")
    assert player.profile_synced_at is not None


@pytest.mark.asyncio
async def test_new_player_uses_submitted_riot_id_when_account_omits_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )

    class _Statement:
        def where(self, *_conditions: object) -> _Statement:
            return self

    class _FakePlayer(SimpleNamespace):
        puuid = object()
        game_name = object()
        tag_line = object()
        platform = object()

    def build_statement(*_args: object) -> _Statement:
        return _Statement()

    monkeypatch.setattr(player_service_module, "select", build_statement)
    monkeypatch.setattr(player_service_module, "Player", _FakePlayer)

    async def populate_database_timestamps(player: SimpleNamespace) -> None:
        player.created_at = datetime.now(UTC)
        player.updated_at = datetime.now(UTC)

    db = SimpleNamespace(
        get=AsyncMock(return_value=None),
        add=Mock(),
        commit=AsyncMock(),
        refresh=AsyncMock(side_effect=populate_database_timestamps),
    )
    service = PlayerService(cast(AsyncSession, db))
    riot_client = SimpleNamespace(
        get_account_by_riot_id=AsyncMock(
            return_value=SimpleNamespace(puuid="p" * 78, game_name=None, tag_line=None)
        ),
        get_summoner_by_puuid=AsyncMock(
            return_value=SimpleNamespace(profile_icon_id=29, summoner_level=100)
        ),
    )

    await service.discover_player(
        riot_client=cast(RiotAPIClient, riot_client),
        game_name="Submitted Name",
        tag_line="SAFE",
        platform="eun1",
    )

    created_player = db.add.call_args.args[0]
    assert (created_player.game_name, created_player.tag_line) == (
        "Submitted Name",
        "SAFE",
    )
    assert created_player.profile_synced_at is not None
