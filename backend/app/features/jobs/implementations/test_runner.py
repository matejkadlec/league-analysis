"""Test job runners — lightweight API health-check loops that never write data.

Each test job calls the Riot endpoints its real counterpart uses; results are
discarded and only the execution record (execution_type=TEST) is persisted.
"""

import asyncio
from dataclasses import dataclass
from typing import override

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_chains import is_riot_api_key_error
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region, get_region_by_platform
from app.features.jobs.base import BaseJob
from app.features.jobs.models import ExecutionType
from app.features.players.service import PlayerService

logger = structlog.get_logger(__name__)

TEST_PUUID = (
    "PNm-92VrUvdu-cj0KFhqs0_8dNV2g9DsQ2pObEKsJZum-3uISPmVr2xn2eI1ztzq10TJb9M-ZpdbdQ"
)

_MAX_ITERATIONS = 60  # 1 hour (60 x 1-minute intervals)
_WAIT_SECONDS = 60


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


@dataclass(frozen=True)
class RunnerTarget:
    """The one player every endpoint in a test iteration is asked about.

    Not named `TestTarget`: pytest collects any class named `Test*` and only
    warns, quietly costing coverage in any test module that imports this one.
    """

    puuid: str
    region: Region
    platform: Platform


class _TestRunnerJob(BaseJob):
    """The loop both test runners share: call endpoints, log, wait, repeat.

    A test run exercises exactly the endpoints its real counterpart uses and
    keeps none of the answers. Subclasses supply a label and `call_endpoints`.
    """

    # Human name used in this job's log lines, e.g. "Test Match Fetcher".
    label: str

    # Set by the test-trigger endpoint to record whether it paused the regular
    # schedule for the duration of this run.
    suspend_regular: bool = False

    def __init__(self, job_config_id: int):
        super().__init__(
            job_config_id,
            triggered_by="user",
            execution_type=ExecutionType.TEST,
        )

    async def call_endpoints(
        self, riot_client: RiotAPIClient, target: RunnerTarget
    ) -> None:
        """Call one iteration's worth of endpoints. Results are discarded."""
        raise NotImplementedError

    @override
    async def execute(self, db: AsyncSession) -> None:
        if not self.job_config:
            raise RuntimeError(f"{self.label} missing job configuration")

        puuid, platform = await _resolve_test_puuid(db)
        platform_enum = Platform(platform)
        region = get_region_by_platform(platform)
        target = RunnerTarget(puuid=puuid, region=region, platform=platform_enum)

        async with self.job_riot_client(
            db,
            region=region,
            platform=platform_enum,
        ) as riot_client:
            for iteration in range(_MAX_ITERATIONS):
                await self.check_control_state(db)

                try:
                    await self.call_endpoints(riot_client, target)
                    logger.info(
                        f"{self.label} iteration completed",
                        iteration=iteration + 1,
                        puuid=puuid,
                        api_requests=self.metrics["api_requests_made"],
                    )

                except Exception as e:
                    is_key_err = is_riot_api_key_error(e)
                    self.record_error(e, is_api_key_error=is_key_err)
                    logger.error(
                        f"{self.label} API call failed",
                        iteration=iteration + 1,
                        error=str(e),
                    )
                    break

                if iteration < _MAX_ITERATIONS - 1:
                    await _interruptible_wait(self, db, _WAIT_SECONDS)

        self.metrics["records_created"] = 0
        self.metrics["records_updated"] = 0


class TestMatchFetcherJob(_TestRunnerJob):
    """Test runner for Match Fetcher — calls 4 endpoints once per minute."""

    label = "Test Match Fetcher"

    @override
    async def call_endpoints(
        self, riot_client: RiotAPIClient, target: RunnerTarget
    ) -> None:
        match_list = await riot_client.get_match_list_by_puuid(
            target.puuid,
            start=0,
            count=1,
            region=target.region,
        )

        match_id: str | None = None
        if match_list.match_ids:
            match_id = match_list.match_ids[0]

        if match_id:
            await riot_client.get_match(match_id, region=target.region)

        if match_id:
            await riot_client.get_match_timeline(match_id, region=target.region)

        await riot_client.get_league_entries_by_puuid(
            target.puuid, platform=target.platform
        )


class TestPlayerUpdaterJob(_TestRunnerJob):
    """Test runner for Player Updater — calls 2 endpoints once per minute."""

    label = "Test Player Updater"

    @override
    async def call_endpoints(
        self, riot_client: RiotAPIClient, target: RunnerTarget
    ) -> None:
        await riot_client.get_summoner_by_puuid(target.puuid, platform=target.platform)

        await riot_client.get_account_by_puuid(target.puuid, region=target.region)
