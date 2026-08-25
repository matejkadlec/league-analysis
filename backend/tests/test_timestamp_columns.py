"""Pin the contract of the two shared timestamp column helpers.

The difference that matters is one keyword: `updated_at` carries `onupdate`,
`created_at` must not. Being a SQLAlchemy-side default it emits no DDL, so
swapping or dropping it leaves `alembic check` seeing no drift.
"""

from typing import Any

import pytest
from sqlalchemy import Column, DateTime

from app.core.models import Base, created_at_column, updated_at_column
from app.model_registry import import_all_models

import_all_models()

TIMESTAMP_COLUMNS: list[tuple[str, Column[Any]]] = [
    (table_name, column)
    for table_name in sorted(Base.metadata.tables)
    for column in Base.metadata.tables[table_name].columns
    if column.name in ("created_at", "updated_at")
]


def test_the_helpers_are_actually_in_use() -> None:
    """Guard the guard: an empty collection would pass every test below."""
    created = [c for _, c in TIMESTAMP_COLUMNS if c.name == "created_at"]
    updated = [c for _, c in TIMESTAMP_COLUMNS if c.name == "updated_at"]

    assert len(created) >= 13, len(created)
    assert len(updated) >= 12, len(updated)


@pytest.mark.parametrize(
    ("table_name", "column"),
    [(t, c) for t, c in TIMESTAMP_COLUMNS if c.name == "updated_at"],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_updated_at_advances_on_update(table_name: str, column: Column[Any]) -> None:
    assert column.onupdate is not None, f"{table_name}.updated_at lost onupdate"


@pytest.mark.parametrize(
    ("table_name", "column"),
    [(t, c) for t, c in TIMESTAMP_COLUMNS if c.name == "created_at"],
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_created_at_never_moves(table_name: str, column: Column[Any]) -> None:
    assert column.onupdate is None, f"{table_name}.created_at gained onupdate"


@pytest.mark.parametrize(
    ("table_name", "column"),
    TIMESTAMP_COLUMNS,
    ids=lambda value: value if isinstance(value, str) else "",
)
def test_every_stamp_is_defaulted_and_tz_aware(
    table_name: str, column: Column[Any]
) -> None:
    # A naive column would read back as local time from a container set to UTC
    # and compare wrongly against everything else, which is a bug that survives
    # every gate because it only shows up across a timezone boundary.
    assert column.server_default is not None, f"{table_name}.{column.name}"
    assert isinstance(column.type, DateTime), f"{table_name}.{column.name}"
    assert column.type.timezone is True, f"{table_name}.{column.name}"


def test_the_comment_is_the_only_thing_a_caller_chooses() -> None:
    # Passing no comment must be indistinguishable from the hand-written
    # `mapped_column` that never had one -- that equivalence is what kept the
    # emitted DDL byte-identical through the refactor that introduced these.
    assert created_at_column().column.comment is None
    assert created_at_column("why").column.comment == "why"
    assert updated_at_column().column.comment is None
    assert updated_at_column("why").column.comment == "why"
