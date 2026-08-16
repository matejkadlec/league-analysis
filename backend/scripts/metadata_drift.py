"""Compare the migrated schema against `Base.metadata` as stable signatures.

Alembic revisions are the schema authority, but nothing checked that the ORM
models still describe what the revisions actually build. A model edit with no
accompanying revision passes every gate: ruff, pyright and the test suite all
read the model, never the database.

`alembic check` is the built-in answer and it cannot be used strictly here yet
— the SQL-authored baseline revision and the models have already diverged in
roughly three hundred places (index names, column comments, nullability). So
this module reduces each divergence to a stable signature and compares the set
against a reviewed baseline file. A new signature fails the gate; a signature
that disappears also fails, so the baseline can only shrink. When it empties,
`alembic check` becomes usable as-is and this module can be deleted.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection, text

BASELINE_PATH = Path(__file__).resolve().parents[1] / "alembic" / "metadata-drift.txt"

# Tables created and owned by a runtime library rather than by a revision.
# These are not drift anyone can fix, so they are filtered out rather than
# recorded — a permanent baseline entry would never shrink and would blunt the
# "the baseline only shrinks" rule that makes the rest of the file a todo list.
RUNTIME_OWNED_TABLES = {
    ("jobs", "apscheduler_jobs"),  # APScheduler creates its own job store
    (None, "alembic_version"),  # Alembic's own revision pointer
}


def import_every_model_module() -> None:
    """Import all of `app` so no mapped table is missing from the metadata.

    `alembic/env.py` lists its model imports by hand. A feature whose models
    module is not on that list is absent from `Base.metadata` *and* absent from
    the database, which nets out to zero drift — the gate would pass while the
    table does not exist. Walking the package removes that blind spot, and a
    model whose table was never migrated then shows up as `add_table`.
    """
    import app

    for module in pkgutil.walk_packages(app.__path__, f"{app.__name__}."):
        importlib.import_module(module.name)


def include_object(
    target: Any, name: str | None, type_: str, _reflected: bool, _compare_to: Any
) -> bool:
    """Alembic hook keeping runtime-owned tables out of the comparison."""
    if type_ != "table" or name is None:
        return True
    return (getattr(target, "schema", None), name) not in RUNTIME_OWNED_TABLES


def _qualified(schema: str | None, table: str) -> str:
    return f"{schema}.{table}" if schema else table


def _signature_from_modification(modification: tuple[Any, ...]) -> str:
    """`(kind, schema, table, column, existing, old, new)` -> one signature.

    Only the identity of the changed column is kept. The old and new values are
    deliberately dropped: a comment's wording changing is the same unreconciled
    divergence as before, and embedding prose would churn the baseline.
    """
    kind, schema, table, column = modification[:4]
    # A modify_* carries the column name; add/remove_column carries the Column.
    name = getattr(column, "name", column)
    return f"{kind} {_qualified(schema, table)} {name}"


def _signature_from_object(kind: str, target: Any) -> str:
    """`(kind, SQLAlchemy object)` -> one signature built from names only.

    Never `repr()`: an index over an expression reprs as
    `<sqlalchemy.sql.elements.UnaryExpression object at 0x7f09caba9010>`, whose
    address differs on every run. Names are stable, and staying off reprs also
    keeps a SQLAlchemy upgrade from invalidating the whole baseline.
    """
    own_name = str(getattr(target, "name", "") or "")
    table = getattr(target, "table", None)
    schema = getattr(target, "schema", None) or getattr(table, "schema", None)

    # A Table carries no `.table`, so its own name is the qualified subject.
    if table is None:
        return f"{kind} {_qualified(schema, own_name)}"
    return f"{kind} {_qualified(schema, str(table.name))} {own_name}"


def _database_enum_labels(connection: Connection) -> dict[str, set[str]]:
    """Read every PostgreSQL enum type's labels, keyed by qualified name.

    The namespace join is load-bearing. An enum type name is unique only
    within its schema, so keying on `typname` alone merges the labels of two
    same-named enums in different schemas — and a merged set is a superset,
    which makes a genuinely missing value look present and the parity check
    pass. No such pair exists today; this keeps one from being silent.
    """
    rows = connection.execute(
        text(
            "SELECT n.nspname, t.typname, e.enumlabel FROM pg_type t "
            "JOIN pg_enum e ON e.enumtypid = t.oid "
            "JOIN pg_namespace n ON n.oid = t.typnamespace"
        )
    )
    labels: dict[str, set[str]] = {}
    for schema, type_name, label in rows:
        labels.setdefault(_qualified(schema, type_name), set()).add(label)
    return labels


def _declared_enums(metadata: Any) -> dict[str, set[str]]:
    """Map each mapped enum's qualified type name to its declared values."""
    declared: dict[str, set[str]] = {}
    for table in metadata.tables.values():
        for column in table.columns:
            enum_class = getattr(column.type, "enum_class", None)
            type_name = getattr(column.type, "name", None)
            if enum_class is None or type_name is None:
                continue
            # An enum with no schema of its own lives in its table's schema.
            schema = getattr(column.type, "schema", None) or table.schema
            declared.setdefault(_qualified(schema, type_name), set()).update(
                member.value for member in enum_class
            )
    return declared


