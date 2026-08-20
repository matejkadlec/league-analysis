"""Alembic environment for League Analysis PostgreSQL migrations."""

from __future__ import annotations

from logging.config import fileConfig

# Imported for its side effect: it registers an enum comparator on Alembic's
# `schema` dispatch hook. Without it, `alembic check` is blind to enum members
# — the one schema change autogenerate does not look at.
#
# Its `drop_unused_enums` option is left at its default of True, so a PostgreSQL
# enum type bound to no mapped column is reported as drift. That is the stricter
# reading and matches how the rest of this file treats the models as the schema's
# description. The cost to know about: such a type makes `alembic revision
# --autogenerate` emit a destructive `DROP TYPE`, so an enum used only from
# PL/pgSQL or a domain would need `set_configuration(Config(
# drop_unused_enums=False))` here rather than a hand-edit of the revision.
import alembic_postgresql_enum  # noqa: F401
from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import get_global_settings
from app.core.models import Base
from app.model_registry import import_all_models

# Every mapped model must be imported before Alembic reads `Base.metadata`, or
# its table is invisible here and the migration silently omits it. The baseline
# revision is SQL-backed because it also holds PostgreSQL-only objects that
# SQLAlchemy cannot express; this metadata carries everything after it.
import_all_models()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Tables created and owned by a runtime library rather than by a revision. They
# are in the database and will never be in `Base.metadata`, so autogenerate and
# `alembic check` would propose dropping them on every run.
#
# `alembic_version` needs the entry despite Alembic having its own exclusion for
# it: that one only fires when the table's schema equals `version_table_schema`,
# and `include_schemas=True` reports the default schema as None, so the
# comparison is `None == "public"` and never matches.
RUNTIME_OWNED_TABLES = {
    ("jobs", "apscheduler_jobs"),  # APScheduler creates its own job store
    (None, "alembic_version"),  # Alembic's own revision pointer
}


def include_object(
    target: object,
    name: str | None,
    type_: str,
    _reflected: bool,
    _compare_to: object,
) -> bool:
    """Keep runtime-owned tables out of the comparison.

    Filtering the table is enough; indexes and columns are only ever offered
    here for a table that already passed, so they need no case of their own.
    """
    if type_ == "table":
        return (getattr(target, "schema", None), name) not in RUNTIME_OWNED_TABLES
    return True


def migration_database_url() -> str:
    """Build Alembic's synchronous URL without logging credential values."""
    return get_global_settings().database_url.replace(
        "postgresql+asyncpg://", "postgresql+psycopg2://", 1
    )


def configure_context(connection: object) -> None:
    """Configure schema-aware comparison and migration operations."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        compare_type=True,
        include_object=include_object,
        version_table_schema="public",
    )


def run_migrations_offline() -> None:
    """Run migrations in SQL-generation mode."""
    context.configure(
        url=migration_database_url(),
        target_metadata=target_metadata,
        include_schemas=True,
        compare_type=True,
        include_object=include_object,
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
