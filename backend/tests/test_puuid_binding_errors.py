"""Regressions for stale-PUUID classification and job completion bookkeeping."""

from types import SimpleNamespace
from typing import cast

import pytest

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.errors import BadRequestError, PuuidDecryptionError
from app.features.jobs.base import BaseJob
from app.features.jobs.error_handling import is_riot_puuid_binding_error
from app.features.jobs.models import (
    ExecutionType,
    JobConfiguration,
    JobExecution,
    JobStatus,
    PlayerSyncRun,
)
from app.features.jobs.player_sync import _failure_from_job
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.players.service import ACTIVE_RUN_TABLES, PUUID_REFERENCING_TABLES


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
    assert "Search for the player again" in message


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


def _indexed_active_statuses(model, index_name: str) -> set[str]:
    """Read the statuses a table's partial unique index actually covers."""
    for index in model.__table__.indexes:
        if index.name != index_name:
            continue
        predicate = str(index.dialect_options["postgresql"]["where"])
        listed = predicate.split("(")[1].split(")")[0]
        return {entry.strip().strip("'") for entry in listed.split(",")}
    raise AssertionError(f"{index_name} is missing")


@pytest.mark.parametrize(
    ("table", "model", "index_name"),
    [
        (
            "core.matchmaking_analyses",
            MatchmakingAnalysis,
            "uq_matchmaking_analyses_active_puuid",
        ),
        ("jobs.player_sync_runs", PlayerSyncRun, "uq_player_sync_runs_active_puuid"),
    ],
)
def test_migration_closes_exactly_the_indexed_active_statuses(
    table: str, model: object, index_name: str
) -> None:
    """Migration must close every status the partial unique index covers.

    A status left open would move a second active row onto the fresh PUUID and
    violate that index, aborting the whole migration.
    """
    configured = [statuses for name, _, statuses in ACTIVE_RUN_TABLES if name == table]
    assert configured, f"{table} is never closed before repointing"

    assert set(configured[0]) == _indexed_active_statuses(model, index_name)


def test_every_closed_table_is_also_repointed() -> None:
    """Closing a run without moving it would strand it on the deleted PUUID."""
    repointed = {name for name, _, _ in PUUID_REFERENCING_TABLES}

    for table, _, _ in ACTIVE_RUN_TABLES:
        assert table in repointed
