"""Who a refresh token names at logout, asserted by running the query.

Every other test in this suite hands `db.execute` a canned result, which makes
the WHERE clause invisible: the filter can say anything and the mock answers
the row it was given either way. That is exactly the wrong shape here, because
this filter is the whole behaviour -- one predicate deciding whether a Sign Out
revokes the session or reports success having revoked nothing.

So these run the real statement against a real database. SQLite in memory,
with `auth` attached as a schema so the model's own table definition can be
used unmodified; the rows go in through the ORM and come back through
`AuthService.resolve_user_id_for_refresh_token` itself.
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
    token_id: str,
    revoked: bool = False,
    replaced_by: str | None = None,
    expired: bool = False,
) -> None:
    now = datetime.now(UTC)
    session.add(
        RefreshToken(
            # SQLite does not autoincrement a BIGINT primary key; the value is
            # never read, so any distinct number does.
            id=abs(hash(token_id)) % 1_000_000,
            user_id=9,
            token_id=token_id,
            token_hash=service._hash_refresh_token(raw),
            issued_at=now - timedelta(days=1),
            expires_at=now - timedelta(days=1) if expired else now + timedelta(days=30),
            revoked_at=now if revoked else None,
            replaced_by_token_id=replaced_by,
        )
    )
    session.commit()


@pytest.mark.asyncio
async def test_a_live_token_names_its_owner(session: Session) -> None:
    service = _service(session)
    _store(session, service, "live", token_id="t1")

    assert await service.resolve_user_id_for_refresh_token("live") == 9


@pytest.mark.asyncio
async def test_an_expired_but_unrevoked_token_still_names_its_owner(
    session: Session,
) -> None:
    """The ordinary logout after an idle week, and the reason logout exists."""
    service = _service(session)
    _store(session, service, "old", token_id="t1", expired=True)

    assert await service.resolve_user_id_for_refresh_token("old") == 9


@pytest.mark.asyncio
async def test_a_token_this_server_rotated_out_still_names_its_owner(
    session: Session,
) -> None:
    """The Sign Out that arrives one moment after a refresh.

    The browser composes a request from the jar as it stands, so a logout
    clicked while a refresh is in flight -- or after one whose response never
    arrived, or from a second tab -- carries the superseded token. Answering
    "no such user" there returns 200 "Successfully logged out" having revoked
    nothing, and the replacement the server had just issued stays live for its
    full 30 days with no browser left holding it to ever trip reuse detection.
    """
    service = _service(session)
    _store(session, service, "rotated", token_id="t1", revoked=True, replaced_by="t2")

    assert await service.resolve_user_id_for_refresh_token("rotated") == 9


@pytest.mark.asyncio
async def test_a_token_revoked_without_a_replacement_names_nobody(
    session: Session,
) -> None:
    """The other direction, and the reason this is not simply "any token".

    A token revoked by a logout or by reuse detection has no replacement
    recorded. That session is over, and letting it name its owner would make a
    dead credential a way to end whatever session the same person has since
    started.
    """
    service = _service(session)
    _store(session, service, "dead", token_id="t1", revoked=True)

    assert await service.resolve_user_id_for_refresh_token("dead") is None


@pytest.mark.asyncio
async def test_an_unknown_token_names_nobody(session: Session) -> None:
    service = _service(session)
    _store(session, service, "live", token_id="t1")

    assert await service.resolve_user_id_for_refresh_token("someone-elses") is None


@pytest.mark.asyncio
async def test_a_rotation_records_the_replacement_it_issued() -> None:
    """The other half of the pair above, and it is load-bearing now.

    A rotated-out token names its owner *because* it points at what replaced
    it. Dropping this one line from the rotation would leave every superseded
    token indistinguishable from one revoked by a logout -- so the Sign Out
    that arrives a moment after a refresh would go back to revoking nothing
    while answering "Successfully logged out". Deleting it passed all 614
    tests before this one existed.
    """
    from unittest.mock import AsyncMock, MagicMock

    from app.features.auth.service import AuthService as RealAuthService

    now = datetime.now(UTC)
    record = MagicMock()
    record.revoked_at = None
    record.expires_at = now + timedelta(days=30)
    record.user_id = 5
    record.replaced_by_token_id = None
    lookup = MagicMock()
    lookup.scalar_one_or_none = MagicMock(return_value=record)
    added: list[Any] = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=lookup)
    db.add = MagicMock(side_effect=added.append)
    db.commit = AsyncMock()
    user = MagicMock()
    user.id = 5
    user.email = "user@example.com"
    user.display_name = "User"
    user.is_admin = False
    user.is_active = True
    user.email_verified = True
    service = RealAuthService(db)
    service.get_user_by_id = AsyncMock(return_value=user)

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is not None
    assert len(added) == 1
    assert record.replaced_by_token_id == added[0].token_id
