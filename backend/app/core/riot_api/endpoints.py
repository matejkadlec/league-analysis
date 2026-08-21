"""Riot API endpoint definitions and routing information."""

from urllib.parse import quote, urlencode

import structlog

from .constants import MatchType, Platform, QueueType, Region, enum_str

logger = structlog.get_logger(__name__)

# One spelling per Riot path. The builders below format these into a URL and
# the client hands the same string to `_record_api_call`, so an endpoint that
# moves cannot leave the job log reporting where it used to be.
ACCOUNT_BY_RIOT_ID = "/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}"
ACCOUNT_BY_PUUID = "/riot/account/v1/accounts/by-puuid/{puuid}"
SUMMONER_BY_PUUID = "/lol/summoner/v4/summoners/by-puuid/{puuid}"
MATCH_LIST_BY_PUUID = "/lol/match/v5/matches/by-puuid/{puuid}/ids"
MATCH_BY_ID = "/lol/match/v5/matches/{matchId}"
MATCH_TIMELINE_BY_ID = "/lol/match/v5/matches/{matchId}/timeline"
LEAGUE_ENTRIES_BY_PUUID = "/lol/league/v4/entries/by-puuid/{puuid}"


class RiotAPIEndpoints:
    """Riot API endpoint definitions and routing."""

    def __init__(
        self, region: Region = Region.EUROPE, platform: Platform = Platform.EUN1
    ):
        """
        Initialize endpoint configuration.

        Args:
            region: Default region for regional endpoints
            platform: Default platform for platform endpoints
        """
        self.region = region
        self.platform = platform

    def get_base_url(self, region: Region | None = None) -> str:
        """Get base URL for regional endpoints."""
        region = region or self.region
        return f"https://{enum_str(region)}.api.riotgames.com"

    def get_platform_url(self, platform: Platform | None = None) -> str:
        """Get base URL for platform endpoints."""
        platform = platform or self.platform
        return f"https://{enum_str(platform)}.api.riotgames.com"

    # Account endpoints (Regional)
    def account_by_riot_id(
        self, game_name: str, tag_line: str, region: Region | None = None
    ) -> str:
        """Get account by Riot ID endpoint."""
        base_url = self.get_base_url(region)
        path = ACCOUNT_BY_RIOT_ID.format(
            gameName=quote(game_name, safe=""), tagLine=quote(tag_line, safe="")
        )
        return f"{base_url}{path}"

    def account_by_puuid(self, puuid: str, region: Region | None = None) -> str:
        """Get account by PUUID endpoint."""
        base_url = self.get_base_url(region)
        return base_url + ACCOUNT_BY_PUUID.format(puuid=quote(puuid, safe=""))

    def summoner_by_puuid(self, puuid: str, platform: Platform | None = None) -> str:
        """Get summoner by PUUID endpoint."""
        platform_url = self.get_platform_url(platform)
        return platform_url + SUMMONER_BY_PUUID.format(puuid=quote(puuid, safe=""))

    # Match endpoints (Regional)
    def match_list_by_puuid(
        self,
        puuid: str,
        start: int = 0,
        count: int = 20,
        queue: QueueType | None = None,
        type: MatchType | None = None,
        start_time: int | None = None,
        end_time: int | None = None,
        region: Region | None = None,
    ) -> str:
        """Get match list by PUUID endpoint."""
        base_url = self.get_base_url(region)
        url = base_url + MATCH_LIST_BY_PUUID.format(puuid=quote(puuid, safe=""))

        params: dict[str, int | str] = {"start": start, "count": count}

        if queue:
            params["queue"] = queue.value
        if type:
            params["type"] = type.value
        if start_time is not None:
            params["startTime"] = start_time
        if end_time is not None:
            params["endTime"] = end_time

        return f"{url}?{urlencode(params)}"

    def match_by_id(self, match_id: str, region: Region | None = None) -> str:
        """Get match by ID endpoint."""
        base_url = self.get_base_url(region)
        return base_url + MATCH_BY_ID.format(matchId=quote(match_id, safe=""))

    def match_timeline_by_id(self, match_id: str, region: Region | None = None) -> str:
        """Get match timeline by ID endpoint."""
        base_url = self.get_base_url(region)
        return base_url + MATCH_TIMELINE_BY_ID.format(matchId=quote(match_id, safe=""))

    # League endpoints (Platform)
    def league_entries_by_puuid(
        self, puuid: str, platform: Platform | None = None
    ) -> str:
        """Get league entries by encrypted PUUID endpoint."""
        platform_url = self.get_platform_url(platform)
        return platform_url + LEAGUE_ENTRIES_BY_PUUID.format(
            puuid=quote(puuid, safe="")
        )


def parse_rate_limit_header(header_value: str) -> list[dict[str, int]]:
    """
    Parse a rate limit or rate count header value; both share the grammar.

    Example: "20:1,100:120" -> [{"requests": 20, "window": 1}, {"requests": 100, "window": 120}]

    Args:
        header_value: Rate limit or rate count header value

    Returns:
        List of rate limit dictionaries
    """
    if not header_value:
        return []

    limits: list[dict[str, int]] = []
    for part in header_value.split(","):
        try:
            requests, window = map(int, part.strip().split(":"))
            limits.append({"requests": requests, "window": window})
        except ValueError, AttributeError:
            logger.warning(
                "Failed to parse rate limit part", part=part, header=header_value
            )
            continue

    return limits
