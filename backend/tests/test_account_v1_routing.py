"""ACCOUNT-V1 routing: no account request may go to the `sea` cluster (LGA-116).

MATCH-V5 serves `americas`, `asia`, `europe` and `sea`; ACCOUNT-V1 serves only
the first three. Riot answers an account request on `sea` with 403, and every
403 is credential-health evidence that the key was rejected, so one OCE, SG,
TW or VN lookup used to flip the whole application to "key invalid".
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock
from urllib.parse import urlsplit

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    ACCOUNT_REGIONS,
    Platform,
    Region,
    get_account_region_by_platform,
    get_region_by_platform,
)
from app.core.riot_api.credential_vocabulary import RiotCredentialStatus
from app.core.riot_api.endpoints import RiotAPIEndpoints
from app.features.players import service as player_service_module
from app.features.players.models import Player
from app.features.players.service import PlayerService

ACCOUNT_HOSTS = {
    f"{region.value}.api.riotgames.com"
    for region in (Region.AMERICAS, Region.ASIA, Region.EUROPE)
}
SEA_HOST = "sea.api.riotgames.com"
# Riot PUUIDs are 78 characters; the response schema enforces it.
OCE_PUUID = "o" * 78


def _host(url: str) -> str:
    return urlsplit(url).netloc


def test_every_platform_builds_account_urls_on_an_account_cluster() -> None:
    """Walks every `Platform`, so a new SEA-routed platform cannot regress."""
    endpoints = RiotAPIEndpoints()

    for platform in Platform:
        assert get_account_region_by_platform(platform) in ACCOUNT_REGIONS
        # Callers that hold the MATCH-V5 region (the Test Runner job passes
        # it straight through) must still land on an account cluster.
        match_region = get_region_by_platform(platform)
        account_urls = (
            endpoints.account_by_puuid("sanitized-puuid", match_region),
            endpoints.account_by_riot_id("Sanitized", "TEST", match_region),
        )
        for url in account_urls:
            assert _host(url) in ACCOUNT_HOSTS, (platform, url)

    sea_default = RiotAPIEndpoints(region=Region.SEA)
    assert _host(sea_default.account_by_puuid("sanitized-puuid")) in ACCOUNT_HOSTS


def test_match_v5_keeps_the_sea_cluster_for_sea_platforms() -> None:
    endpoints = RiotAPIEndpoints()
    sea_platforms = [
        platform
        for platform in Platform
        if get_region_by_platform(platform) is Region.SEA
    ]

    assert Platform.OC1 in sea_platforms
    for platform in sea_platforms:
        url = endpoints.match_list_by_puuid(
            "sanitized-puuid", region=get_region_by_platform(platform)
        )
        assert _host(url) == SEA_HOST


def _riot_like_transport(requested_hosts: list[str]) -> httpx.MockTransport:
    """Answer as Riot does: 403 for an account request on `sea`, else data."""

    def _handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        requested_hosts.append(host)
        path = request.url.path
        if path.startswith("/riot/account/v1/"):
            if host == SEA_HOST:
                return httpx.Response(
                    403,
                    json={"status": {"message": "Forbidden", "status_code": 403}},
                )
            return httpx.Response(
                200,
                json={"puuid": OCE_PUUID, "gameName": "Sanitized", "tagLine": "OCE"},
            )
        if path.startswith("/lol/summoner/v4/"):
            return httpx.Response(
                200,
                json={
                    "puuid": OCE_PUUID,
                    "profileIconId": 7,
                    "summonerLevel": 42,
                    "revisionDate": 0,
                },
            )
        return httpx.Response(404, json={"status": {"status_code": 404}})

    return httpx.MockTransport(_handler)


class _NewPlayerSession:
    """Session for a discovery that finds no stored row and no tracking."""

    def __init__(self) -> None:
        self.added: list[Player] = []

    async def get(self, *_args: object, **_kwargs: object) -> None:
        return None

    def add(self, instance: Player) -> None:
        self.added.append(instance)

    async def commit(self) -> None:
        return None

    async def refresh(self, instance: Player) -> None:
        instance.created_at = datetime.now(UTC)
        instance.updated_at = datetime.now(UTC)

    async def execute(self, *_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(scalar_one_or_none=lambda: None)


@pytest.mark.parametrize("platform", [Platform.OC1, Platform.SG2])
async def test_discovering_a_sea_player_succeeds_and_keeps_the_key_valid(
    platform: Platform, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    credential_evidence = AsyncMock()
    requested_hosts: list[str] = []
    client = RiotAPIClient(
        api_key="RGAPI-test-only",
        credential_health_callback=credential_evidence,
    )
    client.session = httpx.AsyncClient(transport=_riot_like_transport(requested_hosts))
    session = _NewPlayerSession()

    response = await PlayerService(cast(AsyncSession, session)).discover_player(
        riot_client=client,
        game_name="Sanitized",
        tag_line="OCE",
        platform=platform,
        user_id=1,
    )

    assert response.puuid == OCE_PUUID
    assert [player.platform for player in session.added] == [platform.value]
    assert SEA_HOST not in requested_hosts
    statuses = [call.args[0] for call in credential_evidence.await_args_list]
    assert statuses
    assert set(statuses) == {RiotCredentialStatus.VALID}
    # The job log names the cluster that was actually called.
    account_calls = [
        call
        for call in client.get_api_calls()
        if call.endpoint.startswith("/riot/account/")
    ]
    assert [call.region for call in account_calls] == ["ASIA"]
