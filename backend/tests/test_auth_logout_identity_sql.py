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
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from app.features.auth.service import AuthService
from app.features.auth.tokens.refresh_token import RefreshToken
from app.features.auth.tokens.token_service import TokenLifecycleMixin
from app.features.auth.users.models import User


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

    def _as_utc(target: RefreshToken, _context: Any) -> None:
        # `TIMESTAMPTZ` hands back an aware value and SQLite cannot; without
        # this the service's own expiry comparison raises here and nowhere else.
        for field in ("issued_at", "expires_at", "revoked_at"):
            stored = getattr(target, field)
            if stored is not None and stored.tzinfo is None:
                setattr(target, field, stored.replace(tzinfo=UTC))

    event.listen(engine, "connect", _attach_auth_schema)
    event.listen(RefreshToken, "load", _as_utc)
    cast(Table, RefreshToken.__table__).create(engine)
    # `revoke_all_refresh_tokens_for_user` locks the owner before it stamps.
    cast(Table, User.__table__).create(engine)
    with Session(engine) as open_session:
        yield open_session
    event.remove(RefreshToken, "load", _as_utc)
    engine.dispose()


def _service(session: Session) -> TokenLifecycleMixin:
    return AuthService(cast(Any, _SyncSessionShim(session)))


def _store(
    session: Session,
    service: TokenLifecycleMixin,
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


async def test_an_expired_token_names_nobody(session: Session) -> None:
    """An expired cookie carries no session, so it has none to end.

    Honouring one lets a copy kept past its 30 days sign the owner out of
    every device, on a credential `/refresh` refuses outright. The route still
    answers 200 and still clears the browser's cookies.
    """
    service = _service(session)
    _store(session, service, "old", token_id="t1", expired=True)

    assert await service.resolve_user_id_for_refresh_token("old") is None


async def test_an_expired_token_with_an_unused_replacement_names_nobody(
    session: Session,
) -> None:
    """The gap the reuse-heal rule closed on `/refresh` and this route kept.

    `_reuse_is_healable` requires the presented token to be live on its own
    terms; reading identity by anything weaker left the superseded-holder case
    open for as long as the replacement went unused.
    """
    service = _service(session)
    _store(
        session,
        service,
        "old",
        token_id="t1",
        revoked=True,
        replaced_by="t2",
        expired=True,
    )
    _store(session, service, "replacement", row_id=2, token_id="t2")

    assert await service.resolve_user_id_for_refresh_token("old") is None


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


def _executed_statements(service: TokenLifecycleMixin) -> list[Any]:
    """Record every statement the service runs, in order."""
    shim = cast(Any, service.db)
    original_execute = shim.execute
    recorded: list[Any] = []

    async def _execute(statement: Any) -> Any:
        recorded.append(statement)
        return await original_execute(statement)

    shim.execute = _execute
    return recorded


async def test_a_logout_locks_the_owner_before_it_stamps(session: Session) -> None:
    """SQLite drops `FOR UPDATE`, so the lock is read off the compiled SQL.

    Without it a rotation commits a replacement between this statement's
    snapshot and its write, and no amount of re-reading sees that row: it is
    below the snapshot however long the statement waited on a lock.
    """
    service = _service(session)
    _store(session, service, "live", token_id="t1")
    recorded = _executed_statements(service)

    await service.revoke_all_refresh_tokens_for_user(9)

    compiled = [
        str(statement.compile(dialect=postgresql.dialect())) for statement in recorded
    ]
    assert len(compiled) == 2
    assert "FROM auth.users" in compiled[0]
    assert compiled[0].rstrip().endswith("FOR UPDATE")
    assert compiled[1].startswith("UPDATE auth.refresh_tokens")
