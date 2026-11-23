"""The explicit player update against a run someone else has closed.

Startup recovery, an operator or a shutdown can end a `PlayerSyncRun` while
its orchestrator is between writers. What it does next decides whether one
Riot key ends up with two writers, so these drive the real orchestrator.
"""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.features.jobs import player_sync as player_sync_module
from app.features.jobs.base import BaseJob, JobStopSignal
from app.features.jobs.implementations.match_fetcher import MatchFetcherJob
from app.features.jobs.implementations.player_updater import PlayerUpdaterJob
from app.features.jobs.models import JobStatus, JobType
from app.features.matches.service import MatchService
from app.features.players.models import Player
from app.features.players.service import PlayerService

SYNC_ID = 9


class _ScalarsResult:
    """The result of the one query the orchestrator runs: its two writers."""

    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarsResult:
        return self

    def all(self) -> list[object]:
        return self._rows


class _SyncRunSession:
    """Every session the orchestrator opens, over one in-memory run row."""

    def __init__(self, sync_run: SimpleNamespace) -> None:
        self.sync_run = sync_run
        self.cancel_on_query = False

    async def get(self, _model: object, _sync_id: int, **_options: object) -> object:
        return self.sync_run

    async def execute(self, _statement: object) -> _ScalarsResult:
        if self.cancel_on_query:
            self.sync_run.status = "cancelled"
        return _ScalarsResult(
            [
                SimpleNamespace(id=1, job_type=JobType.MATCH_FETCHER),
                SimpleNamespace(id=2, job_type=JobType.PLAYER_UPDATER),
            ]
        )

    async def commit(self) -> None:
        return None


@pytest.fixture
def sync_session(monkeypatch: pytest.MonkeyPatch) -> _SyncRunSession:
    """One active run, reachable through the orchestrator's own sessions."""
    session = _SyncRunSession(
        SimpleNamespace(
            id=SYNC_ID,
            puuid="player-puuid",
            status="pending",
            error_code=None,
            error_message=None,
            match_execution_id=None,
            profile_execution_id=None,
            started_at=None,
            completed_at=None,
        )
    )

    @asynccontextmanager
    async def get_session() -> AsyncGenerator[_SyncRunSession]:
        yield session

    monkeypatch.setattr(player_sync_module.db_manager, "get_session", get_session)
    return session


def _successful_writer(execution_id: int) -> BaseJob:
    """A writer that finished `SUCCESS` without warnings."""
    return cast(
        BaseJob,
        SimpleNamespace(
            job_execution_id=execution_id,
            job_execution_status=JobStatus.SUCCESS,
            skipped_as_already_running=False,
            has_errors=lambda: False,
            has_api_key_error=lambda: False,
            has_puuid_binding_error=lambda: False,
        ),
    )


async def test_a_cancelled_run_never_starts_the_player_updater(
    monkeypatch: pytest.MonkeyPatch, sync_session: _SyncRunSession
) -> None:
    """A run closed during its match fetch must not start a second writer.

    The orchestrator could not tell a refused write from a stored one, so it
    ran the Player Updater for a run the new process had already cancelled.
    """
    started: list[type[BaseJob]] = []

    async def run_writer(
        job_cls: type[BaseJob], _config_id: int, _puuid: str
    ) -> BaseJob:
        started.append(job_cls)
        sync_session.sync_run.status = "cancelled"
        return _successful_writer(31)

    monkeypatch.setattr(player_sync_module, "_run_sync_writer", run_writer)

    await player_sync_module.run_player_sync(SYNC_ID)

    assert started == [MatchFetcherJob]
    assert sync_session.sync_run.status == "cancelled"
    assert sync_session.sync_run.match_execution_id is None


async def test_a_run_cancelled_before_its_first_writer_starts_none(
    monkeypatch: pytest.MonkeyPatch, sync_session: _SyncRunSession
) -> None:
    """The first lifecycle write is a gate too, not only the one in between."""
    started: list[type[BaseJob]] = []

    async def run_writer(
        job_cls: type[BaseJob], _config_id: int, _puuid: str
    ) -> BaseJob:
        started.append(job_cls)
        return _successful_writer(31)

    monkeypatch.setattr(player_sync_module, "_run_sync_writer", run_writer)
    sync_session.cancel_on_query = True

    await player_sync_module.run_player_sync(SYNC_ID)

    assert started == []
    assert sync_session.sync_run.started_at is None


async def test_an_undisturbed_run_still_runs_both_writers(
    monkeypatch: pytest.MonkeyPatch, sync_session: _SyncRunSession
) -> None:
    """The gates must not cost a healthy update its Player Updater."""
    started: list[type[BaseJob]] = []

    async def run_writer(
        job_cls: type[BaseJob], _config_id: int, _puuid: str
    ) -> BaseJob:
        started.append(job_cls)
        return _successful_writer(31 + len(started))

    monkeypatch.setattr(player_sync_module, "_run_sync_writer", run_writer)

    await player_sync_module.run_player_sync(SYNC_ID)

    assert started == [MatchFetcherJob, PlayerUpdaterJob]
    assert sync_session.sync_run.status == "completed"
    assert sync_session.sync_run.match_execution_id == 32
    assert sync_session.sync_run.profile_execution_id == 33


