"""SQLAlchemy base class and common type definitions."""

from datetime import datetime
from decimal import Decimal
from typing import override

from sqlalchemy import (
    BigInteger,
    Boolean,
    Integer,
    MetaData,
    Numeric,
    String,
    func,
    inspect,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, MappedColumn, mapped_column

# Without this, SQLAlchemy writes `None` as `'null'::jsonb`, which reads back as
# `None` but is not the SQL NULL that `IS NULL` finds.
ABSENT_AS_NULL_JSONB = JSONB(none_as_null=True)

convention = {
    # `%(column_0_label)s` would render the schema too (`ix_auth_users_email`),
    # which is not the spelling the migrations created.
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    # An explicit `name=` is substituted *into* this template, so it must be
    # spelled bare. Gate: forbid-ck-prefixed-constraint-name.
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=convention)

type_annotation_map = {
    str: String(),
    int: Integer(),
    bool: Boolean(),
    float: Numeric(),
    Decimal: Numeric(),
    datetime: SQLDateTime(),
}


def id_column(
    comment: str | None = "Auto-incrementing primary key",
) -> MappedColumn[int]:
    """A surrogate `BIGINT` primary key.

    Pass `None` for a table that never carried a column comment, so the
    emitted DDL does not move.
    """
    return mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment=comment,
    )


def created_at_column(comment: str | None = None) -> MappedColumn[datetime]:
    """The row's creation stamp, written by the database.

    Passing `None` is what SQLAlchemy already does when `comment` is omitted,
    which keeps a table that never had one byte-identical in the emitted DDL.
    """
    return mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment=comment,
    )


def updated_at_column(comment: str | None = None) -> MappedColumn[datetime]:
    """The row's last-modified stamp, advanced by the database on UPDATE.

    `onupdate` is SQLAlchemy-side: it fires on ORM and Core updates, never on an
    `UPDATE` run against the database directly.
    """
    return mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment=comment,
    )


class Base(DeclarativeBase):
    """Base class for all database models using SQLAlchemy 2.0."""

    __abstract__ = True

    metadata = metadata
    type_annotation_map = type_annotation_map

    @override
    def __repr__(self) -> str:
        """Identify the row by class and primary key, without touching a column.

        `InstanceState.identity` never emits a lazy load; unflushed rows have no
        identity yet and read as `transient`.
        """
        return f"<{type(self).__name__} {inspect(self).identity or 'transient'}>"
