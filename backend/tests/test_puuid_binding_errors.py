"""Regressions for stale-PUUID classification and job completion bookkeeping."""

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import BadRequestError, PuuidDecryptionError
from app.features.jobs import player_sync as player_sync_module
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import is_riot_puuid_binding_error
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
)
from app.features.jobs.player_sync import _failure_from_job, _finish_sync
from app.features.players import service as player_service_module
from app.features.players.service import PlayerService

# `Player` relationships are resolved by name, so every related mapper has to be
# imported before the real model can be instantiated.
from app.features.auth import models as _auth_models  # noqa: F401  isort:skip
from app.features.matches import models as _match_models  # noqa: F401  isort:skip
from app.features.matchmaking_analysis import models as _mm_models  # noqa: F401  isort:skip
from app.features.players import leagues as _league_models  # noqa: F401  isort:skip
from app.features.playstyle_analysis import models as _ps_models  # noqa: F401  isort:skip

FRESH_PUUID = "f" * 78


class _Job(BaseJob):
    """Minimal concrete job used to exercise BaseJob bookkeeping."""

    async def execute(self, db) -> None:  # pragma: no cover - never invoked
        return None


def _client() -> RiotAPIClient:
    return RiotAPIClient(api_key="test-key")


def test_decrypt_400_becomes_puuid_decryption_error() -> None:
    """Riot's decrypt rejection must be distinguishable from any other 400."""
    with pytest.raises(PuuidDecryptionError):
        _client()._raise_client_error_if_needed(
            400, "Bad Request - Exception decrypting SOME_PUUID"
        )


def test_other_400_stays_a_plain_bad_request() -> None:
    """An ordinary parameter rejection must not be treated as a stale PUUID."""
    with pytest.raises(BadRequestError) as excinfo:
        _client()._raise_client_error_if_needed(400, "Bad Request - Invalid queue")

    assert not isinstance(excinfo.value, PuuidDecryptionError)


def test_decrypt_error_carries_no_puuid_payload() -> None:
    """The exception text must not repeat the provider payload."""
    with pytest.raises(PuuidDecryptionError) as excinfo:
        _client()._raise_client_error_if_needed(
            400, "Bad Request - Exception decrypting SECRET_LOOKING_PUUID"
        )

    assert "SECRET_LOOKING_PUUID" not in str(excinfo.value)


def test_status_message_extraction_survives_a_non_json_body() -> None:
    """A malformed error body must not mask the original failure."""

    class _Response:
        @staticmethod
        def json():
            raise ValueError("not json")

    assert RiotAPIClient._extract_riot_status_message(_Response()) is None


def test_status_message_extraction_reads_riot_shape() -> None:
    """Riot nests the human-readable reason under `status.message`."""

    class _Response:
        @staticmethod
        def json():
            return {"status": {"message": "Bad Request - Exception decrypting X"}}

    assert (
        RiotAPIClient._extract_riot_status_message(_Response())
        == "Bad Request - Exception decrypting X"
    )


def test_is_riot_puuid_binding_error_discriminates() -> None:
    """Only the dedicated decrypt error counts as a stale-PUUID signal."""
    assert is_riot_puuid_binding_error(PuuidDecryptionError("stale", status_code=400))
    assert not is_riot_puuid_binding_error(BadRequestError("nope", status_code=400))


def test_record_error_flags_a_binding_failure() -> None:
    """A recorded decrypt error must remain visible to the sync orchestrator."""
    job = _Job(job_config_id=1)
    assert not job.has_puuid_binding_error()

    job.record_error(
        PuuidDecryptionError("stale", status_code=400),
        operation="player league update",
    )

    assert job.has_puuid_binding_error()
    assert not job.has_api_key_error()


def test_get_job_logs_never_touches_the_orm_instance() -> None:
    """A rollback expires ORM attributes, so completion must use the cached id."""

    class _Exploding:
        @property
        def id(self):
            raise AssertionError("expired ORM attribute was read")

    job = _Job(job_config_id=1)
    job.job_execution = cast(JobExecution, _Exploding())
    job.job_execution_id = 4242

    assert job._get_job_logs() == []


