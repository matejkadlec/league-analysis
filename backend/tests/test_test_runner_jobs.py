"""Pin which endpoints each test-runner job actually calls.

The endpoint list *is* the feature: drop a call and the run still reports
success while covering less than it claims.
"""

from typing import Any

from app.core.riot_api.constants import Platform, Region
from app.features.jobs.implementations.test_runner import (
    RunnerTarget,
    _TestRunnerJob,
)
from app.features.jobs.implementations.test_runner import (
    TestMatchFetcherJob as MatchFetcherRunner,
)
from app.features.jobs.implementations.test_runner import (
    TestPlayerUpdaterJob as PlayerUpdaterRunner,
)

# Renamed on import: pytest tries to collect any imported class named `Test*`
# and refuses these because they take constructor arguments.


class FakeMatchList:
    def __init__(self, match_ids: list[str]) -> None:
        self.match_ids = match_ids


class RecordingClient:
    """Records the endpoint calls made against it, in order."""

    def __init__(self, match_ids: list[str] | None = None) -> None:
        self.calls: list[str] = []
        self._match_ids = match_ids if match_ids is not None else ["EUN1_1"]

    async def get_match_list_by_puuid(self, puuid: str, **kwargs: Any) -> FakeMatchList:
        self.calls.append("match_list")
        return FakeMatchList(self._match_ids)

    async def get_match(self, match_id: str, **kwargs: Any) -> None:
        self.calls.append("match")

    async def get_match_timeline(self, match_id: str, **kwargs: Any) -> None:
        self.calls.append("timeline")

    async def get_league_entries_by_puuid(self, puuid: str, **kwargs: Any) -> None:
        self.calls.append("league_entries")

    async def get_summoner_by_puuid(self, puuid: str, **kwargs: Any) -> None:
        self.calls.append("summoner")

    async def get_account_by_puuid(self, puuid: str, **kwargs: Any) -> None:
        self.calls.append("account")


async def run(job: _TestRunnerJob, client: RecordingClient) -> list[str]:
    await job.call_endpoints(
        client,  # type: ignore[arg-type]
        RunnerTarget(puuid="p-1", region=Region.EUROPE, platform=Platform.EUN1),
    )
    return client.calls


async def test_match_fetcher_covers_all_four_of_its_endpoints() -> None:
    client = RecordingClient()

    assert await run(MatchFetcherRunner(1), client) == [
        "match_list",
        "match",
        "timeline",
        "league_entries",
    ]


async def test_match_fetcher_skips_match_calls_when_there_is_no_match() -> None:
    # With no match history the puuid-scoped calls must still run; without that
    # guard the run dies on the first iteration and reports a key failure.
    client = RecordingClient(match_ids=[])

    assert await run(MatchFetcherRunner(1), client) == [
        "match_list",
        "league_entries",
    ]


async def test_player_updater_covers_both_of_its_endpoints() -> None:
    client = RecordingClient()

    assert await run(PlayerUpdaterRunner(1), client) == ["summoner", "account"]


def test_both_runners_share_the_loop_and_keep_their_own_label() -> None:
    # The label is what distinguishes the two jobs' log lines; sharing a base
    # class must not collapse them onto one name.
    assert MatchFetcherRunner.label == "Test Match Fetcher"
    assert PlayerUpdaterRunner.label == "Test Player Updater"
    assert MatchFetcherRunner.execute is PlayerUpdaterRunner.execute


def test_a_test_run_is_marked_as_one_and_attributed_to_the_user() -> None:
    job = MatchFetcherRunner(7)

    assert job.execution_type.value == "TEST"
    assert job.triggered_by == "user"
    assert job.suspend_regular is False
