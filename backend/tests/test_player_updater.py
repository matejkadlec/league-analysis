"""Player Updater execution and recovery regressions."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.features.jobs.error_handling import RateLimitSignal
from app.features.jobs.implementations import player_updater as player_updater_module
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob


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
