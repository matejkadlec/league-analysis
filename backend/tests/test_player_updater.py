"""Player Updater execution and recovery regressions."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform
from app.core.riot_api.errors import AuthenticationError
from app.features.jobs.implementations import player_updater as player_updater_module
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.players import service as player_service_module
from app.features.players.models import Player
from app.features.players.service import PlayerService


def _load_row(_model: object, puuid: str) -> Player:
    """Stand in for `AsyncSession.get`, which the loops now call per player."""
    return _player(puuid)


def _player(puuid: str) -> Player:
    """One unattached row, which is what `_load_tracked_players` returns."""
    return Player(
        puuid=puuid,
        game_name="Sanitized",
        tag_line="TEST",
        platform="eun1",
        summoner_level=1,
        profile_icon_id=1,
    )


class _FakeRiotClient:
    def __init__(self, **_kwargs: object) -> None:
        return None

    async def __aenter__(self) -> _FakeRiotClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def get_api_calls(self) -> list[object]:
        return []


async def test_player_updater_continues_after_a_recoverable_player_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    players = {p.puuid: p for p in (_player("sanitized-one"), _player("sanitized-two"))}
    db = SimpleNamespace(
        get=AsyncMock(side_effect=_load_row),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    player_service = SimpleNamespace(
        update_player_profile=AsyncMock(
            side_effect=[RuntimeError("temporary player failure"), False]
        ),
    )
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return player_service

    monkeypatch.setattr(
        player_updater_module,
        "PlayerService",
        build_player_service,
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()
    # Player resolution lives on BaseJob._load_tracked_puuids now; this test
    # is about surviving a recoverable per-player error, not about resolution.
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=list(players)),
    )

    await job.execute(cast(AsyncSession, db))

    assert player_service.update_player_profile.await_count == 2
    assert job.execution_log["errors"][0]["operation"] == "player profile update"
    assert job.execution_log["errors"][0]["context"] == {"puuid": "sanitized-one"}
    db.rollback.assert_awaited_once()
    db.commit.assert_awaited_once()


async def test_optional_account_identity_does_not_erase_known_riot_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
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


async def test_new_player_uses_submitted_riot_id_when_account_omits_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )

    class _Statement:
        def where(self, *_conditions: object) -> _Statement:
            return self

        def limit(self, _count: int) -> _Statement:
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
        execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: None)
        ),
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
        platform=Platform.EUN1,
        user_id=1,
    )

    created_player = db.add.call_args.args[0]
    assert (created_player.game_name, created_player.tag_line) == (
        "Submitted Name",
        "SAFE",
    )
    assert created_player.profile_synced_at is not None


async def test_player_updater_stops_the_whole_run_on_an_api_key_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A rejected key ends the run rather than being retried per player.

    The daily development key expires, and every remaining player would spend
    another rejected call proving it. Nothing covered this branch, so the job
    could have been made to carry on and the suite would have stayed green.
    """
    players = {
        p.puuid: p
        for p in (
            _player("sanitized-one"),
            _player("sanitized-two"),
            _player("sanitized-three"),
        )
    }
    db = SimpleNamespace(
        get=AsyncMock(side_effect=_load_row),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    player_service = SimpleNamespace(
        update_player_profile=AsyncMock(side_effect=AuthenticationError("rejected")),
    )
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return player_service

    monkeypatch.setattr(player_updater_module, "PlayerService", build_player_service)
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=list(players)),
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()

    await job.execute(cast(AsyncSession, db))

    assert player_service.update_player_profile.await_count == 1
    assert job.has_api_key_error() is True
    assert job.execution_log["errors"][0]["operation"] == "player profile update"


async def test_player_updater_reraises_a_database_error_instead_of_recording_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A broken session cannot be reused, so the error leaves the loop.

    Recording it and continuing would run every later player against a session
    that is already unusable, turning one failure into a whole failed run
    reported as a list of unrelated ones.
    """
    players = {"sanitized-one": _player("sanitized-one")}
    db = SimpleNamespace(
        get=AsyncMock(side_effect=_load_row),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )
    player_service = SimpleNamespace(
        update_player_profile=AsyncMock(side_effect=SQLAlchemyError("session is gone")),
    )
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return player_service

    monkeypatch.setattr(player_updater_module, "PlayerService", build_player_service)
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=list(players)),
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()

    with pytest.raises(SQLAlchemyError):
        await job.execute(cast(AsyncSession, db))

    assert job.execution_log.get("errors", []) == []
    db.rollback.assert_awaited_once()
