"""Every nullable JSONB column must spell "no document" as SQL NULL.

`JSON.none_as_null` emits no DDL, so a column declared without it stores
`'null'::jsonb` for a written `None` and `IS NULL` stops matching the row.
"""

from typing import Any

import pytest
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB

from app.core.models import Base
from app.model_registry import import_all_models

import_all_models()

NULLABLE_JSONB_COLUMNS: list[tuple[str, Column[Any], JSONB]] = [
    (table_name, column, column_type)
    for table_name in sorted(Base.metadata.tables)
    for column in Base.metadata.tables[table_name].columns
    if isinstance(column_type := column.type, JSONB) and column.nullable
]


def _case_id(value: object) -> str:
    """Name a case by its table and column, so no two cases share an id."""
    if isinstance(value, str):
        return value
    return value.name if isinstance(value, Column) else ""


def test_the_columns_under_test_are_all_still_there() -> None:
    """Guard the guard: an empty collection would pass the test below."""
    assert len(NULLABLE_JSONB_COLUMNS) >= 9, NULLABLE_JSONB_COLUMNS


@pytest.mark.parametrize(
    ("table_name", "column", "column_type"),
    NULLABLE_JSONB_COLUMNS,
    ids=_case_id,
)
def test_a_written_none_becomes_sql_null(
    table_name: str, column: Column[Any], column_type: JSONB
) -> None:
    assert column_type.none_as_null is True, f"{table_name}.{column.name}"
