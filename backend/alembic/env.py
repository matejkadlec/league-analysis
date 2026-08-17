"""Alembic environment for League Analysis PostgreSQL migrations."""

from __future__ import annotations

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context
from app.core.config import get_settings
from app.core.models import Base
from app.features.auth import (
    email_change_request,  # noqa: F401
    join_us_contact_submission,  # noqa: F401
    refresh_token,  # noqa: F401
    revoked_access_token,  # noqa: F401
    subject_counts,  # noqa: F401
    user_cookie_consent,  # noqa: F401
    user_settings,  # noqa: F401
    user_tracked_player,  # noqa: F401
)

# Import every mapped model before Alembic reads Base.metadata. The initial
# baseline is SQL-backed because it also contains PostgreSQL-only objects that
# SQLAlchemy cannot express, while this metadata supports future revisions.
from app.features.auth import models as auth_models  # noqa: F401
from app.features.jobs import models as job_models  # noqa: F401
from app.features.matches import models as match_models  # noqa: F401
from app.features.matches import (
    participants,  # noqa: F401
    timeline,  # noqa: F401
)
from app.features.matchmaking_analysis import models as matchmaking_models  # noqa: F401
from app.features.players import leagues  # noqa: F401
from app.features.players import models as player_models  # noqa: F401
from app.features.playstyle_analysis import models as playstyle_models  # noqa: F401
from app.features.settings import models as settings_models  # noqa: F401
from app.features.smurf_boost_detection import (
    models as smurf_boost_models,  # noqa: F401
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def migration_database_url() -> str:
    """Build Alembic's synchronous URL without logging credential values."""
    return get_settings().database_url.replace(
        "postgresql+asyncpg://", "postgresql+psycopg2://", 1
    )


def configure_context(connection: object) -> None:
    """Configure schema-aware comparison and migration operations."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        compare_type=True,
        version_table_schema="public",
    )


def run_migrations_offline() -> None:
    """Run migrations in SQL-generation mode."""
    context.configure(
        url=migration_database_url(),
        target_metadata=target_metadata,
        include_schemas=True,
        compare_type=True,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="public",
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations with either a supplied locked connection or a new one."""
    supplied_connection = config.attributes.get("connection")
    if supplied_connection is not None:
        configure_context(supplied_connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = migration_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        configure_context(connection)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
