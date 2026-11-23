"""Riot IDs outside ASCII reach Riot, through real FastAPI routing (LGA-118).

The route's patterns accepted ASCII only, so one stored player in ten could
not be looked up although Riot types `gameName` and `tagLine` as plain
strings. The validation lives in `Query(...)`, so these go through the router.
"""

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock
from urllib.parse import quote

import httpx
import pytest
from fastapi import FastAPI

from app.core.dependencies import get_riot_client
from app.core.http_rate_limit import limiter
from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.core.riot_api.endpoints import RiotAPIEndpoints
from app.features.auth.dependencies import get_current_active_user
from app.features.auth.users.models import User
from app.features.players.dependencies import get_player_service
from app.features.players.router import router
from app.features.players.schemas import PlayerResponse
from app.features.players.service import PlayerService


@pytest.fixture
def service() -> AsyncMock:
    stub = AsyncMock(spec=PlayerService)

    async def _discovered(**kwargs: object) -> PlayerResponse:
        moment = datetime(2026, 11, 1, tzinfo=UTC)
        return PlayerResponse(
            puuid="p" * 78,
            game_name=str(kwargs["game_name"]),
            tag_line=str(kwargs["tag_line"]),
            platform=Platform.EUN1,
            summoner_level=30,
            profile_icon_id=1,
            created_at=moment,
            updated_at=moment,
        )

    stub.discover_player.side_effect = _discovered
    return stub


@pytest.fixture
async def client(service: AsyncMock) -> AsyncIterator[httpx.AsyncClient]:
    app = FastAPI()
    app.state.limiter = limiter
    app.include_router(router)

    async def _service() -> PlayerService:
        return cast(PlayerService, service)

    async def _user() -> User:
        return User(id=1)

    async def _riot_client() -> RiotAPIClient:
        return cast(RiotAPIClient, AsyncMock(spec=RiotAPIClient))

    app.dependency_overrides[get_player_service] = _service
    app.dependency_overrides[get_current_active_user] = _user
    app.dependency_overrides[get_riot_client] = _riot_client
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver"
    ) as test_client:
        yield test_client


async def _discover(
    client: httpx.AsyncClient, game_name: str, tag_line: str
) -> httpx.Response:
    return await client.post(
        "/players/discover",
        params={"game_name": game_name, "tag_line": tag_line, "platform": "eun1"},
    )


@pytest.mark.parametrize(
    ("game_name", "tag_line"),
    [
        ("Ondřej Škoda", "Čech"),
        ("Пётр", "ЖЫЙ"),
        ("Ελένη", "ΘΛ1"),
        ("한글이름", "한국"),
        # Thai vowels are combining marks, not letters.
        ("ทดสอบ", "ไทย"),
    ],
    ids=["diacritics", "cyrillic", "greek", "hangul", "thai"],
)
async def test_a_riot_id_in_any_script_reaches_the_lookup(
    client: httpx.AsyncClient, service: AsyncMock, game_name: str, tag_line: str
) -> None:
    response = await _discover(client, game_name, tag_line)

    assert response.status_code == 200
    assert response.json()["game_name"] == game_name
    assert response.json()["tag_line"] == tag_line


@pytest.mark.parametrize(
    ("game_name", "tag_line"),
    [
        ("Name#Hash", "EUW"),
        ("Tab\tName", "EUW"),
        ("Name", "E\x00W"),
        ("Name", "😀"),
        ("Ж" * 17, "EUW"),
        ("Name", "ΑΒΓΔΕΖ"),
    ],
    ids=["hash", "tab", "nul", "emoji", "long-name", "long-tag"],
)
async def test_hash_control_characters_and_overlong_parts_are_still_refused(
    client: httpx.AsyncClient, service: AsyncMock, game_name: str, tag_line: str
) -> None:
    response = await _discover(client, game_name, tag_line)

    assert response.status_code == 422
    service.discover_player.assert_not_awaited()


def test_account_v1_receives_the_riot_id_percent_encoded() -> None:
    url = RiotAPIEndpoints().account_by_riot_id("Пётр Š", "한국", Region.EUROPE)

    assert url.endswith(f"/by-riot-id/{quote('Пётр Š', safe='')}/{quote('한국')}")
    assert url.isascii()
