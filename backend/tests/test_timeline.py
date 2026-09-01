"""Timeline row construction regressions."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Region
from app.core.riot_api.models import MatchTimelineDTO
from app.features.matches import match_sync
from app.features.matches.match_sync import (
    QueueSyncContext,
    build_synthetic_match_dto,
)
from app.features.matches.participants import MatchParticipant
from app.features.matches.timeline import (
    build_match_timeline_rows,
    replace_match_timeline_rows,
)


def test_synthetic_dto_includes_stored_game_version() -> None:
    # `build_synthetic_match_dto` reads only these three attributes; a real
    # mapped instance would drag the whole ORM registry into a unit test.
    participant = cast(
        MatchParticipant, SimpleNamespace(participant_id=1, team_id=100, puuid="p1")
    )
    dto = build_synthetic_match_dto("EUN1_1", [participant], "16.1.1")
    assert dto.info.game_version == "16.1.1"
    assert dto.metadata.match_id == "EUN1_1"


def test_timeline_rows_tolerate_missing_game_version() -> None:
    # A match with no recorded version reaches timeline replacement as a
    # synthetic DTO whose `game_version` defaults to "" — the backfill path.
    participant = cast(
        MatchParticipant, SimpleNamespace(participant_id=1, team_id=100, puuid="p1")
    )
    match_dto = build_synthetic_match_dto("EUN1_1", [participant])
    rows = build_match_timeline_rows(
        match_dto,
        MatchTimelineDTO.model_validate(
            {
                "metadata": {"matchId": "EUN1_1", "participants": []},
                "info": {
                    "frameInterval": 60000,
                    "frames": [{"timestamp": 0, "events": []}],
                },
            }
        ),
    )
    # `rows == [] or ...` was the assertion here, which an empty return
    # satisfies -- the opposite of tolerating the missing version.
    assert len(rows) == 1
    assert rows[0]["match_id"] == "EUN1_1"


class _Rows:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def scalars(self) -> _Rows:
        return self

    def all(self) -> list[object]:
        return self._rows

    def scalar_one_or_none(self) -> str:
        return "16.1.1"


class _CommitFailsSession:
    """A session whose commit fails, so the caller's recovery is observable.

    A failed commit leaves the transaction aborted until something rolls it
    back, and the Match Fetcher runs many matches on one session.
    """

    def __init__(self, participants: list[object]) -> None:
        self.rollbacks = 0
        self._participants = participants

    async def execute(self, _statement: object) -> _Rows:
        return _Rows(self._participants)

    async def commit(self) -> None:
        raise SQLAlchemyError("commit refused")

    async def rollback(self) -> None:
        self.rollbacks += 1


async def test_a_failed_timeline_backfill_leaves_the_session_usable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored = [
        cast(
            MatchParticipant,
            SimpleNamespace(participant_id=index, team_id=100, puuid=f"p{index}"),
        )
        for index in range(1, 11)
    ]
    session = _CommitFailsSession(list(stored))

    async def fetch(*_args: object, **_kwargs: object) -> tuple[object, bool]:
        return object(), False

    monkeypatch.setattr(match_sync, "fetch_sync_timeline", fetch)
    monkeypatch.setattr(
        match_sync, "ensure_riot_writer_maintenance_is_inactive", AsyncMock()
    )
    monkeypatch.setattr(
        match_sync, "replace_match_timeline_rows", AsyncMock(return_value=10)
    )

    with pytest.raises(SQLAlchemyError):
        await match_sync.backfill_timeline_only_match(
            QueueSyncContext(
                session=cast(AsyncSession, session),
                riot_client=cast(RiotAPIClient, object()),
                puuid="sanitized-puuid",
                region=Region.EUROPE,
                queue_id=420,
                on_failure=None,
                reprocess_match=AsyncMock(),
                on_match_stored=None,
            ),
            "EUN1_1",
        )

    assert session.rollbacks == 1


def test_a_row_level_integrity_error_does_not_fail_the_whole_run() -> None:
    """One bad match is skipped; a broken session still stops the run.

    Both writers roll back before re-raising, so the session survives an
    IntegrityError; a lost connection has no such guarantee.
    """
    integrity = IntegrityError("insert", {}, ValueError("fk violation"))

    wrapped = RuntimeError("wrapped")
    wrapped.__cause__ = integrity

    assert match_sync.must_abort_writer_sync(integrity) is False
    assert match_sync.must_abort_writer_sync(wrapped) is False
    assert match_sync.must_abort_writer_sync(OperationalError("select", {}, OSError()))


async def test_timeline_rows_are_staged_only_after_a_flush() -> None:
    """The order these rows depend on, asserted instead of inherited.

    Both foreign keys point at rows the same transaction holds pending under
    `autoflush=False`, and only `relationship()` orders a flush across mappers.
    """
    calls: list[str] = []

    class _RecordingSession:
        async def execute(self, *_args: object, **_kwargs: object) -> None:
            calls.append("execute")

        async def flush(self) -> None:
            calls.append("flush")

        def add(self, _instance: object) -> None:
            calls.append("add")

    participants = [
        cast(
            MatchParticipant,
            SimpleNamespace(participant_id=index, team_id=100, puuid=f"p{index}"),
        )
        for index in range(1, 11)
    ]
    timeline = MatchTimelineDTO.model_validate(
        {
            "metadata": {"matchId": "EUN1_1", "participants": []},
            "info": {"frames": [], "frameInterval": 60000},
        }
    )

    written = await replace_match_timeline_rows(
        cast(AsyncSession, _RecordingSession()),
        build_synthetic_match_dto("EUN1_1", participants, "16.1.1"),
        timeline,
    )

    assert written == 10
    # Signal first: no rows staged would make any ordering claim vacuous.
    assert calls.count("add") == 10
    assert calls.index("flush") < calls.index("add")
