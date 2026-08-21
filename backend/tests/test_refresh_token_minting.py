"""The row a refresh token is written as, on both paths that write one.

Issuing and rotating each mint a `refresh_tokens` row. Two rules govern them
and neither had a test: the 255-character truncation of `user_agent`, and the
fact that a rotation must revoke the old row and insert its replacement in a
single commit. A rotation split across two commits leaves a window in which
the caller's token is revoked and no replacement exists -- the visitor is
signed out and cannot refresh.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.auth.service import AuthService

LONG_USER_AGENT = "u" * 400


def _rotating_service() -> tuple[AuthService, list[Any], MagicMock, MagicMock]:
    """A service whose db answers the rotation lookup with a live token row."""
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

    # Real values, not MagicMocks: rotation ends by minting an access token,
    # which JSON-encodes these into the JWT claims.
    user = MagicMock()
    user.id = 5
    user.email = "user@example.com"
    user.display_name = "User"
    user.is_admin = False
    user.is_active = True
    user.email_verified = True

    service = AuthService(db)
    service.get_user_by_id = AsyncMock(return_value=user)
    return service, added, db, record


def _issuing_service() -> tuple[AuthService, list[Any], MagicMock]:
    added: list[Any] = []
    db = MagicMock()
    db.add = MagicMock(side_effect=added.append)
    db.commit = AsyncMock()
    return AuthService(db), added, db


@pytest.mark.asyncio
async def test_issued_token_truncates_a_long_user_agent() -> None:
    service, added, _ = _issuing_service()

    await service.create_refresh_token(user_id=5, user_agent=LONG_USER_AGENT)

    assert len(added[0].user_agent) == 255


@pytest.mark.asyncio
async def test_rotated_token_truncates_a_long_user_agent() -> None:
    """The column is `String(255)`; an untruncated agent is a write error."""
    service, added, _, _ = _rotating_service()

    await service.rotate_refresh_token(
        raw_refresh_token="x", user_agent=LONG_USER_AGENT
    )

    assert len(added[0].user_agent) == 255


@pytest.mark.parametrize("user_agent", [None, ""])
@pytest.mark.asyncio
async def test_absent_user_agent_stays_null_on_both_paths(
    user_agent: str | None,
) -> None:
    """Empty string is falsy, so it is stored as NULL rather than as ''."""
    issuing, issued, _ = _issuing_service()
    await issuing.create_refresh_token(user_id=5, user_agent=user_agent)

    rotating, rotated, _, _ = _rotating_service()
    await rotating.rotate_refresh_token(raw_refresh_token="x", user_agent=user_agent)

    assert issued[0].user_agent is None
    assert rotated[0].user_agent is None


@pytest.mark.asyncio
async def test_rotation_revokes_and_replaces_in_one_commit() -> None:
    """Two commits would expose a window with the old row dead and no new one."""
    service, added, db, record = _rotating_service()

    await service.rotate_refresh_token(raw_refresh_token="x")

    assert db.commit.await_count == 1
    assert record.revoked_at is not None
    assert len(added) == 1
    # The replaced-by link is written in that same commit, not a later one --
    # and it is what lets a rotated-out token still name its owner. Without
    # it a superseded token is indistinguishable from one a logout revoked,
    # so the Sign Out arriving just after a refresh revokes nothing while
    # answering "Successfully logged out".
    assert record.replaced_by_token_id == added[0].token_id


@pytest.mark.asyncio
async def test_issuing_honours_an_explicit_lifetime() -> None:
    service, added, _ = _issuing_service()
    before = datetime.now(UTC)

    _, expires_at, _ = await service.create_refresh_token(
        user_id=5, expires_delta=timedelta(minutes=3)
    )

    assert expires_at - before < timedelta(minutes=4)
    assert added[0].expires_at == expires_at


@pytest.mark.asyncio
async def test_rotation_uses_the_configured_lifetime() -> None:
    """Rotation takes no `expires_delta`: a rotated token restarts the clock."""
    service, added, _, _ = _rotating_service()
    configured = service.settings.jwt_refresh_token_expire_days

    result = await service.rotate_refresh_token(raw_refresh_token="x")

    assert result is not None
    refresh_expires_at = result[4]
    assert added[0].expires_at == refresh_expires_at
    remaining = refresh_expires_at - datetime.now(UTC)
    assert timedelta(days=configured) - remaining < timedelta(minutes=1)


@pytest.mark.asyncio
async def test_both_paths_write_the_same_columns() -> None:
    """Whatever mints a refresh token fills the same row shape."""
    issuing, issued, _ = _issuing_service()
    await issuing.create_refresh_token(user_id=5, remote_ip="10.0.0.1", user_agent="ua")

    rotating, rotated, _, _ = _rotating_service()
    await rotating.rotate_refresh_token(
        raw_refresh_token="x", remote_ip="10.0.0.1", user_agent="ua"
    )

    def shape(record: Any) -> dict[str, Any]:
        return {
            "user_id": record.user_id,
            "created_from_ip": record.created_from_ip,
            "user_agent": record.user_agent,
            "token_id_set": bool(record.token_id),
            "token_hash_set": bool(record.token_hash),
            "issued_at_set": record.issued_at is not None,
        }

    assert shape(issued[0]) == shape(rotated[0])


@pytest.mark.asyncio
async def test_the_raw_token_is_returned_only_to_the_caller() -> None:
    """What is stored is the hash; the raw secret is never on the row."""
    service, added, _ = _issuing_service()

    raw, _, token_id = await service.create_refresh_token(user_id=5)

    assert added[0].token_hash != raw
    assert added[0].token_id == token_id
    assert raw not in (added[0].token_hash, added[0].token_id)
