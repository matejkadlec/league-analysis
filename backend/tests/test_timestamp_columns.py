"""Pin the contract of the two shared timestamp column helpers.

`updated_at` carries `onupdate` and `created_at` must not; being Python-side it
emits no DDL, so `alembic check` sees no drift if it is swapped or dropped.
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


def _case_id(value: object) -> str:
    """Name a case by its table and column, so no two cases share an id."""
    if isinstance(value, str):
        return value
    return value.name if isinstance(value, Column) else ""


def test_the_helpers_are_actually_in_use() -> None:
    """Guard the guard: an empty collection would pass every test below."""
    created = [c for _, c in TIMESTAMP_COLUMNS if c.name == "created_at"]
    updated = [c for _, c in TIMESTAMP_COLUMNS if c.name == "updated_at"]

    assert len(created) >= 13, len(created)
    assert len(updated) >= 12, len(updated)


@pytest.mark.parametrize(
    ("table_name", "column"),
    [(t, c) for t, c in TIMESTAMP_COLUMNS if c.name == "updated_at"],
    ids=_case_id,
)
def test_updated_at_advances_on_update(table_name: str, column: Column[Any]) -> None:
    assert column.onupdate is not None, f"{table_name}.updated_at lost onupdate"


@pytest.mark.parametrize(
    ("table_name", "column"),
    [(t, c) for t, c in TIMESTAMP_COLUMNS if c.name == "created_at"],
    ids=_case_id,
)
def test_created_at_never_moves(table_name: str, column: Column[Any]) -> None:
    assert column.onupdate is None, f"{table_name}.created_at gained onupdate"


@pytest.mark.parametrize(
    ("table_name", "column"),
    TIMESTAMP_COLUMNS,
    ids=_case_id,
)
def test_every_stamp_is_defaulted_and_tz_aware(
    table_name: str, column: Column[Any]
) -> None:
    # A naive column reads back as local time and compares wrongly against
    # everything else, visible only across a timezone boundary.
    assert column.server_default is not None, f"{table_name}.{column.name}"
    assert isinstance(column.type, DateTime), f"{table_name}.{column.name}"
    assert column.type.timezone is True, f"{table_name}.{column.name}"


def test_the_comment_is_the_only_thing_a_caller_chooses() -> None:
    # Passing no comment must be indistinguishable from a hand-written
    # `mapped_column` without one, so the emitted DDL stays byte-identical.
    assert created_at_column().column.comment is None
    assert created_at_column("why").column.comment == "why"
    assert updated_at_column().column.comment is None
    assert updated_at_column("why").column.comment == "why"
