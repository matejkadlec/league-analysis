"""Native enum types, and the values the database writes when nobody supplies one.

A mock returns whatever its fixture says, so it cannot see a Python enum member
with no `ALTER TYPE` behind it, nor tell a value the DDL supplied from one
SQLAlchemy compiled into the statement on the way out.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import Enum, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Base
from app.features.auth.users.models import User
from app.features.auth.users.user_cookie_consent import UserCookieConsent
from app.features.players.models import Player
from app.features.settings.schemas import CookieConsentLevel, UserCookieConsentUpdate
from app.features.settings.service import SettingsService
from app.features.smurf_boost_detection.models import SmurfBoostAnalysis
from app.model_registry import import_all_models

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]

import_all_models()

ENUM_LABELS_SQL = text(
    "SELECT n.nspname, e.enumlabel FROM pg_enum e "
    "JOIN pg_type t ON t.oid = e.enumtypid "
    "JOIN pg_namespace n ON n.oid = t.typnamespace "
    "WHERE t.typname = :name"
)


def _mapped_enum_types() -> list[tuple[str, frozenset[str]]]:
    """Every native enum type a mapped column declares, with its declared labels."""
    found: dict[str, frozenset[str]] = {}
    for table in Base.metadata.tables.values():
        for column in table.columns:
            column_type = column.type
            if isinstance(column_type, Enum) and column_type.name is not None:
                found[column_type.name] = frozenset(column_type.enums)
    return sorted(found.items())


MAPPED_ENUM_TYPES = _mapped_enum_types()


@pytest.mark.parametrize(
    ("type_name", "declared"),
    MAPPED_ENUM_TYPES,
    ids=[name for name, _ in MAPPED_ENUM_TYPES],
)
async def test_every_mapped_enum_member_exists_in_its_postgres_type(
    database_session: AsyncSession,
    type_name: str,
    declared: frozenset[str],
) -> None:
    """A member added to a Python enum without an `ALTER TYPE` fails at write time.

    Autogenerate does not diff enum members, which is why this repository
    depends on `alembic-postgresql-enum`; this is the assertion that the
    dependency is doing its job.
    """
    rows = (await database_session.execute(ENUM_LABELS_SQL, {"name": type_name})).all()
    assert frozenset(label for _, label in rows) == declared
    assert len({schema for schema, _ in rows}) == 1


async def test_a_repeat_consent_replaces_the_level_and_moves_consented_at(
    database_session: AsyncSession, stored_user: User
) -> None:
    """`consented_at` records an explicit choice, so a repeat consent moves it.

    The column stores the enum's lower-case *value*, not its member name, and
    `values_callable` is the only thing making that true.
    """
    service = SettingsService(database_session)
    await service.upsert_user_cookie_consent(
        stored_user.id, UserCookieConsentUpdate(consent_level=CookieConsentLevel.ALL)
    )
    backdated = datetime(2020, 1, 1, tzinfo=UTC)
    await database_session.execute(
        update(UserCookieConsent)
        .where(UserCookieConsent.user_id == stored_user.id)
        .values(consented_at=backdated, updated_at=backdated)
    )
    await service.upsert_user_cookie_consent(
        stored_user.id,
        UserCookieConsentUpdate(consent_level=CookieConsentLevel.NECESSARY),
    )

    stored = await database_session.execute(
        select(
            text("consent_level::text"),
            UserCookieConsent.consented_at,
        ).select_from(UserCookieConsent)
    )
    now = (await database_session.execute(select(text("now()")))).scalar_one()
    assert stored.all() == [("necessary", now)]


async def test_an_orm_update_advances_updated_at_from_the_database_clock(
    database_session: AsyncSession, stored_player: Player
) -> None:
    """`onupdate` is the ORM-side hook a Core `ON CONFLICT` never fires.

    It has to fire here, on an ordinary flush, or nothing in the application
    advances the column at all.
    """
    backdated = datetime(2020, 1, 1, tzinfo=UTC)
    stored_player.created_at = backdated
    stored_player.updated_at = backdated
    await database_session.flush()

    stored_player.game_name = "Renamed"
    await database_session.flush()

    stored = await database_session.execute(
        select(Player.created_at, Player.updated_at).where(
            Player.puuid == stored_player.puuid
        )
    )
    now = (await database_session.execute(select(text("now()")))).scalar_one()
    assert stored.one() == (backdated, now)


async def test_a_smurf_boost_run_takes_its_lifecycle_defaults_from_the_database(
    database_session: AsyncSession, stored_player: Player, stored_user: User
) -> None:
    """A column's `default=` is compiled into a Core insert, so it hides the DDL.

    Only a statement that never mentions the column at all proves PostgreSQL
    carries the default, which is what a restore or a hand-written write gets.
    """
    await database_session.execute(
        text(
            "INSERT INTO core.smurf_boost_analyses "
            "(user_id, puuid, model_version, thresholds) "
            "VALUES (:user_id, :puuid, 'v1', '{\"kda\": 4.0}'::jsonb)"
        ),
        {"user_id": stored_user.id, "puuid": stored_player.puuid},
    )

    stored = await database_session.execute(
        select(
            SmurfBoostAnalysis.status,
            SmurfBoostAnalysis.eligible_games,
            SmurfBoostAnalysis.created_at,
        )
    )
    now = (await database_session.execute(select(text("now()")))).scalar_one()
    assert stored.one() == ("pending", 0, now)