async def test_shutdown_between_writers_closes_the_run_as_cancelled(
    monkeypatch: pytest.MonkeyPatch, sync_session: _SyncRunSession
) -> None:
    """A cancelled orchestrator leaves a run the Player Card can restart.

    Left `running`, the run blocks its player (one active run per PUUID) and
    every other player's update until the next start's recovery closes it.
    """

    async def cancelled_writer(
        _job_cls: type[BaseJob], _config_id: int, _puuid: str
    ) -> BaseJob:
        raise asyncio.CancelledError

    monkeypatch.setattr(player_sync_module, "_run_sync_writer", cancelled_writer)

    with pytest.raises(asyncio.CancelledError):
        await player_sync_module.run_player_sync(SYNC_ID)

    assert sync_session.sync_run.status == "cancelled"
    assert sync_session.sync_run.error_code == "SYNC_CANCELLED"
    assert sync_session.sync_run.completed_at is not None


class _OwnershipSession:
    """Answers a writer's ownership read from a status the test can change."""

    def __init__(self, player: Player) -> None:
        self.player = player
        self.stored_status = JobStatus.RUNNING
        self.commits = 0

    async def scalar(self, _statement: object) -> JobStatus:
        return self.stored_status

    async def get(self, _model: object, _puuid: str) -> Player:
        return self.player

    async def commit(self) -> None:
        self.commits += 1

    async def flush(self) -> None:
        return None


def _player() -> Player:
    """One unattached tracked player that has never been synced."""
    return Player(
        puuid="sanitized-puuid",
        game_name="Sanitized",
        tag_line="EUN1",
        platform="eun1",
        summoner_level=30,
        profile_icon_id=29,
    )


def _fetcher_owning_execution(execution_id: int = 31) -> MatchFetcherJob:
    """A Match Fetcher mid-run, past the point where it recorded its start."""
    job = MatchFetcherJob(1)
    job.job_execution_id = execution_id
    return job


async def test_a_superseded_run_does_not_advance_synced_at(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fetch that lost its row mid-player must not vouch for freshness.

    The match sync can take minutes; a restart inside it cancels the row, and
    a timestamp or league snapshot written afterwards belongs to no run.
    """
    player = _player()
    session = _OwnershipSession(player)
    job = _fetcher_owning_execution()

    async def sync_matches(*_args: object, **_kwargs: object) -> int:
        session.stored_status = JobStatus.CANCELLED
        return 3

    player_service = SimpleNamespace(
        get_player_league=AsyncMock(return_value=None),
        update_player_league=AsyncMock(return_value=True),
    )
    match_service = SimpleNamespace(sync_matches_for_player=sync_matches)

    with pytest.raises(JobStopSignal, match="ownership_lost"):
        await job._process_player(
            cast(AsyncSession, session),
            player,
            cast(PlayerService, player_service),
            cast(MatchService, match_service),
            cast(RiotAPIClient, object()),
        )

    assert player.match_synced_at is None
    assert player.league_synced_at is None
    player_service.update_player_league.assert_not_awaited()
    assert session.commits == 0


async def test_a_run_that_owns_its_row_advances_synced_at(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The checkpoint must not cost a healthy fetch its freshness evidence."""
    player = _player()
    session = _OwnershipSession(player)
    job = _fetcher_owning_execution()
    monkeypatch.setattr(
        "app.features.jobs.implementations.match_fetcher.persist_match_lp_observations",
        AsyncMock(return_value=0),
    )
    player_service = SimpleNamespace(
        get_player_league=AsyncMock(return_value=None),
        update_player_league=AsyncMock(return_value=False),
    )
    match_service = SimpleNamespace(sync_matches_for_player=AsyncMock(return_value=3))

    await job._process_player(
        cast(AsyncSession, session),
        player,
        cast(PlayerService, player_service),
        cast(MatchService, match_service),
        cast(RiotAPIClient, object()),
    )

    assert player.match_synced_at is not None
    assert player.league_synced_at is not None


async def test_losing_the_row_stops_the_loop_instead_of_failing_one_player() -> None:
    """The stop signal is not a player error the loop may record and pass.

    Swallowed there, a superseded run would mark the player failed and carry
    on to the next one, which is the work the checkpoint exists to prevent.
    """
    session = _OwnershipSession(_player())
    job = _fetcher_owning_execution()
    job._process_player = AsyncMock(
        side_effect=JobStopSignal(force=True, reason="ownership_lost")
    )

    with pytest.raises(JobStopSignal, match="ownership_lost"):
        await job._process_tracked_players(
            cast(AsyncSession, session),
            ["first-puuid", "second-puuid"],
            cast(PlayerService, object()),
            cast(MatchService, object()),
            cast(RiotAPIClient, object()),
        )

    assert job._process_player.await_count == 1
    assert job.has_errors() is False
