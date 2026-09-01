"""Which account a stored analysis answers to, asserted by running the query.

A mocked `db.execute` cannot see a predicate, so these run the real statements
against in-memory SQLite; two accounts share one Riot player throughout.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.sql.compiler import GenericTypeCompiler

from app.core.riot_api.client import RiotAPIClient
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService
from app.features.smurf_boost_detection.models import SmurfBoostAnalysis
from app.features.smurf_boost_detection.service import SmurfBoostDetectionService
from app.model_registry import import_all_models

# SQLAlchemy resolves the `auth.users` foreign keys through the metadata, so
# creating the two tables under test fails unless every model is imported.
import_all_models()


# Registered by the decorator, never called by name -- SQLAlchemy reaches it
# through the dialect when it renders the DDL below.
@compiles(JSONB, "sqlite")
def _render_jsonb_as_json(  # pyright: ignore[reportUnusedFunction]
    _type: JSONB, _compiler: GenericTypeCompiler, **_kw: Any
) -> str:
    """Let the Postgres models build on SQLite.

    Only the DDL differs; SQLite stores the same JSON text and every predicate
    under test is on `user_id`, `puuid`, `created_at` and `status`.
    """
    return "JSON"


# Two real accounts. `OTHER` is always the one that must not be reachable.
MINE = 9
OTHER = 10

PUUID = "p" * 78
# A second player is needed for two rows under one account: SQLite ignores
# `postgresql_where`, so the partial unique index is unconditional here.
OTHER_PUUID = "q" * 78


def _naive(moment: datetime) -> datetime:
    """SQLite hands back what it stored, without the offset it never kept."""
    return moment.replace(tzinfo=None)


class _SyncSessionShim:
    """The async surface both services use, over a synchronous session."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    async def commit(self) -> None:
        self._session.commit()

    async def delete(self, instance: Any) -> None:
        self._session.delete(instance)


@pytest.fixture
def session() -> Iterator[Session]:
    engine: Engine = create_engine("sqlite://")

    def _attach_schemas(dbapi_connection: Any, _record: Any) -> None:
        # Both models live in `core`; the FK they now carry names `auth`.
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS core")
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS auth")

    event.listen(engine, "connect", _attach_schemas)
    # The FK target tables are left uncreated: SQLite does not enforce a key
    # into an absent table unless asked, and the WHERE clause is the subject.
    cast(Table, SmurfBoostAnalysis.__table__).create(engine)
    cast(Table, MatchmakingAnalysis.__table__).create(engine)
    with Session(engine) as open_session:
        yield open_session
    engine.dispose()


def _smurf_service(session: Session, user_id: int) -> SmurfBoostDetectionService:
    service = SmurfBoostDetectionService(cast(Any, _SyncSessionShim(session)), user_id)
    # `get_latest`'s staleness flag reads match tables whose column types
    # SQLite will not render, and staleness is not under test here.
    service._newest_eligible_match_id = _no_newest_match  # type: ignore[method-assign]
    return service


async def _no_newest_match(_puuid: str) -> str | None:
    return None


def _matchmaking_service(session: Session, user_id: int) -> MatchmakingAnalysisService:
    return MatchmakingAnalysisService(
        cast(Any, _SyncSessionShim(session)),
        cast(RiotAPIClient, object()),
        user_id,
    )


def _store_smurf(
    session: Session,
    *,
    user_id: int,
    created_at: datetime,
    thresholds: dict[str, float],
) -> datetime:
    session.add(
        SmurfBoostAnalysis(
            user_id=user_id,
            puuid=PUUID,
            created_at=created_at,
            status="completed",
            model_version="smurf-boost/v1",
            thresholds=thresholds,
            results=None,
            eligible_games=120,
            latest_match_id=None,
            completed_at=created_at,
        )
    )
    session.commit()
    return created_at


def _store_matchmaking(
    session: Session,
    *,
    user_id: int,
    created_at: datetime,
    status: str = "completed",
    puuid: str = PUUID,
) -> datetime:
    session.add(
        MatchmakingAnalysis(
            user_id=user_id,
            puuid=puuid,
            created_at=created_at,
            status=status,
            puuid_progress={},
            results=(
                {
                    "team_avg_winrate": 0.5,
                    "enemy_avg_winrate": 0.5,
                    "matches_analyzed": 10,
                }
                if status == "completed"
                else None
            ),
        )
    )
    session.commit()
    return created_at


# --- Rank Manipulation ---


