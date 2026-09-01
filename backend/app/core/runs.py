"""Lifecycle primitives shared by one-active-run-per-player analyses.

One active row per account and PUUID, insert races resolved by re-reading the
concurrent winner, and guarded updates that can never revive a finished run.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import and_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from .db_session import rollback_quietly


def values_in_sql(column: str, values: Sequence[str]) -> str:
    """The ``<column> IN (...)`` text a Python vocabulary renders to in SQL.

    Every run table spells its status vocabulary twice in DDL (CHECK constraint
    and partial unique index), so rendering both from Python keeps them in step.
    """
    joined = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({joined})"


def ints_in_sql(column: str, values: Sequence[int]) -> str:
    """The integer form of `values_in_sql`."""
    joined = ", ".join(str(value) for value in values)
    return f"{column} IN ({joined})"


def nullable_values_in_sql(column: str, values: Sequence[str]) -> str:
    """Allow SQL NULL or one of the closed string members."""
    return f"{column} IS NULL OR {values_in_sql(column, values)}"


def active_run_filter(
    model: type[Any],
    statuses: Sequence[str],
    user_id: int,
    puuid: str,
    created_at: datetime | None = None,
) -> ColumnElement[bool]:
    """WHERE clause naming one account's active runs for a player.

    `user_id` is required because matching on `puuid` alone still returns a row,
    one owned by the Riot player rather than the account that asked for it.
    """
    clauses: list[ColumnElement[bool]] = [
        model.user_id == user_id,
        model.puuid == puuid,
        model.status.in_(statuses),
    ]
    if created_at is not None:
        clauses.append(model.created_at == created_at)
    return and_(*clauses)


async def commit_new_run(db: AsyncSession, run: Any) -> IntegrityError | None:
    """Commit a new active run.

    On an integrity failure — losing the one-active-run race — the session rolls back and
    the error returns so the caller can attach to the winner or re-raise it.
    """
    db.add(run)
    try:
        await db.commit()
    except IntegrityError as error:
        await rollback_quietly(db)
        return error
    return None


async def guarded_run_update(
    db: AsyncSession,
    model: type[Any],
    statuses: Sequence[str],
    user_id: int,
    puuid: str,
    created_at: datetime,
    **values: Any,
) -> None:
    """UPDATE one exact active run and commit; never touches a finished run."""
    await db.execute(
        update(model)
        .where(active_run_filter(model, statuses, user_id, puuid, created_at))
        .values(**values)
    )
    await db.commit()