def test_failure_from_job_reports_a_stale_player_id() -> None:
    """The player card must explain a stale PUUID instead of a generic failure."""
    job = SimpleNamespace(
        job_execution_id=11,
        job_execution_status=JobStatus.SUCCESS,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: True,
    )

    status, code, message = _failure_from_job(job)

    assert status == "failed"
    assert code == "PLAYER_ID_STALE"
    # Discovery does not repair a stale row, so the message must not promise it.
    assert "re-added" in message
    assert "Search for the player again" not in message


def test_failure_from_job_keeps_the_key_error_precedence() -> None:
    """A rejected API key stays the more actionable diagnosis."""
    job = SimpleNamespace(
        job_execution_id=12,
        job_execution_status=JobStatus.FAILED,
        skipped_as_already_running=False,
        has_api_key_error=lambda: True,
        has_puuid_binding_error=lambda: True,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "RIOT_API_KEY_INVALID"


def test_generic_failure_is_unchanged() -> None:
    """Unclassified failures keep their existing contract."""
    job = SimpleNamespace(
        job_execution_id=13,
        job_execution_status=JobStatus.FAILED,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_FAILED"


def test_test_runs_keep_a_separate_runtime_key() -> None:
    """Guard the unchanged runtime-key contract touched by this module."""
    regular = _Job(job_config_id=7)
    test_run = _Job(job_config_id=7, execution_type=ExecutionType.TEST)

    assert regular.runtime_key == 7
    assert test_run.runtime_key == -7


def test_failure_from_job_never_touches_the_execution_instance() -> None:
    """The job session is already closed, so only cached scalars are safe."""

    class _Exploding:
        @property
        def status(self):
            raise AssertionError("expired ORM attribute was read")

    job = SimpleNamespace(
        job_execution=_Exploding(),
        job_execution_id=99,
        job_execution_status=JobStatus.SUCCESS,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: True,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "PLAYER_ID_STALE"


def test_a_skipped_writer_reports_a_busy_writer() -> None:
    """A writer the scheduler skipped keeps the existing busy contract."""
    job = SimpleNamespace(
        job_execution_id=None,
        job_execution_status=None,
        skipped_as_already_running=True,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_BUSY"


def test_a_failed_start_is_not_reported_as_a_busy_writer() -> None:
    """`run()` swallows a `log_start` failure and returns with no execution id.

    Classifying that database failure as a competing update would tell the user
    to wait for a run that never exists.
    """
    job = SimpleNamespace(
        job_execution_id=None,
        job_execution_status=None,
        skipped_as_already_running=False,
        has_api_key_error=lambda: False,
        has_puuid_binding_error=lambda: False,
    )

    _, code, _ = _failure_from_job(job)

    assert code == "SYNC_FAILED"


class _FailingSession:
    """Session whose every write fails, as a lost connection would."""

    def __init__(self) -> None:
        self.rollbacks = 0

    async def execute(self, *args, **kwargs):
        raise RuntimeError("connection lost")

    async def commit(self) -> None:
        raise RuntimeError("connection lost")

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.mark.asyncio
async def test_completion_flag_requires_a_successful_write() -> None:
    """A swallowed completion-write failure must not disable the run guard."""
    job = _Job(job_config_id=1)
    job.job_execution_id = 7
    job.job_execution = cast(JobExecution, SimpleNamespace())
    job.job_config = cast(JobConfiguration, SimpleNamespace())
    job.job_config_name = "test job"
    job.job_config_type_value = "match_fetcher"
    db = _FailingSession()

    await job.log_completion(cast(object, db), success=True)  # type: ignore[arg-type]

    assert job._completion_logged is False
    # A status the database never accepted must not reach the classifier.
    assert job.job_execution_status is None


@pytest.mark.asyncio
async def test_a_failed_completion_write_does_not_publish_its_status() -> None:
    """The fallback persists FAILED, so a cached CANCELLED would contradict it."""
    job = _Job(job_config_id=1)
    job.job_execution_id = 8
    job.job_execution = cast(JobExecution, SimpleNamespace())
    job.job_config = cast(JobConfiguration, SimpleNamespace())
    job.job_config_name = "test job"
    job.job_config_type_value = "match_fetcher"
    db = _FailingSession()

    await job.log_completion(
        cast(object, db),  # type: ignore[arg-type]
        success=True,
        status=JobStatus.CANCELLED,
    )

    assert job.job_execution_status is not JobStatus.CANCELLED


class _RecordingSession:
    """Session that hands back one row and records whether a write happened."""

    def __init__(self, run: object) -> None:
        self._run = run
        self.committed = False
        self.locked = False

    async def get(self, _model, _identity, with_for_update: bool = False):
        self.locked = with_for_update
        return self._run

    async def commit(self) -> None:
        self.committed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc) -> None:
        return None


@pytest.mark.asyncio
async def test_a_cancelled_sync_run_is_never_reopened(monkeypatch) -> None:
    """An operator stop or startup recovery may cancel a run mid-flight.

    The orchestrator may still be running, and an unguarded write would set that
    terminal row back to `running` and could then collide with a replacement run
    on the same PUUID.
    """
    run = SimpleNamespace(status="cancelled", started_at=None, completed_at=None)
    session = _RecordingSession(run)
    monkeypatch.setattr(player_sync_module.db_manager, "get_session", lambda: session)

    await _finish_sync(1, status="running")

    assert run.status == "cancelled"
    assert session.committed is False
    assert session.locked is True, "the row must be locked against a concurrent write"


@pytest.mark.asyncio
async def test_an_active_sync_run_still_advances(monkeypatch) -> None:
    """The guard must not block the ordinary lifecycle."""
    run = SimpleNamespace(
        status="pending",
        started_at=None,
        completed_at=None,
        error_code=None,
        error_message=None,
        updated_at=None,
    )
    session = _RecordingSession(run)
    monkeypatch.setattr(player_sync_module.db_manager, "get_session", lambda: session)

    await _finish_sync(1, status="running")

    assert run.status == "running"
    assert session.committed is True


class _NoMergeSession:
    """Session that fails the test if discovery reaches for another player row.

    Discovery may look the resolved PUUID up by primary key and insert or update
    that one row. Any statement execution, bulk query, or delete would mean it
    went looking for rows sharing the Riot ID, which is exactly the merge this
    regression forbids.
    """

    def __init__(self) -> None:
        self.added: list[Any] = []

    async def get(self, _model, identity, **_kwargs):
        assert identity == FRESH_PUUID, "discovery must only load the resolved PUUID"
        return None

    def add(self, instance: Any) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: Any) -> None:
        instance.created_at = datetime.now(timezone.utc)
        instance.updated_at = datetime.now(timezone.utc)

    async def execute(self, *_args, **_kwargs):
        raise AssertionError("discovery must not run a statement against other rows")

    async def scalars(self, *_args, **_kwargs):
        raise AssertionError("discovery must not search for rows sharing the Riot ID")

    async def scalar(self, *_args, **_kwargs):
        raise AssertionError("discovery must not search for rows sharing the Riot ID")

    async def delete(self, *_args, **_kwargs):
        raise AssertionError("discovery must never delete a player row")

    def expunge(self, *_args, **_kwargs):
        raise AssertionError("discovery must not detach another player row")


@pytest.mark.asyncio
async def test_discovery_never_merges_a_row_sharing_the_riot_id(monkeypatch) -> None:
    """A stale-looking row must survive discovery untouched.

    Discovery cannot tell a PUUID re-encrypted under a new developer account
    apart from a Riot ID renamed away and reclaimed by someone else. Every table
    referencing `core.players(puuid)` cascades on delete, so a wrong merge would
    destroy one player's history. A duplicate row is the accepted outcome.
    """
    monkeypatch.setattr(
        player_service_module,
        "_ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    session = _NoMergeSession()
    service = PlayerService(cast(AsyncSession, session))
    riot_client = SimpleNamespace(
        get_account_by_riot_id=AsyncMock(
            return_value=SimpleNamespace(
                puuid=FRESH_PUUID, game_name="Shared Name", tag_line="TAG"
            )
        ),
        get_summoner_by_puuid=AsyncMock(
            return_value=SimpleNamespace(profile_icon_id=7, summoner_level=42)
        ),
    )

    response = await service.discover_player(
        riot_client=cast(RiotAPIClient, riot_client),
        game_name="Shared Name",
        tag_line="TAG",
        platform="eun1",
    )

    assert response.puuid == FRESH_PUUID
    assert [player.puuid for player in session.added] == [FRESH_PUUID]


class _CapturingSession:
    """Session that records the statements startup recovery issues."""

    def __init__(self) -> None:
        self.executed: list[Any] = []
        self.committed = False

    async def execute(self, statement):
        self.executed.append(statement)
        return SimpleNamespace(rowcount=1)

    async def commit(self) -> None:
        self.committed = True

    async def rollback(self) -> None:  # pragma: no cover - failure path only
        return None


def _compiled(statement) -> tuple[str, dict[str, Any]]:
    """Return one UPDATE's target table and its bound parameter values."""
    compiled = statement.compile()
    return statement.table.fullname, dict(compiled.params)


@pytest.mark.asyncio
async def test_startup_cancels_orphaned_application_runs() -> None:
    """A restart must terminalize runs whose in-process worker is gone.

    Both tables allow one active row per PUUID and their routes hand back an
    existing active row instead of scheduling work, so an orphan left by an
    ungraceful shutdown would block that player permanently.
    """
    from app.features.jobs.scheduler import _cancel_orphaned_application_runs

    session = _CapturingSession()

    await _cancel_orphaned_application_runs(cast(AsyncSession, session))

    assert session.committed is True
    written = dict(_compiled(statement) for statement in session.executed)
    assert set(written) == {"jobs.player_sync_runs", "core.matchmaking_analyses"}

    sync = written["jobs.player_sync_runs"]
    assert sync["status"] == "cancelled"
    assert sync["completed_at"] is not None
    assert sync["error_code"] == "SYNC_CANCELLED"
    # A Core update bypasses the model's application-side onupdate.
    assert sync["updated_at"] is not None

    analysis = written["core.matchmaking_analyses"]
    assert analysis["status"] == "cancelled"
    assert analysis["completed_at"] is not None
    # Every other terminal transition clears the wait deadline.
    assert analysis["rate_limit_reset_at"] is None
    assert "updated_at" not in analysis, "MatchmakingAnalysis has no updated_at column"


@pytest.mark.asyncio
async def test_startup_recovery_covers_every_indexed_active_status() -> None:
    """Leaving a status out would strand exactly the rows this must release."""
    from app.features.jobs.scheduler import _cancel_orphaned_application_runs

    session = _CapturingSession()

    await _cancel_orphaned_application_runs(cast(AsyncSession, session))

    predicates = {
        statement.table.fullname: str(
            statement.whereclause.compile(compile_kwargs={"literal_binds": True})
        )
        for statement in session.executed
    }
    for status in ("pending", "running"):
        assert status in predicates["jobs.player_sync_runs"]
    for status in ("pending", "in_progress", "waiting_rate_limit"):
        assert status in predicates["core.matchmaking_analyses"]


@pytest.mark.asyncio
async def test_scheduler_startup_runs_application_run_recovery(monkeypatch) -> None:
    """The helper is only useful if startup actually calls it.

    Asserted separately from its behavior, because a test that calls the helper
    directly would still pass if the production call site were deleted.
    """
    from app.features.jobs import scheduler as scheduler_module

    calls: list[str] = []

    class _Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc) -> None:
            return None

    monkeypatch.setattr(scheduler_module.db_manager, "get_session", lambda: _Session())
    monkeypatch.setattr(
        scheduler_module,
        "_mark_stale_jobs_as_failed",
        AsyncMock(side_effect=lambda _db: calls.append("executions")),
    )
    monkeypatch.setattr(
        scheduler_module,
        "_cancel_orphaned_application_runs",
        AsyncMock(side_effect=lambda _db: calls.append("application_runs")),
    )

    await scheduler_module._run_startup_recovery()

    assert calls == ["executions", "application_runs"]
