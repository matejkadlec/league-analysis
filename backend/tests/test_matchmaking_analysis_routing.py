"""Where a matchmaking analysis sends its Riot calls (LGA-115).

A rank asked of the wrong platform is not an error: Riot answers `200 []`, so
an analysis that left routing to the client's defaults reported every
non-EUNE lobby as UNRANKED. These assert on the URLs the real client builds.
"""

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.features.matchmaking_analysis.service import MatchmakingAnalysisService

_USER_ID = 7
_PUUID = "analysed-player"


def _service(stored_platform: str) -> tuple[MatchmakingAnalysisService, list[str]]:
    """A service over a real client whose defaults point at the wrong route.

    Korea and `asia` are nobody's answer below, so a call that omits its
    routing shows up as a `kr.` or `asia.` URL instead of passing by luck.
    """
    client = RiotAPIClient(
        api_key="RGAPI-test-only", region=Region.ASIA, platform=Platform.KR
    )
    urls: list[str] = []

    async def answer_with_nothing(url: str) -> list[object]:
        urls.append(url)
        return []

    client._make_request = AsyncMock(side_effect=answer_with_nothing)
    row = SimpleNamespace(scalar_one=lambda: stored_platform)
    service = MatchmakingAnalysisService(
        cast(AsyncSession, SimpleNamespace(execute=AsyncMock(return_value=row))),
        client,
        _USER_ID,
    )
    service._find_rank_snapshot = AsyncMock(return_value=None)
    return service, urls


@pytest.mark.parametrize(
    ("stored_platform", "platform_host", "region_host"),
    [
        (
            "euw1",
            "https://euw1.api.riotgames.com/",
            "https://europe.api.riotgames.com/",
        ),
        (
            "na1",
            "https://na1.api.riotgames.com/",
            "https://americas.api.riotgames.com/",
        ),
        ("oc1", "https://oc1.api.riotgames.com/", "https://sea.api.riotgames.com/"),
    ],
)
async def test_every_riot_call_follows_the_analysed_players_platform(
    stored_platform: str, platform_host: str, region_host: str
) -> None:
    service, urls = _service(stored_platform)
    await service._load_run_routing(_PUUID)

    await service._api_fetch_match_ids(_PUUID)
    await service._api_fetch_match("SPINE_1")
    await service._cached_player_rank(
        "participant", await service._get_match_platform("SPINE_1")
    )

    match_list, match_detail, league = urls
    assert match_list.startswith(f"{region_host}lol/match/v5/matches/by-puuid/")
    assert match_detail.startswith(f"{region_host}lol/match/v5/matches/SPINE_1")
    assert league.startswith(f"{platform_host}lol/league/v4/entries/by-puuid/")


async def test_a_rank_is_asked_of_the_match_platform_not_the_players() -> None:
    """A player who moved server is still ranked, with nine others, where the
    spine match was played."""
    service, urls = _service("eun1")
    await service._load_run_routing(_PUUID)

    await service._cached_player_rank("participant", Platform.EUW1)

    assert urls[0].startswith("https://euw1.api.riotgames.com/lol/league/v4/")


async def test_a_match_call_made_before_routing_is_loaded_fails_loudly() -> None:
    """The alternative is the client's default route and an answer about
    somebody else's server."""
    service, urls = _service("euw1")

    with pytest.raises(RuntimeError, match="routing was not loaded"):
        await service._api_fetch_match_ids(_PUUID)

    assert urls == []
