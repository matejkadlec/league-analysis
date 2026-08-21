"""Lifecycle primitives shared by one-active-run-per-player analyses.

Background analysis features persist runs with the same mechanics: an
active-status vocabulary, one active row per PUUID enforced by a partial
unique index, insert races resolved by rolling back and re-reading the
concurrent winner, and guarded updates that can never revive a finished
run. This module owns those mechanics once; each feature keeps its own
policy (status vocabulary, attach rules, expiry leases, interlocks).
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import and_, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from .db_session import rollback_quietly


def active_run_filter(
    model: type[Any],
    statuses: Sequence[str],
    puuid: str,
    created_at: datetime | None = None,
) -> ColumnElement[bool]:
    """WHERE clause naming a player's active runs, or one exact active run."""
    clauses: list[ColumnElement[bool]] = [
        model.puuid == puuid,
        model.status.in_(statuses),
    ]
    if created_at is not None:
        clauses.append(model.created_at == created_at)
    return and_(*clauses)


async def commit_new_run(db: AsyncSession, run: Any) -> IntegrityError | None:
    """Commit a new active run.

    On an integrity failure — normally losing the one-active-run race — the
    session is rolled back and the error returned so the caller can decide
    between attaching to the concurrent winner and re-raising it visibly.
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
    puuid: str,
    created_at: datetime,
    **values: Any,
) -> None:
    """UPDATE one exact active run and commit; never touches a finished run."""
    await db.execute(
        update(model)
        .where(active_run_filter(model, statuses, puuid, created_at))
        .values(**values)
    )
    await db.commit()
