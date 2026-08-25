"""A skippable player error must not end the run.

`handle_player_error` rolls the session back, and `AsyncSession.rollback`
expires every instance the session holds -- so a row the loop still holds
answers its next read with a lazy refresh that raises under asyncio.
"""

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import instance_state

from app.features.jobs.implementations import match_fetcher as match_fetcher_module
from app.features.jobs.implementations import player_updater as player_updater_module
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.models import JobConfiguration
from app.features.players.models import Player


class _FakeRiotClient:
    def __init__(self, **_kwargs: object) -> None:
        return None

    async def __aenter__(self) -> _FakeRiotClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def get_api_calls(self) -> list[object]:
        return []


class _ExpiringSession:
    """Hands out rows and expires every one of them on rollback.

    That is what `Session.rollback` does; expiring through
    `instance_state` rather than a hand-written flag is what makes reading an
    expired row here fail the same way it fails in production.
    """

    def __init__(self) -> None:
        self.handed_out: list[Player] = []
        self.stored: dict[int, dict[str, object]] = {}
        self.rollbacks = 0
        self.refreshes = 0

    async def get(self, _model: type[Player], puuid: str) -> Player:
        row = Player(
            puuid=puuid,
            game_name="Sanitized",
            tag_line="TEST",
            platform="eun1",
            summoner_level=1,
            profile_icon_id=1,
        )
        self.handed_out.append(row)
        self.stored[id(row)] = dict(instance_state(row).dict)
        return row

    async def rollback(self) -> None:
        self.rollbacks += 1
        for row in self.handed_out:
            state = instance_state(row)
            state._expire(state.dict, set())

    async def refresh(self, row: Player) -> None:
        """Reload the row, which is what makes an expired instance readable."""
        self.refreshes += 1
        instance_state(row).dict.update(self.stored[id(row)])

    async def commit(self) -> None:
        return None


PUUIDS = ["sanitized-one", "sanitized-two", "sanitized-three"]


async def test_player_updater_keeps_going_after_a_rolled_back_player(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _ExpiringSession()
    attempts: list[str] = []

    async def update_player_profile(player: Player, _client: object) -> bool:
        attempts.append(player.puuid)
        if len(attempts) == 1:
            raise RuntimeError("provider failure")
        return False

    monkeypatch.setattr(
        PlayerUpdaterJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return SimpleNamespace(update_player_profile=update_player_profile)

    monkeypatch.setattr(player_updater_module, "PlayerService", build_player_service)
    monkeypatch.setattr(
        PlayerUpdaterJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=PUUIDS),
    )

    job = PlayerUpdaterJob(job_config_id=7)
    job.check_control_state = AsyncMock()

    await job.execute(cast(AsyncSession, session))

    assert session.rollbacks == 1
    assert attempts == PUUIDS


async def test_match_fetcher_keeps_going_after_a_rolled_back_player(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _ExpiringSession()
    attempts: list[str] = []

    async def sync_matches_for_player(
        _client: object, player: Player, **_kwargs: object
    ) -> int:
        attempts.append(player.puuid)
        if len(attempts) == 1:
            raise RuntimeError("provider failure")
        return 0

    monkeypatch.setattr(
        MatchFetcherJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return SimpleNamespace(
            get_player_league=AsyncMock(return_value=None),
            update_player_league=AsyncMock(return_value=False),
        )

    def build_match_service(_db: object) -> SimpleNamespace:
        return SimpleNamespace(sync_matches_for_player=sync_matches_for_player)

    monkeypatch.setattr(match_fetcher_module, "PlayerService", build_player_service)
    monkeypatch.setattr(match_fetcher_module, "MatchService", build_match_service)
    monkeypatch.setattr(
        MatchFetcherJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=PUUIDS),
    )

    job = MatchFetcherJob(job_config_id=7)
    job.job_config = cast(JobConfiguration, SimpleNamespace(config_json={}))
    job.check_control_state = AsyncMock()

    await job.execute(cast(AsyncSession, session))

    assert session.rollbacks == 1
    assert attempts == PUUIDS


async def test_match_fetcher_survives_a_rollback_inside_the_match_sync(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A skipped match rolls back mid-iteration, then reports itself.

    `process_queue_sync_match` swallows a row-level IntegrityError and calls
    the job's `on_failure` after the writer has rolled the session back, so an
    `on_failure` that reads the expired `Player` turns a skip into a dead run.
    """
    session = _ExpiringSession()
    attempts: list[str] = []

    async def sync_matches_for_player(
        _client: object,
        player: Player,
        *,
        on_failure: object,
        **_kwargs: object,
    ) -> int:
        attempts.append(player.puuid)
        if len(attempts) == 1:
            # What `upsert_match` does before `process_queue_sync_match`
            # swallows the error and reports it.
            await session.rollback()
            cast(Any, on_failure)(
                "match synchronization",
                IntegrityError("insert", {}, ValueError("fk violation")),
                {"queue_id": 420, "match_id": "EUN1_1"},
            )
        return 0

    monkeypatch.setattr(
        MatchFetcherJob,
        "get_job_riot_api_client",
        AsyncMock(return_value=_FakeRiotClient()),
    )

    def build_player_service(_db: object) -> SimpleNamespace:
        return SimpleNamespace(
            get_player_league=AsyncMock(return_value=None),
            update_player_league=AsyncMock(return_value=False),
        )

    def build_match_service(_db: object) -> SimpleNamespace:
        return SimpleNamespace(sync_matches_for_player=sync_matches_for_player)

    monkeypatch.setattr(match_fetcher_module, "PlayerService", build_player_service)
    monkeypatch.setattr(match_fetcher_module, "MatchService", build_match_service)
    monkeypatch.setattr(
        MatchFetcherJob,
        "_load_tracked_puuids",
        AsyncMock(return_value=PUUIDS),
    )

    job = MatchFetcherJob(job_config_id=7)
    job.job_config = cast(JobConfiguration, SimpleNamespace(config_json={}))
    job.check_control_state = AsyncMock()

    await job.execute(cast(AsyncSession, session))

    assert attempts == PUUIDS
    assert session.refreshes == 1
