"""Three table-level rules that hold across `Base.metadata`, not within one model.

Each is invisible to `alembic check`: a redundant index, a foreign key narrower
than its target and an unconstrained `platform` all emit perfectly valid DDL.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import CheckConstraint, Column, ForeignKey, Table

from app.core.models import Base
from app.core.riot_api.constants import Platform
from app.core.runs import values_in_sql
from app.model_registry import import_all_models

import_all_models()

TABLES: list[Table] = [
    Base.metadata.tables[name] for name in sorted(Base.metadata.tables)
]

# A unique `index=True` is a constraint, not a lookup aid, so a composite that
# leads with the column does not make it redundant.
INDEXED_COLUMNS: list[tuple[str, Column[Any]]] = [
    (table.fullname, column)
    for table in TABLES
    for column in table.columns
    if column.index and not column.unique
]

FOREIGN_KEYS: list[tuple[str, ForeignKey]] = [
    (f"{table.fullname}.{foreign_key.parent.name}", foreign_key)
    for table in TABLES
    for foreign_key in sorted(table.foreign_keys, key=lambda fk: fk.parent.name)
]

PLATFORM_TABLES: list[Table] = [
    table for table in TABLES if "platform" in table.columns
]


def _case_id(value: object) -> str:
    """Name a case by the declaration it walks, so no two cases share an id."""
    if isinstance(value, str):
        return value
    if isinstance(value, Table):
        return value.fullname
    return value.name if isinstance(value, Column) else ""


def test_the_metadata_walk_found_all_three_kinds_of_declaration() -> None:
    """Guard the guards: an empty collection would pass every test below."""
    assert len(INDEXED_COLUMNS) >= 20, INDEXED_COLUMNS
    assert len(FOREIGN_KEYS) >= 20, FOREIGN_KEYS
    assert len(PLATFORM_TABLES) >= 2, PLATFORM_TABLES


@pytest.mark.parametrize(("table_name", "column"), INDEXED_COLUMNS, ids=_case_id)
def test_no_indexed_column_is_already_led_by_a_composite(
    table_name: str, column: Column[Any]
) -> None:
    """A btree on (a, b) already serves every lookup on (a) alone.

    The second index is dead weight the planner never picks, paid for on every
    write; a partial or unique composite covers nothing, so neither counts.
    """
    covering = sorted(
        index.name or ""
        for index in column.table.indexes
        if len(index.columns) > 1
        and not index.unique
        and index.dialect_options["postgresql"]["where"] is None
        and next(iter(index.columns)) is column
    )

    assert covering == [], (
        f"{table_name}.{column.name} carries index=True, but {covering} "
        f"already lead(s) with it"
    )


@pytest.mark.parametrize(("label", "foreign_key"), FOREIGN_KEYS, ids=_case_id)
def test_every_foreign_key_is_as_wide_as_the_column_it_points_at(
    label: str, foreign_key: ForeignKey
) -> None:
    """A narrower child truncates or rejects keys the parent happily stores.

    Widening one side alone passes `alembic check` and fails later, on the first
    value that only fits the parent.
    """
    referenced = foreign_key.column
    child, parent = foreign_key.parent.type, referenced.type
    target = f"{referenced.table.fullname}.{referenced.name}"

    assert type(child) is type(parent), f"{label} is {child!r}, {target} is {parent!r}"
    assert getattr(child, "length", None) == getattr(parent, "length", None), (
        f"{label} is {child!r}, {target} is {parent!r}"
    )


@pytest.mark.parametrize("table", PLATFORM_TABLES, ids=_case_id)
def test_every_platform_column_is_bounded_by_both_check_constraints(
    table: Table,
) -> None:
    """Platform is compared by equality across tables, never case-folded.

    Both halves are needed: lowercase alone admits a region that does not exist,
    the value list alone admits `EUW1`.
    """
    predicates = {
        constraint.name: str(constraint.sqltext)
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint) and isinstance(constraint.name, str)
    }
    lowercase = f"ck_{table.name}_platform_is_lowercase"
    supported = f"ck_{table.name}_platform_supported"

    assert sorted({lowercase, supported} - set(predicates)) == [], (
        f"{table.fullname}.platform is unconstrained; {table.fullname} declares "
        f"{sorted(predicates)}"
    )
    assert predicates[lowercase] == "platform = lower(platform)", (
        f"{lowercase} reads {predicates[lowercase]!r}, which does not case-fold"
    )
    assert predicates[supported] == values_in_sql(
        "platform", [platform.value for platform in Platform]
    ), f"{supported} reads {predicates[supported]!r}, not the Platform vocabulary"
