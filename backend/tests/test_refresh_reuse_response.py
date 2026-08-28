"""What presenting an already-revoked refresh token gets you, and costs others.

Pins `_answer_reused_refresh_token` through `rotate_refresh_token`: an unused
replacement heals the innocent race into a fresh pair, a used one kills the
descendant chain, and one with no replacement refuses and touches nothing else.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

from app.features.auth.service import AuthService
from app.features.auth.token_service import TokenLifecycleMixin

NOW = datetime.now(UTC)


def _token(
    token_id: str,
    *,
    revoked_at: datetime | None,
    replaced_by: str | None,
    expires_at: datetime | None = None,
) -> MagicMock:
    record = MagicMock()
    record.token_id = token_id
    record.user_id = 5
    record.revoked_at = revoked_at
    record.replaced_by_token_id = replaced_by
    record.expires_at = expires_at or (NOW + timedelta(days=29))
    return record


def _lookup(record: MagicMock | None) -> MagicMock:
    lookup = MagicMock()
    lookup.scalar_one_or_none = MagicMock(return_value=record)
    return lookup


def _user() -> MagicMock:
    # Real values, not MagicMocks: healing mints an access token, which
    # JSON-encodes these into JWT claims.
    user = MagicMock()
    user.id = 5
    user.email = "user@example.com"
    user.display_name = "User"
    user.is_admin = False
    user.is_active = True
    user.email_verified = True
    return user


def _service(
    lookups: list[MagicMock],
) -> tuple[TokenLifecycleMixin, list[Any], MagicMock]:
    added: list[Any] = []
    db = MagicMock()
    # The owner lookup and the family lock precede every rotation query; the
    # lock's result is never read.
    db.scalar = AsyncMock(return_value=5)
    db.execute = AsyncMock(side_effect=[MagicMock(), *lookups])
    db.add = MagicMock(side_effect=added.append)
    db.commit = AsyncMock()
    service = AuthService(db)
    service.get_user_by_id = AsyncMock(return_value=_user())
    return service, added, db


async def test_an_unused_replacement_heals_the_race_into_a_fresh_pair() -> None:
    """The lost-response and duplicate-refresh cases answer success.

    The presented token was rotated, but its replacement was never used --
    the state a lost Set-Cookie or the loser of a two-tab race leaves behind,
    and exactly not the state an actively-ridden stolen chain leaves.
    """
    presented = _token("old", revoked_at=NOW - timedelta(minutes=5), replaced_by="succ")
    successor = _token("succ", revoked_at=None, replaced_by=None)
    service, added, db = _service([_lookup(presented), _lookup(successor)])

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is not None
    assert successor.revoked_at is not None
    assert successor.replaced_by_token_id == added[0].token_id
    assert cast(AsyncMock, db.commit).await_count == 1


async def test_a_used_replacement_kills_the_descendant_chain() -> None:
    """Theft response survives the softening.

    A replacement that was itself rotated means someone is actively using the
    chain -- the one state healing must not reward. The walk follows
    `replaced_by_token_id` to the live tip and revokes it.
    """
    presented = _token("a", revoked_at=NOW - timedelta(hours=2), replaced_by="b")
    middle = _token("b", revoked_at=NOW - timedelta(hours=1), replaced_by="c")
    tip = _token("c", revoked_at=None, replaced_by=None)
    service, added, _db = _service([_lookup(presented), _lookup(middle), _lookup(tip)])

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is None
    assert tip.revoked_at is not None
    assert added == []  # a refusal mints nothing


async def test_an_expired_presented_token_never_heals() -> None:
    """An expired credential is dead however it was revoked.

    Rotation restarts the 30-day clock, so a predecessor can expire while
    its unused replacement is still valid -- and until cleanup deletes the
    row, that expired credential is still presentable.
    """
    presented = _token(
        "old",
        revoked_at=NOW - timedelta(days=29),
        replaced_by="succ",
        expires_at=NOW - timedelta(days=1),
    )
    successor = _token("succ", revoked_at=None, replaced_by=None)
    service, added, _db = _service([_lookup(presented), _lookup(successor)])

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is None
    assert added == []


async def test_a_revoked_replacement_never_heals_a_logged_out_session() -> None:
    """Logout stays final; a pre-logout cookie must not resurrect.

    Logout revokes every row the user has, including a replacement that was
    never used -- otherwise exactly the state the heal rewards. The
    `successor.revoked_at is None` clause is the only line separating them.
    """
    presented = _token("old", revoked_at=NOW - timedelta(hours=1), replaced_by="succ")
    successor = _token("succ", revoked_at=NOW - timedelta(minutes=30), replaced_by=None)
    service, added, _db = _service([_lookup(presented), _lookup(successor)])

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is None
    assert added == []


async def test_a_token_with_no_replacement_refuses_without_wider_revocation() -> None:
    """One zombie cookie no longer signs the user out of every device.

    A token revoked with no replacement recorded -- a logout, or a chain
    already killed -- names no descendants, so the answer is to refuse and
    touch nothing else: the family lock, the lookup, and no walk after them.
    """
    presented = _token("dead", revoked_at=NOW - timedelta(days=2), replaced_by=None)
    service, added, db = _service([_lookup(presented)])

    rotated = await service.rotate_refresh_token(raw_refresh_token="x")

    assert rotated is None
    assert added == []
    assert cast(AsyncMock, db.execute).await_count == 2
