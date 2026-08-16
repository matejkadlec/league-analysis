"""SQLAlchemy base class and common type definitions."""

from datetime import datetime
from decimal import Decimal
from typing import Annotated

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import DeclarativeBase, mapped_column

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


class Base(DeclarativeBase):
    """Base class for all database models using SQLAlchemy 2.0."""

    __abstract__ = True

    metadata = metadata
    type_annotation_map = type_annotation_map


# Common Annotated types for basic field patterns
AutoIncrementPK = Annotated[int, mapped_column(Integer, primary_key=True)]
PrimaryKeyStr = Annotated[str, mapped_column(primary_key=True)]
PrimaryKeyInt = Annotated[int, mapped_column(primary_key=True)]

RequiredString = Annotated[str, mapped_column(nullable=False)]
OptionalString = Annotated[str | None, mapped_column()]

RequiredInt = Annotated[int, mapped_column(nullable=False)]
OptionalInt = Annotated[int | None, mapped_column()]

RequiredBool = Annotated[bool, mapped_column(nullable=False)]
OptionalBool = Annotated[bool | None, mapped_column()]

RequiredDecimal = Annotated[Decimal, mapped_column(nullable=False)]
OptionalDecimal = Annotated[Decimal | None, mapped_column()]

RequiredBigInt = Annotated[int, mapped_column(BigInteger, nullable=False)]
OptionalBigInt = Annotated[int | None, mapped_column(BigInteger)]

RequiredDateTime = Annotated[datetime, mapped_column(nullable=False)]
OptionalDateTime = Annotated[datetime | None, mapped_column()]

# Common field patterns with specific constraints
PUUIDField = Annotated[str, mapped_column(String(78), primary_key=True, index=True)]
PUUIDForeignKey = Annotated[
    str, mapped_column(String(78), ForeignKey("core.players.puuid", ondelete="CASCADE"))
]
MatchIDField = Annotated[str, mapped_column(String(64), primary_key=True, index=True)]
MatchIDForeignKey = Annotated[
    str,
    mapped_column(String(64), ForeignKey("core.matches.match_id", ondelete="CASCADE")),
]