def enum_parity_signatures(connection: Connection, metadata: Any) -> list[str]:
    """Report enum values present on only one side of the mapping.

    `compare_metadata` does not diff enum members at all, so an enum is exactly
    the schema change this module would otherwise wave through. Both directions
    matter and they fail differently: a value Python declares but the database
    lacks makes every insert of it raise `InvalidTextRepresentation`, while a
    value only the database has makes any existing row holding it unreadable
    the moment Python tries to coerce it.
    """
    in_database = _database_enum_labels(connection)
    declared = _declared_enums(metadata)
    signatures: list[str] = []
    for type_name, values in declared.items():
        stored = in_database.get(type_name, set())
        signatures += [f"missing_enum_value {type_name} {v}" for v in values - stored]
        signatures += [f"orphan_enum_value {type_name} {v}" for v in stored - values]
    return sorted(signatures)


def drift_signatures(connection: Connection, metadata: Any) -> list[str]:
    """Return the sorted, deduplicated divergence signatures for a database."""
    # Autogenerate narrates all ~300 known divergences at INFO. The signature
    # comparison below is the reportable result, so the narration is noise
    # that would bury a real failure in the gate's output.
    for noisy in ("alembic.autogenerate", "alembic.ddl", "alembic.runtime.plugins"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    context = MigrationContext.configure(
        connection,
        opts={
            "include_schemas": True,
            "compare_type": True,
            "version_table_schema": "public",
            "include_object": include_object,
        },
    )
    signatures: set[str] = set()
    for difference in compare_metadata(context, metadata):
        signatures.update(_signatures_for(difference))
    signatures.update(enum_parity_signatures(connection, metadata))

    # A signature that lost its subject would collapse every occurrence of that
    # operation into one line and silently match the baseline. Fail loudly
    # instead: an unhandled diff shape is a gap in this module, not a pass.
    unnamed = [signature for signature in signatures if len(signature.split()) < 2]
    if unnamed:
        raise RuntimeError(f"unrecognised autogenerate diff shape: {unnamed}")
    return sorted(signatures)


def _signatures_for(
    difference: tuple[Any, ...] | list[tuple[Any, ...]],
) -> list[str]:
    """Reduce one autogenerate diff to signatures, dispatching on its shape.

    Autogenerate emits three shapes and getting this wrong is silent: an
    `add_column` is a 4-tuple `(kind, schema, table, Column)`, and reading it
    as the 2-tuple `(kind, object)` yields a signature with no subject at all.
    """
    # A column alteration arrives as a list of per-attribute tuples.
    if isinstance(difference, list):
        return [
            _signature_from_modification(modification) for modification in difference
        ]
    # (kind, schema, table, Column) — a column added or dropped.
    if len(difference) == 4:
        return [_signature_from_modification(difference)]
    # (kind, object) and (kind, object, old_value) — a table-level object.
    return [_signature_from_object(difference[0], difference[1])]


def load_baseline() -> list[str]:
    """Read the reviewed divergence baseline, ignoring comments and blanks."""
    if not BASELINE_PATH.is_file():
        return []
    lines = BASELINE_PATH.read_text(encoding="utf-8").splitlines()
    return sorted(
        line.strip() for line in lines if line.strip() and not line.startswith("#")
    )


def compare_against_baseline(observed: Iterable[str]) -> tuple[list[str], list[str]]:
    """Return the (new, disappeared) signatures relative to the baseline."""
    observed_set = set(observed)
    baseline_set = set(load_baseline())
    return sorted(observed_set - baseline_set), sorted(baseline_set - observed_set)
