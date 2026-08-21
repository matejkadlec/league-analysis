"""Regression coverage for the atomic cookie-consent write."""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

from sqlalchemy import ClauseElement
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.settings.schemas import (
    CookieConsentLevel,
    UserCookieConsentUpdate,
)
from app.features.settings.service import SettingsService


class _Result:
    def __init__(self, value: object):
        self.value = value

    def scalar_one(self) -> object:
        return self.value


class _Session:
    def __init__(self, result_value: object):
        self.result_value = result_value
        self.statements: list[ClauseElement] = []
        self.committed = False

    async def execute(self, statement: ClauseElement) -> _Result:
        self.statements.append(statement)
        return _Result(self.result_value)

    async def commit(self) -> None:
        self.committed = True


async def test_repeat_consent_upserts_instead_of_racing_the_primary_key() -> None:
    """A second consent updates the row rather than inserting a duplicate.

    Selecting first and branching on the result let two concurrent requests
    both miss the row and both insert, so the loser raised a 500 from
    ``user_cookie_consents_pkey``.
    """
    session = _Session(
        SimpleNamespace(
            consent_level=CookieConsentLevel.ALL,
            consent_version="v1",
            consent_source="banner",
            consented_at=datetime(2026, 8, 16, tzinfo=UTC),
        )
    )
    service = SettingsService(cast(AsyncSession, session))

    await service.upsert_user_cookie_consent(
        42,
        UserCookieConsentUpdate(
            consent_level=CookieConsentLevel.ALL,
            consent_version="v1",
            consent_source="banner",
        ),
    )

    assert len(session.statements) == 1, "a read before the write reopens the race"
    compiled = str(session.statements[0].compile(dialect=postgresql.dialect()))
    assert "INSERT INTO auth.user_cookie_consents" in compiled
    assert "ON CONFLICT (user_id) DO UPDATE" in compiled
    assert session.committed


async def test_repeat_consent_moves_both_timestamps() -> None:
    """The conflict branch sets `updated_at` itself.

    `updated_at` carries an ORM-level `onupdate`, which a Core ON CONFLICT
    never fires, so an upsert that leaves it to the model silently freezes the
    column at the value the first insert wrote.
    """
    session = _Session(
        SimpleNamespace(
            consent_level=CookieConsentLevel.NECESSARY,
            consent_version="v1",
            consent_source="banner",
        )
    )
    service = SettingsService(cast(AsyncSession, session))

    await service.upsert_user_cookie_consent(
        42,
        UserCookieConsentUpdate(consent_level=CookieConsentLevel.NECESSARY),
    )

    compiled = str(session.statements[0].compile(dialect=postgresql.dialect()))
    conflict_clause = compiled.split("ON CONFLICT")[1]
    assert "consented_at = now()" in conflict_clause
    assert "updated_at = now()" in conflict_clause
