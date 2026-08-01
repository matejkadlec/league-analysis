"""Test job runners — lightweight API health-check loops that never write data.

Each test job calls all Riot API endpoints its corresponding real job uses,
once per minute, for up to 1 hour.  Results are discarded; only the
execution record (with execution_type=TEST) is persisted.
"""

import asyncio
from typing import List, Optional

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import TEST_PUUID, get_riot_api_key
from app.core.riot_api.client import APICallRecord, RiotAPIClient
from app.core.riot_api.constants import Platform, get_region_by_platform
from app.core.riot_api.errors import AuthenticationError
from app.features.jobs.base import BaseJob
from app.features.jobs.models import ExecutionType
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)

# Test loop constants
_MAX_ITERATIONS = 60  # 1 hour (60 × 1-minute intervals)
_WAIT_SECONDS = 60  # seconds between API call batches


def _is_api_key_error(error: Exception) -> bool:
    error_str = str(error).lower()
    return (
        isinstance(error, AuthenticationError)
        or "401" in error_str
        or "invalid api key" in error_str
        or "authentication" in error_str
    )


async def _interruptible_wait(job: BaseJob, db: AsyncSession, seconds: int) -> None:
    """Wait *seconds* but check control state every second so pause/stop respond fast."""
    for _ in range(seconds):
        await asyncio.sleep(1)
        await job.check_control_state(db)


async def _resolve_test_puuid(db: AsyncSession) -> tuple[str, str]:
    """Return (puuid, platform) for the test target.

    Uses the first globally-tracked player when available, otherwise
    falls back to the hard-coded TEST_PUUID on EUN1.
    """
    player_service = PlayerService(db)
    tracked = await player_service.get_globally_tracked_players()
    if tracked:
        return tracked[0].puuid, tracked[0].platform
    return TEST_PUUID, "eun1"


class TestMatchFetcherJob(BaseJob):
    """Test runner for Match Fetcher — calls 4 endpoints once per minute.

    Endpoints per iteration:
      1. match list by puuid
      2. match detail  (first match from list)
      3. match timeline (same match)
      4. league entries by puuid
    """

    def __init__(self, job_config_id: int):
        super().__init__(
            job_config_id,
            triggered_by="user",
            execution_type=ExecutionType.TEST,
        )

    def _track_api_request(self, metric_name: str, count: int) -> None:
        if metric_name == "requests_made":
            self.metrics["api_requests_made"] += count

    def _store_api_calls(self, api_calls: List[APICallRecord]) -> None:
        self._api_call_records = api_calls

    async def execute(self, db: AsyncSession) -> None:
        if not self.job_config:
            raise RuntimeError("Test Match Fetcher missing job configuration")

        puuid, platform = await _resolve_test_puuid(db)
        region = get_region_by_platform(platform)
        platform_enum = Platform(platform)

        api_key = await get_riot_api_key(db)

        async with RiotAPIClient(
            api_key=api_key,
            region=region,
            platform=platform_enum,
            request_callback=self._track_api_request,
        ) as riot_client:
            for iteration in range(_MAX_ITERATIONS):
                await self.check_control_state(db)

                try:
                    # 1. Match list
                    match_list = await riot_client.get_match_list_by_puuid(
                        puuid,
                        start=0,
                        count=1,
                        region=region,
                    )

                    match_id: Optional[str] = None
                    if match_list.match_ids:
                        match_id = match_list.match_ids[0]

                    # 2. Match detail (if we have a match)
                    if match_id:
                        await riot_client.get_match(match_id, region=region)

                    # 3. Match timeline
                    if match_id:
                        await riot_client.get_match_timeline(match_id, region=region)

                    # 4. League entries
                    await riot_client.get_league_entries_by_puuid(
                        puuid,
                        platform=platform_enum,
                    )

                    logger.info(
                        "Test Match Fetcher iteration completed",
                        iteration=iteration + 1,
                        puuid=puuid,
                        api_requests=self.metrics["api_requests_made"],
                    )

                except Exception as e:
                    is_key_err = _is_api_key_error(e)
                    self.record_error(str(e), is_api_key_error=is_key_err)
                    logger.error(
                        "Test Match Fetcher API call failed",
                        iteration=iteration + 1,
                        error=str(e),
                    )
                    break  # stop on first failure

                # Wait 60s before next iteration (skip wait on last iteration)
                if iteration < _MAX_ITERATIONS - 1:
                    await _interruptible_wait(self, db, _WAIT_SECONDS)

            self._store_api_calls(riot_client.get_api_calls())

        # Test runs never create/update data records
        self.metrics["records_created"] = 0
        self.metrics["records_updated"] = 0


class TestPlayerUpdaterJob(BaseJob):
    """Test runner for Player Updater — calls 2 endpoints once per minute.

    Endpoints per iteration:
      1. summoner by puuid
      2. account by puuid
    """

    def __init__(self, job_config_id: int):
        super().__init__(
            job_config_id,
            triggered_by="user",
            execution_type=ExecutionType.TEST,
        )

    def _track_api_request(self, metric_name: str, count: int) -> None:
        if metric_name == "requests_made":
            self.metrics["api_requests_made"] += count

    def _store_api_calls(self, api_calls: List[APICallRecord]) -> None:
        self._api_call_records = api_calls

    async def execute(self, db: AsyncSession) -> None:
        if not self.job_config:
            raise RuntimeError("Test Player Updater missing job configuration")

        puuid, platform = await _resolve_test_puuid(db)
        platform_enum = Platform(platform)
        region = get_region_by_platform(platform)

        api_key = await get_riot_api_key(db)

        async with RiotAPIClient(
            api_key=api_key,
            region=region,
            platform=platform_enum,
            request_callback=self._track_api_request,
        ) as riot_client:
            for iteration in range(_MAX_ITERATIONS):
                await self.check_control_state(db)

                try:
                    # 1. Summoner by puuid
                    await riot_client.get_summoner_by_puuid(
                        puuid,
                        platform=platform_enum,
                    )

                    # 2. Account by puuid
                    await riot_client.get_account_by_puuid(puuid, region=region)

                    logger.info(
                        "Test Player Updater iteration completed",
                        iteration=iteration + 1,
                        puuid=puuid,
                        api_requests=self.metrics["api_requests_made"],
                    )

                except Exception as e:
                    is_key_err = _is_api_key_error(e)
                    self.record_error(str(e), is_api_key_error=is_key_err)
                    logger.error(
                        "Test Player Updater API call failed",
                        iteration=iteration + 1,
                        error=str(e),
                    )
                    break  # stop on first failure

                # Wait 60s before next iteration (skip wait on last iteration)
                if iteration < _MAX_ITERATIONS - 1:
                    await _interruptible_wait(self, db, _WAIT_SECONDS)

            self._store_api_calls(riot_client.get_api_calls())

        # Test runs never create/update data records
        self.metrics["records_created"] = 0
        self.metrics["records_updated"] = 0