async def test_the_newest_run_read_back_is_the_callers_own(session: Session) -> None:
    """The defect, stated as a test.

    A run carries back the per-account thresholds it was scored against, so
    the other account's newer run renders somebody else's settings.
    """
    now = datetime.now(UTC)
    mine = _store_smurf(
        session,
        user_id=MINE,
        created_at=now - timedelta(minutes=5),
        thresholds={"recent_window_size": 20.0},
    )
    _store_smurf(
        session,
        user_id=OTHER,
        created_at=now,
        thresholds={"recent_window_size": 15.0},
    )

    latest = await _smurf_service(session, MINE).get_latest(PUUID)

    assert latest is not None
    assert latest.created_at == _naive(mine)
    assert latest.thresholds == {"recent_window_size": 20.0}


async def test_an_account_with_no_run_of_its_own_is_told_so(
    session: Session,
) -> None:
    """Not "shown the other account's", which is what it used to be."""
    _store_smurf(
        session,
        user_id=OTHER,
        created_at=datetime.now(UTC),
        thresholds={"recent_window_size": 15.0},
    )

    assert await _smurf_service(session, MINE).get_latest(PUUID) is None


async def test_expiring_abandoned_runs_leaves_another_account_running(
    session: Session,
) -> None:
    """Reading is a write here, and the write was unowned too.

    `get_latest` terminalizes an active row older than the lease, so unowned
    that write lets one account's read fail another's in-flight run.
    """
    stale = datetime.now(UTC) - timedelta(hours=2)
    session.add(
        SmurfBoostAnalysis(
            user_id=OTHER,
            puuid=PUUID,
            created_at=stale,
            status="in_progress",
            model_version="smurf-boost/v1",
            thresholds={"recent_window_size": 20.0},
            eligible_games=0,
        )
    )
    session.commit()

    await _smurf_service(session, MINE).get_latest(PUUID)

    session.expire_all()
    survived = session.get(SmurfBoostAnalysis, (PUUID, stale))
    assert survived is not None
    assert survived.status == "in_progress"


# --- Matchmaking Analysis ---


async def test_another_accounts_running_analysis_cannot_be_cancelled(
    session: Session,
) -> None:
    """`created_at` identifies a run; it was also all that authorised one.

    The status and history endpoints hand it to any signed-in caller, so this
    was reachable by reading a response and reflecting one field back.
    """
    created_at = _store_matchmaking(
        session, user_id=OTHER, created_at=datetime.now(UTC), status="in_progress"
    )

    cancelled = await _matchmaking_service(session, MINE).cancel_analysis(
        PUUID, created_at
    )

    session.expire_all()
    assert cancelled is False
    survived = session.get(MatchmakingAnalysis, (PUUID, created_at))
    assert survived is not None
    assert survived.status == "in_progress"


async def test_another_accounts_completed_record_cannot_be_deleted(
    session: Session,
) -> None:
    """The destructive half, and the one with no undo."""
    created_at = _store_matchmaking(
        session, user_id=OTHER, created_at=datetime.now(UTC)
    )

    deleted = await _matchmaking_service(session, MINE).delete_analysis(
        PUUID, created_at
    )

    session.expire_all()
    assert deleted is False
    assert session.get(MatchmakingAnalysis, (PUUID, created_at)) is not None


async def test_an_account_can_still_cancel_and_delete_its_own(
    session: Session,
) -> None:
    """The guard refuses the other account, not everybody.

    Without this, scoping every predicate to a user who owns nothing would
    pass the two tests above just as well.
    """
    service = _matchmaking_service(session, MINE)
    running = _store_matchmaking(
        session,
        user_id=MINE,
        created_at=datetime.now(UTC) - timedelta(minutes=1),
        status="in_progress",
    )
    completed = _store_matchmaking(
        session, user_id=MINE, created_at=datetime.now(UTC), puuid=OTHER_PUUID
    )

    assert await service.cancel_analysis(PUUID, running) is True
    assert await service.delete_analysis(OTHER_PUUID, completed) is True

    session.expire_all()
    assert session.get(MatchmakingAnalysis, (OTHER_PUUID, completed)) is None


async def test_history_lists_only_the_callers_own_runs(session: Session) -> None:
    """One shared timeline was indistinguishable from your own."""
    now = datetime.now(UTC)
    mine = _store_matchmaking(
        session, user_id=MINE, created_at=now - timedelta(minutes=2)
    )
    _store_matchmaking(session, user_id=OTHER, created_at=now)

    history = await _matchmaking_service(session, MINE).get_analysis_history(PUUID)

    assert [item.created_at for item in history.items] == [_naive(mine)]


async def test_the_latest_completed_analysis_is_the_callers_own(
    session: Session,
) -> None:
    """The endpoint the results card reads on first paint."""
    now = datetime.now(UTC)
    mine = _store_matchmaking(
        session, user_id=MINE, created_at=now - timedelta(minutes=2)
    )
    _store_matchmaking(session, user_id=OTHER, created_at=now)

    latest = await _matchmaking_service(session, MINE).get_latest_completed_analysis(
        PUUID
    )

    assert latest is not None
    assert latest.created_at == _naive(mine)
