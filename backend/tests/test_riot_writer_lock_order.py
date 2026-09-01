"""The writer interlock and the cleanup command must take their locks in one order.

Two independently maintained lists name overlapping tables; taking them in
different orders deadlocks a running writer against cleanup instead of queueing.
"""

from __future__ import annotations

import re
from typing import cast

from sqlalchemy import Connection as SAConnection
from sqlalchemy.sql import Executable

from app.features.jobs.maintenance import RIOT_WRITER_TABLES
from scripts.cleanse_local_riot_data import lock_cleanup_tables

QUALIFIED_TABLE = re.compile(r'"([^"]+)"\."([^"]+)"')


def _cleanup_lock_order() -> list[str]:
    """The tables `lock_cleanup_tables` locks, in the order its statement names them."""

    class Connection:
        def __init__(self) -> None:
            self.query = ""

        def execute(
            self, statement: Executable, *_args: object, **_kwargs: object
        ) -> None:
            self.query = str(statement)

    connection = Connection()
    lock_cleanup_tables(cast(SAConnection, connection))
    return [
        f"{schema}.{table}"
        for schema, table in QUALIFIED_TABLE.findall(connection.query)
    ]


def test_the_cleanup_lock_statement_is_still_readable() -> None:
    """The guard on the guard: a statement this test cannot parse checks nothing.

    An empty or truncated read makes every list below a subsequence of nothing,
    which passes.
    """
    locked = _cleanup_lock_order()

    assert len(locked) >= len(RIOT_WRITER_TABLES), (
        f"only {len(locked)} qualified tables parsed out of the cleanup LOCK "
        f"statement, fewer than the {len(RIOT_WRITER_TABLES)} the writers take. "
        f"Either the statement no longer quotes schema and table, or cleanup "
        f"stopped locking tables the writers still lock."
    )


def test_writer_locks_are_an_ordered_subsequence_of_the_cleanup_locks() -> None:
    """Same relative order in both files, or the two can deadlock each other."""
    # `in` on an iterator consumes it, so a table can only be found after the one
    # before it: that is what makes this a subsequence check and not a set check.
    remaining = iter(_cleanup_lock_order())
    out_of_order = [table for table in RIOT_WRITER_TABLES if table not in remaining]

    assert not out_of_order, (
        "RIOT_WRITER_TABLES is not an ordered subsequence of the tables "
        "`scripts/cleanse_local_riot_data.py::lock_cleanup_tables` locks; "
        f"{out_of_order} came too late or is missing there. Postgres grants "
        "locks in request order, so a differing order is a deadlock, not a wait."
    )
