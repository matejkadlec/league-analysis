"""Who a refresh token names at logout, asserted by running the query.

A mocked `db.execute` makes the WHERE clause invisible, and that filter is the
whole behaviour here. So these run the real statement against SQLite in memory,
with `auth` attached as a schema so the model's table definition is unmodified.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.orm import Session

from app.features.auth.refresh_token import RefreshToken
from app.features.auth.service import AuthService


class _SyncSessionShim:
    """The async surface `AuthService` uses, over a synchronous session."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    async def commit(self) -> None:
        self._session.commit()


@pytest.fixture
def session() -> Iterator[Session]:
    engine: Engine = create_engine("sqlite://")

    def _attach_auth_schema(dbapi_connection: Any, _record: Any) -> None:
        # The model lives in the `auth` schema; SQLite reaches one by name
        # only if a database is attached under it.
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS auth")

    event.listen(engine, "connect", _attach_auth_schema)
    cast(Table, RefreshToken.__table__).create(engine)
    with Session(engine) as open_session:
        yield open_session
    engine.dispose()


def _service(session: Session) -> AuthService:
    return AuthService(cast(Any, _SyncSessionShim(session)))


def _store(
    session: Session,
    service: AuthService,
    raw: str,
    *,
    row_id: int = 1,
    user_id: int = 9,
    token_id: str,
    revoked: bool = False,
    replaced_by: str | None = None,
    expired: bool = False,
) -> None:
    now = datetime.now(UTC)
    session.add(
        RefreshToken(
            # SQLite does not autoincrement a BIGINT primary key.
            id=row_id,
            user_id=user_id,
            token_id=token_id,
            token_hash=service._hash_refresh_token(raw),
            issued_at=now - timedelta(days=1),
            expires_at=now - timedelta(days=1) if expired else now + timedelta(days=30),
            revoked_at=now if revoked else None,
            replaced_by_token_id=replaced_by,
        )
    )
    session.commit()


async def test_a_live_token_names_its_owner(session: Session) -> None:
    service = _service(session)
    _store(session, service, "live", token_id="t1")

    assert await service.resolve_user_id_for_refresh_token("live") == 9


async def test_an_expired_but_unrevoked_token_still_names_its_owner(
    session: Session,
) -> None:
    """The ordinary logout after an idle week, and the reason logout exists."""
    service = _service(session)
    _store(session, service, "old", token_id="t1", expired=True)

    assert await service.resolve_user_id_for_refresh_token("old") == 9


async def test_a_token_this_server_rotated_out_still_names_its_owner(
    session: Session,
) -> None:
    """The Sign Out that arrives one moment after a refresh.

    A logout clicked while a refresh is in flight carries the superseded token.
    Answering "no such user" there revokes nothing, and the replacement the
    server just issued stays live for its full 30 days with no browser holding it.
    """
    service = _service(session)
    _store(session, service, "rotated", token_id="t1", revoked=True, replaced_by="t2")
    _store(session, service, "replacement", row_id=2, token_id="t2")

    assert await service.resolve_user_id_for_refresh_token("rotated") == 9


async def test_a_token_whose_replacement_was_used_names_nobody(
    session: Session,
) -> None:
    """Only the just-superseded holder, not every ancestor of the live token.

    A stolen cookie from weeks ago is revoked-with-a-replacement too, and
    logout is the one route that takes it for 30 days: it would sign the owner
    out of every device on a credential `/refresh` already refuses.
    """
    service = _service(session)
    _store(session, service, "old", token_id="t1", revoked=True, replaced_by="t2")
    _store(
        session,
        service,
        "middle",
        row_id=2,
        token_id="t2",
        revoked=True,
        replaced_by="t3",
    )
    _store(session, service, "live", row_id=3, token_id="t3")

    assert await service.resolve_user_id_for_refresh_token("old") is None


async def test_a_token_whose_replacement_is_missing_names_nobody(
    session: Session,
) -> None:
    """Cleanup deletes expired rows, so a recorded replacement can be gone."""
    service = _service(session)
    _store(session, service, "orphan", token_id="t1", revoked=True, replaced_by="t2")

    assert await service.resolve_user_id_for_refresh_token("orphan") is None


async def test_a_token_revoked_without_a_replacement_names_nobody(
    session: Session,
) -> None:
    """The other direction, and the reason this is not simply "any token".

    A token revoked by a logout, or left at the tip of a chain reuse detection
    killed, has no replacement recorded. That session is over, and letting it
    name its owner would make a dead credential a way to end the current one.
    """
    service = _service(session)
    _store(session, service, "dead", token_id="t1", revoked=True)

    assert await service.resolve_user_id_for_refresh_token("dead") is None


async def test_an_unknown_token_names_nobody(session: Session) -> None:
    service = _service(session)
    _store(session, service, "live", token_id="t1")

    assert await service.resolve_user_id_for_refresh_token("someone-elses") is None


async def test_a_logout_revokes_this_users_live_tokens_and_only_theirs(
    session: Session,
) -> None:
    """The other half of the route, and it was mocked everywhere.

    Everywhere else `revoke_all_refresh_tokens_for_user` is an AsyncMock
    asserted to have been awaited, so matching on `id` instead of `user_id`,
    inverting the revoked filter, or never stamping `revoked_at` all stay green.
    """
    service = _service(session)
    _store(session, service, "live", row_id=1, token_id="t1")
    _store(
        session,
        service,
        "rotated",
        row_id=2,
        token_id="t2",
        revoked=True,
        replaced_by="t3",
    )
    _store(session, service, "someone-else", row_id=3, user_id=10, token_id="t4")

    await service.revoke_all_refresh_tokens_for_user(9)

    revoked = {
        row.token_id: row.revoked_at is not None
        for row in session.query(RefreshToken).all()
    }
    assert revoked == {"t1": True, "t2": True, "t4": False}


def _rotate_after_pass(
    session: Session,
    service: AuthService,
    target_pass: int,
) -> None:
    """Commit a replacement row once the given revoke pass has committed.

    A row inserted after a statement started is invisible to it however the
    statement is locked, which is the whole reason the revoke loops.
    """
    shim = cast(Any, service.db)
    original_commit = shim.commit
    passes = 0

    async def _commit() -> None:
        nonlocal passes
        await original_commit()
        passes += 1
        if passes == target_pass:
            _store(session, service, "rotated-in", row_id=99, token_id="t99")

    shim.commit = _commit


async def test_a_logout_revokes_a_token_a_racing_rotation_committed(
    session: Session,
) -> None:
    """The replacement did not exist when the first pass read the table."""
    service = _service(session)
    _store(session, service, "live", token_id="t1")
    _rotate_after_pass(session, service, target_pass=1)

    await service.revoke_all_refresh_tokens_for_user(9)

    assert all(row.revoked_at is not None for row in session.query(RefreshToken).all())


async def test_a_logout_that_revoked_nothing_still_looks_again(
    session: Session,
) -> None:
    """The first pass can be the statement the rotation made wait.

    It resumes with the presented token already revoked and the replacement
    below its snapshot, so it stamps nothing -- and stopping there is how the
    fresh token survives a logout.
    """
    service = _service(session)
    _store(session, service, "spent", token_id="t1", revoked=True)
    _rotate_after_pass(session, service, target_pass=1)

    await service.revoke_all_refresh_tokens_for_user(9)

    assert all(row.revoked_at is not None for row in session.query(RefreshToken).all())
