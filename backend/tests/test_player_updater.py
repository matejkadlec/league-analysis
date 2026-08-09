"""Player Updater execution and recovery regressions."""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from app.features.jobs.error_handling import RateLimitSignal
from app.features.jobs.implementations import player_updater as player_updater_module
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.players import service as player_service_module
from app.features.players.service import PlayerService


class _FakeRiotClient:
    def __init__(self, **_kwargs: object) -> None:
        return None

    async def __aenter__(self) -> "_FakeRiotClient":
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
    db = SimpleNamespace(
        get=AsyncMock(side_effect=lambda _model, puuid: player_models[puuid]),
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
        "get_job_riot_api_key",
        AsyncMock(return_value="test-key"),
    )
    monkeypatch.setattr(player_updater_module, "RiotAPIClient", _FakeRiotClient)
    monkeypatch.setattr(
        player_updater_module,
        "PlayerService",
        lambda _db: player_service,
    )
    monkeypatch.setattr(
        player_updater_module,
        "DBRateLimiter",
        lambda *_args: rate_limiter,
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()

    await job.execute(db)

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
            db=db,
            player=SimpleNamespace(puuid="sanitized-puuid"),
            player_service=object(),
            riot_client=object(),
            rate_limiter=rate_limiter,
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

    changed = await PlayerService(object()).update_player_profile(  # type: ignore[arg-type]
        player, riot_client
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
        def where(self, _condition: object) -> "_Statement":
            return self

    class _FakePlayer(SimpleNamespace):
        puuid = object()

    monkeypatch.setattr(player_service_module, "select", lambda *_args: _Statement())
    monkeypatch.setattr(player_service_module, "Player", _FakePlayer)

    async def populate_database_timestamps(player: SimpleNamespace) -> None:
        player.created_at = datetime.now(timezone.utc)
        player.updated_at = datetime.now(timezone.utc)

    db = SimpleNamespace(
        get=AsyncMock(return_value=None),
        add=Mock(),
        commit=AsyncMock(),
        refresh=AsyncMock(side_effect=populate_database_timestamps),
    )
    service = PlayerService(db)
    service.track_player = AsyncMock(return_value=SimpleNamespace(puuid="safe"))  # type: ignore[method-assign]
    riot_client = SimpleNamespace(
        get_account_by_riot_id=AsyncMock(
            return_value=SimpleNamespace(puuid="p" * 78, game_name=None, tag_line=None)
        ),
        get_summoner_by_puuid=AsyncMock(
            return_value=SimpleNamespace(profile_icon_id=29, summoner_level=100)
        ),
    )

    await service.add_and_track_player(
        riot_client,
        "Submitted Name",
        "SAFE",
        user_id=7,
        platform="eun1",
    )

    created_player = db.add.call_args.args[0]
    assert (created_player.game_name, created_player.tag_line) == (
        "Submitted Name",
        "SAFE",
    )
    assert created_player.profile_synced_at is not None
