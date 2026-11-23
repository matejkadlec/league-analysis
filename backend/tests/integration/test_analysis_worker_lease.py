"""Whether a Matchmaking Analysis run can get a second worker, and what a
resumed worker finds of the first one's samples.

The lease is an advisory lock only PostgreSQL shows held from another
connection, and the samples are appended with a JSONB `||` it evaluates.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.features.auth.users.models import User
from app.features.matchmaking_analysis import service as analysis_service_module
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService
from app.features.matchmaking_analysis.worker_lease import (
    hold_run_lease,
    run_lease_is_held,
)
from app.features.players.models import Player

pytestmark = [pytest.mark.integration, pytest.mark.enable_socket]


@pytest.fixture(autouse=True)
def empty_run_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    """No worker of this process is registered unless a test says so."""
    monkeypatch.setattr(analysis_service_module, "_running_analyses", {})


async def _active_run(
    session: AsyncSession, user: User, player: Player
) -> MatchmakingAnalysis:
    run = MatchmakingAnalysis(
        user_id=user.id,
        puuid=player.puuid,
        created_at=datetime.now(UTC),
        status="in_progress",
        puuid_progress={"ally:EUW1_0": False, "enemy:EUW1_0": False},
        params={"match_count": 10, "end_date": None},
    )
    session.add(run)
    await session.flush()
    return run


async def test_a_held_lease_is_seen_elsewhere_and_refuses_a_second_holder(
    database_session: AsyncSession,
    second_connection_engine: AsyncEngine,
) -> None:
    """While one worker holds a run, no other can take it, and it is free again
    the moment that worker's connection closes."""
    created_at = datetime.now(UTC)

    async with hold_run_lease(
        second_connection_engine, 7, "lease-puuid", created_at
    ) as first:
        held_meanwhile = await run_lease_is_held(
            database_session, 7, "lease-puuid", created_at
        )
        other_run_held = await run_lease_is_held(
            database_session, 7, "other-puuid", created_at
        )
        async with hold_run_lease(
            second_connection_engine, 7, "lease-puuid", created_at
        ) as second:
            pass

    assert (first, second) == (True, False)
    assert (held_meanwhile, other_run_held) == (True, False)
    assert (
        await run_lease_is_held(database_session, 7, "lease-puuid", created_at) is False
    )


async def test_a_status_poll_does_not_start_a_second_worker_while_one_is_alive_elsewhere(
    database_session: AsyncSession,
    second_connection_engine: AsyncEngine,
    stored_user: User,
    stored_player: Player,
) -> None:
    """A worker this process does not know of still owns its run (LGA-129).

    The registry is empty, as in a process started while the old one's worker
    lived on; only once that worker is gone does the poll resume the run.
    """
    run = await _active_run(database_session, stored_user, stored_player)
    service = MatchmakingAnalysisService(database_session, None, stored_user.id)
    started = MagicMock()
    service._ensure_background_task = started

    async with hold_run_lease(
        second_connection_engine, stored_user.id, run.puuid, run.created_at
    ):
        await service.get_analysis_status(run.puuid, run.created_at)
    starts_while_held = started.call_count
    await service.get_analysis_status(run.puuid, run.created_at)

    assert starts_while_held == 0
    started.assert_called_once_with(run.puuid, run.created_at)


async def test_participant_samples_accumulate_one_write_at_a_time(
    database_session: AsyncSession,
    stored_user: User,
    stored_player: Player,
) -> None:
    """Each write appends one sample to what is stored, NULL included, and
    flips that participant's progress with it."""
    run = await _active_run(database_session, stored_user, stored_player)
    service = MatchmakingAnalysisService(database_session, None, stored_user.id)
    service._winrate_cache.update({"ally": 0.6, "enemy": None})
    service._rank_values["enemy"] = None
    service._rank_tiers["enemy"] = "UNRANKED"

    await service._record_participant_sample(run.puuid, run.created_at, "ally")
    await service._record_participant_sample(run.puuid, run.created_at, "enemy")

    stored = (
        await database_session.execute(
            select(
                MatchmakingAnalysis.participant_samples,
                MatchmakingAnalysis.puuid_progress,
            ).where(
                MatchmakingAnalysis.puuid == run.puuid,
                MatchmakingAnalysis.created_at == run.created_at,
            )
        )
    ).one()
    samples, progress = stored
    assert samples is not None
    assert set(samples) == {"ally", "enemy"}
    assert samples["ally"]["winrate"] == 0.6
    assert samples["enemy"]["rank_tier"] == "UNRANKED"
    assert progress == {"ally:EUW1_0": True, "enemy:EUW1_0": True}
