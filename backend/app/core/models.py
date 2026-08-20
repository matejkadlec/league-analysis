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
from sqlalchemy.orm import DeclarativeBase, MappedColumn, mapped_column

# Create a base class for declarative models using SQLAlchemy 2.0 style
# Use a custom naming convention for constraints and indexes
convention = {
    # `%(column_0_label)s` renders the schema too (`ix_auth_users_email`), which
    # no index in the database is named after. `%(table_name)s_%(column_0_name)s`
    # is the spelling the migrations actually created.
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    # Note the `%(constraint_name)s` token: an explicit `name=` on a
    # CheckConstraint is substituted *into* this template, so spell those bare
    # or they come out as `ck_<table>_ck_<table>_...`.
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata = MetaData(naming_convention=convention)

# Type annotation map for Python → SQL type mapping
type_annotation_map = {
    str: String(),
    int: Integer(),
    bool: Boolean(),
    float: Numeric(),
    Decimal: Numeric(),
    datetime: SQLDateTime(),
    str | None: String(),
    int | None: Integer(),
    bool | None: Boolean(),
    float | None: Numeric(),
    Decimal | None: Numeric(),
    datetime | None: SQLDateTime(),
}


def id_column(
    comment: str | None = "Auto-incrementing primary key",
) -> MappedColumn[int]:
    """A surrogate `BIGINT` primary key.

    Four tables spelled this out identically and a fifth -- `jobs.user_jobs`
    -- wrote the same column as a one-liner with no comment at all, which is
    the drift a shared declaration removes. That one passes `None` rather than
    silently gaining a comment, so the emitted DDL does not move.
    """
    return mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment=comment,
    )


def created_at_column(comment: str | None = None) -> MappedColumn[datetime]:
    """The row's creation stamp, written by the database.

    Twelve tables declared this identically and differed only in what their
    `comment` said, so the comment is the argument. Passing `None` is what
    SQLAlchemy already does when `comment` is omitted, which keeps the three
    tables that never had one byte-identical in the emitted DDL.
    """
    return mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment=comment,
    )


def updated_at_column(comment: str | None = None) -> MappedColumn[datetime]:
    """The row's last-modified stamp, advanced by the database on UPDATE.

    `onupdate` is the only thing separating this from `created_at_column`, and
    it is a SQLAlchemy-side default: it fires on ORM and Core updates, not on a
    hand-written `UPDATE` run against the database directly.
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

        `InstanceState.identity` reads the already-loaded identity key, so this
        never emits a lazy load the way a repr spelling out mapped attributes
        would. Unflushed rows have no identity yet and read as `transient`.
        """
        return f"<{type(self).__name__} {inspect(self).identity or 'transient'}>"
