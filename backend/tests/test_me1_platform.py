"""ME1, Riot's Middle East platform, is discoverable and routes to `europe`.

Before LGA-114 the platform list predated ME1: `discover?platform=me1` was a
422 and a stored match with `platformId: ME1` failed `normalize_platform`.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import (
    Platform,
    Region,
    get_account_region_by_platform,
    get_region_by_platform,
)
from app.core.riot_api.endpoints import RiotAPIEndpoints
from app.features.players import service as player_service_module
from app.features.players.models import Player
from app.features.players.service import PlayerService

ME1_PUUID = "m" * 78


def test_me1_routes_every_regional_api_to_europe() -> None:
    assert get_region_by_platform("me1") is Region.EUROPE
    assert get_account_region_by_platform("ME1") is Region.EUROPE

    endpoints = RiotAPIEndpoints()
    match_list = endpoints.match_list_by_puuid(
        "sanitized-puuid", region=get_region_by_platform(Platform.ME1)
    )
    assert httpx.URL(match_list).host == "europe.api.riotgames.com"


@pytest.mark.parametrize("retired", ["ph2", "th2"])
def test_a_retired_platform_has_no_route(retired: str) -> None:
    """Riot removed both hosts when it merged them into SG2."""
    with pytest.raises(ValueError, match="Unsupported Riot platform"):
        get_region_by_platform(retired)


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


def _riot_transport(requested_hosts: list[str]) -> httpx.MockTransport:
    def _handler(request: httpx.Request) -> httpx.Response:
        requested_hosts.append(request.url.host)
        if request.url.path.startswith("/riot/account/v1/"):
            return httpx.Response(
                200,
                json={"puuid": ME1_PUUID, "gameName": "Sanitized", "tagLine": "ME1"},
            )
        if request.url.path.startswith("/lol/summoner/v4/"):
            return httpx.Response(
                200,
                json={
                    "puuid": ME1_PUUID,
                    "profileIconId": 7,
                    "summonerLevel": 42,
                    "revisionDate": 0,
                },
            )
        return httpx.Response(404, json={"status": {"status_code": 404}})

    return httpx.MockTransport(_handler)


async def test_discovering_an_me1_player_stores_it_on_me1(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        player_service_module,
        "ensure_riot_writer_maintenance_is_inactive",
        AsyncMock(),
    )
    requested_hosts: list[str] = []
    client = RiotAPIClient(api_key="RGAPI-test-only")
    client.session = httpx.AsyncClient(transport=_riot_transport(requested_hosts))
    session = _NewPlayerSession()

    response = await PlayerService(cast(AsyncSession, session)).discover_player(
        riot_client=client,
        game_name="Sanitized",
        tag_line="ME1",
        platform=Platform.ME1,
        user_id=1,
    )

    assert response.puuid == ME1_PUUID
    assert response.platform is Platform.ME1
    assert [player.platform for player in session.added] == ["me1"]
    # The account lookup goes to the `europe` cluster, the summoner read to
    # the platform's own host.
    assert requested_hosts == ["europe.api.riotgames.com", "me1.api.riotgames.com"]
