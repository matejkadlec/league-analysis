"""Player service for handling player data operations."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final, Literal, TypedDict

import structlog
from rapidfuzz.distance.Levenshtein import distance as levenshtein_distance
from sqlalchemy import Select, and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    PlayerServiceError,
)
from app.core.http_errors import http_error
from app.core.riot_api.constants import (
    Platform,
    get_region_by_platform,
)
from app.core.riot_api.models import LeagueEntryDTO
from app.features.auth.models import User
from app.features.auth.user_settings import ensure_user_settings
from app.features.auth.user_tracked_player import UserTrackedPlayer

from .leagues import PlayerLeague
from .models import Player
from .schemas import PlayerResponse

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

logger = structlog.get_logger(__name__)

MAX_TRACKED_PLAYERS_PER_USER: Final = 10

# What `_parse_search_query` read out of the raw query string; every
# scoring branch below switches on it.
SearchType = Literal["full_id", "tag", "name", "all"]


class PlayerNotFoundError(ValueError):
    """No player row matches the PUUID or Riot ID the caller named.

    A `ValueError` subclass on purpose: the routers that answer 404 for every
    failure of an operation still catch `ValueError` unconditionally and keep
    working. Only the routes that need to tell 404 from 400 catch this.
    """


class TrackingLimitReachedError(ValueError):
    """The user already tracks `MAX_TRACKED_PLAYERS_PER_USER` players."""


class ScoredPlayer(TypedDict):
    """A fuzzy-search candidate together with the keys it is ranked by.

    ``name`` is the sort tiebreaker and is the empty string when the row has
    no game name, so it stays a plain ``str`` rather than an optional.
    """

    player: Player
    score: float
    name: str


async def _ensure_riot_writer_maintenance_is_inactive(session: AsyncSession) -> None:
    """Avoid importing the jobs package until a direct Riot-data write runs."""
    from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive

    await ensure_riot_writer_maintenance_is_inactive(session)


class PlayerService:
    """Service for handling player data operations."""

    def __init__(self, db: AsyncSession):
        """Initialize player service with database session only."""
        self.db = db

    async def _is_player_tracked_by_user(self, puuid: str, user_id: int) -> bool:
        """Check whether a player is tracked by a specific user."""
        stmt = (
            select(UserTrackedPlayer.user_id)
            .where(
                UserTrackedPlayer.user_id == user_id,
                UserTrackedPlayer.puuid == puuid,
            )
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def _get_user_tracked_puuids(
        self, user_id: int, puuids: list[str]
    ) -> set[str]:
        """Get subset of PUUIDs tracked by a specific user."""
        if not puuids:
            return set()

        stmt = select(UserTrackedPlayer.puuid).where(
            UserTrackedPlayer.user_id == user_id,
            UserTrackedPlayer.puuid.in_(puuids),
        )
        result = await self.db.execute(stmt)
        return set(result.scalars().all())

    async def _update_global_tracking_flag(self, puuid: str) -> bool:
        """Update core.players.is_tracked based on all user mappings.

        Locks the player row first: this counts and then writes what it
        counted, and two users touching one PUUID at once used to interleave
        there. A's untrack counted 0 without seeing B's uncommitted track,
        waited on B's row lock, and then wrote its stale `false` last -- so
        the mapping table said B tracks the player while `is_tracked` said
        nobody did, and `get_globally_tracked_players` is the allowlist both
        writer jobs load. B's UI reads the mapping table, so it kept showing
        the player as tracked while its matches and rank silently stopped.
        Nothing self-heals that; only another track or untrack clears it.

        A correlated `UPDATE ... SET is_tracked = EXISTS(...)` does not fix
        it: under READ COMMITTED the subquery's snapshot predates the lock
        wait, so the loser rewrites the same stale value.
        """
        await self.db.execute(
            select(Player.puuid).where(Player.puuid == puuid).with_for_update()
        )
        count_stmt = (
            select(func.count())
            .select_from(UserTrackedPlayer)
            .where(UserTrackedPlayer.puuid == puuid)
        )
        count_result = await self.db.execute(count_stmt)
        is_globally_tracked = (count_result.scalar() or 0) > 0

        await self.db.execute(
            update(Player)
            .where(Player.puuid == puuid)
            .values(
                is_tracked=is_globally_tracked,
                updated_at=datetime.now(UTC),
            )
        )

        return is_globally_tracked

    async def get_player_by_puuid(
        self, puuid: str, platform: str = "eun1", user_id: int | None = None
    ) -> PlayerResponse:
        """Get player by PUUID from database only. Never calls Riot API."""
        # Query database only
        result = await self.db.execute(select(Player).where(Player.puuid == puuid))
        player = result.scalar_one_or_none()

        if not player:
            raise PlayerServiceError(
                message=f"Player not found in database: {puuid}. "
                f"Please track this player first.",
                operation="get_player_by_puuid",
            )

        # Count total matches for this player
        from app.features.matches.models import Match
        from app.features.matches.participants import MatchParticipant

        # Get total matches count
        count_result = await self.db.execute(
            select(func.count())
            .select_from(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
        )
        total_matches = count_result.scalar() or 0

        # Get count of fully analyzed matches
        analyzed_count_result = await self.db.execute(
            select(func.count(Match.match_id))
            .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
            .where(
                MatchParticipant.puuid == puuid,
                Match.fully_analyzed.is_(True),
            )
        )
        analyzed_matches = analyzed_count_result.scalar() or 0

        logger.info(
            "Player data retrieved by PUUID from database",
            puuid=puuid,
            platform=platform,
            total_matches=total_matches,
            analyzed_matches=analyzed_matches,
        )

        response = PlayerResponse.model_validate(player)
        response.total_matches = total_matches
        response.analyzed_matches = analyzed_matches

        if user_id is not None:
            response.is_tracked = await self._is_player_tracked_by_user(puuid, user_id)

        return response

    @staticmethod
    def _parse_search_query(query: str) -> tuple[SearchType, str | None, str | None]:
        """
        Parse search query to detect search type and extract components.

        Returns:
            Tuple of (search_type, game_name, tag_line)
        """
        if query.startswith("#"):
            # Tag-only search: "#EUNE"
            return "tag", None, query[1:].strip()

        if "#" in query:
            # Full ID search: "John Doe#EUNE"
            if query.count("#") == 1:
                game_name, tag_line = query.split("#", 1)
                return "full_id", game_name.strip(), tag_line.strip()
            # Multiple # - treat as invalid, search everything
            return "all", None, None

        # Name search: "John Doe"
        return "name", query.strip(), None

    @staticmethod
    def _build_player_search_query(
        platform: Platform | None,
        search_type: SearchType,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
    ) -> Select[tuple[Player]]:
        """Build SQLAlchemy query based on search type."""
        # `platform` arrives as the enum, whose values are the one spelling the
        # column is allowed to hold (`ck_players_platform_is_lowercase`), so
        # this compares rather than `ilike`-ing around a casing question that
        # the database already settled.
        platform_filter = [Player.platform == platform.value] if platform else []

        if search_type == "full_id" and game_name and tag_line:
            # Search for exact or partial Full ID (GameName # TagLine)
            return select(Player).where(
                *platform_filter,
                or_(
                    # Exact match
                    and_(
                        Player.game_name.ilike(game_name),
                        Player.tag_line.ilike(tag_line),
                    ),
                    # Partial matches
                    Player.game_name.ilike(f"%{game_name}%"),
                    Player.tag_line.ilike(f"%{tag_line}%"),
                ),
            )

        if search_type == "tag" and tag_line:
            # Search tags only
            return select(Player).where(
                *platform_filter,
                Player.tag_line.ilike(f"%{tag_line}%"),
            )

        # name or all - search game names
        search_term = game_name if game_name else query_lower
        return select(Player).where(
            *platform_filter,
            Player.game_name.ilike(f"%{search_term}%"),
        )

    @staticmethod
    def _score_player_match(
        player: Player,
        search_type: SearchType,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
    ) -> float:
        """
        Calculate relevance score for a player match.

        Returns:
            Score where 1000.0 = exact match, 0.0-1.0 = fuzzy match quality
        """
        # Exact match = highest priority
        if (
            search_type == "full_id"
            and game_name
            and tag_line
            and player.game_name.lower() == game_name.lower()
            and player.tag_line.lower() == tag_line.lower()
        ):
            return 1000.0

        distance = PlayerService._closest_field_distance(
            player, search_type, query_lower, tag_line
        )
        # Convert to score: 1 / (1 + distance)
        return 1.0 / (1.0 + distance) if distance is not None else 0.0

    @staticmethod
    def _closest_field_distance(
        player: Player,
        search_type: SearchType,
        query_lower: str,
        tag_line: str | None,
    ) -> int | None:
        """Smallest edit distance over the fields this search type compares.

        None when the search type compares nothing on this player. The field
        sets are deliberately different: a tag search only ever looks at the
        tag, and a game-name search sees the tag only inside the full Riot ID.

        Split out from the caller only because the two together rank C on the
        complexity gate; the four one-caller helpers this replaced did the
        same work through four more frames.
        """
        composite = (
            f"{player.game_name}#{player.tag_line}".lower()
            if player.tag_line
            else player.game_name.lower()
        )
        # (applies?, query, target)
        candidates = [
            (
                bool(player.game_name) and search_type in ("name", "all"),
                query_lower,
                player.game_name.lower(),
            ),
            (
                bool(player.game_name) and search_type in ("name", "full_id", "all"),
                query_lower,
                composite,
            ),
            (
                bool(player.tag_line) and search_type in ("tag", "full_id"),
                tag_line.lower() if tag_line else query_lower,
                player.tag_line.lower(),
            ),
        ]
        distances = [
            levenshtein_distance(query, target)
            for applies, query, target in candidates
            if applies
        ]
        return min(distances) if distances else None

    def _validate_search_query(
        self,
        query: str,
        search_type: SearchType,
        game_name: str | None,
        tag_line: str | None,
    ) -> bool:
        """Validate search query and return False if invalid."""
        if len(query.strip()) < 1:
            logger.warning("Query too short", query=query)
            return False

        if search_type == "full_id" and (not game_name or not tag_line):
            logger.warning(
                "Invalid Full ID search: empty game_name or tag_line",
                query=query,
                search_type=search_type,
            )
            return False

        return True

    def _score_and_sort_players(
        self,
        players: Sequence[Player],
        search_type: SearchType,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
        limit: int,
    ) -> list[ScoredPlayer]:
        """Score players by relevance and return top matches."""
        scored_players: list[ScoredPlayer] = [
            {
                "player": player,
                "score": self._score_player_match(
                    player, search_type, query_lower, game_name, tag_line
                ),
                "name": player.game_name or "",
            }
            for player in players
        ]

        scored_players.sort(key=lambda x: (-x["score"], x["name"].lower()))
        return scored_players[:limit]

    async def fuzzy_search_players(
        self,
        query: str,
        platform: Platform | None,
        limit: int = 10,
        user_id: int | None = None,
    ) -> list[PlayerResponse]:
        """
        Search for players using fuzzy matching with Levenshtein distance.

        Auto-detects search type:
        - Contains '#' → Search Riot ID (game_name#tag_line)
        - Starts with '#' → Search tags only
        - Otherwise → Search game_name

        Returns up to `limit` results sorted by relevance:
        1. Exact Riot ID match (highest priority)
        2. Best game name matches (by Levenshtein distance)
        3. Best tag matches (by Levenshtein distance)
        4. Alphabetical as tiebreaker

        Args:
            query: Search query string
            platform: Platform code
            limit: Maximum results to return (default: 10)

        Returns:
            List of PlayerResponse sorted by relevance
        """
        # Parse search query
        search_type, game_name, tag_line = self._parse_search_query(query)

        # Validate search query
        if not self._validate_search_query(query, search_type, game_name, tag_line):
            return []

        # Build and execute database query
        query_lower = query.lower().strip()
        stmt = self._build_player_search_query(
            platform, search_type, query_lower, game_name, tag_line
        )
        stmt = stmt.limit(100)  # Prevent excessive result sets

        result = await self.db.execute(stmt)
        players = result.scalars().all()

        # Score and sort results
        top_players = self._score_and_sort_players(
            players, search_type, query_lower, game_name, tag_line, limit
        )

        logger.info(
            "Fuzzy search completed",
            query=query,
            platform=platform,
            search_type=search_type,
            total_candidates=len(players),
            results_returned=len(top_players),
        )

        user_tracked_puuids: set[str] = set()
        if user_id is not None:
            top_puuids = [item["player"].puuid for item in top_players]
            user_tracked_puuids = await self._get_user_tracked_puuids(
                user_id, top_puuids
            )

        responses: list[PlayerResponse] = []
        for item in top_players:
            response = PlayerResponse.model_validate(item["player"])
            if user_id is not None:
                response.is_tracked = item["player"].puuid in user_tracked_puuids
            responses.append(response)

        return responses

    # === Player Tracking Methods for Automated Jobs ===

    async def discover_player(
        self,
        riot_client: RiotAPIClient,
        game_name: str,
        tag_line: str,
        platform: str,
    ) -> PlayerResponse:
        """Resolve one Riot ID into shared canonical data without tracking it."""
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        platform_enum = Platform(platform.lower())
        region = get_region_by_platform(platform_enum)
        account = await riot_client.get_account_by_riot_id(game_name, tag_line, region)
        if not account:
            raise PlayerNotFoundError(f"Player {game_name}#{tag_line} was not found.")

        summoner = await riot_client.get_summoner_by_puuid(account.puuid, platform_enum)
        if not summoner:
            raise PlayerNotFoundError("Player details were not found on this server.")

        now = datetime.now(UTC)
        # A Riot ID whose stored row carries a different PUUID is left alone.
        # Discovery cannot tell a re-encrypted PUUID apart from a Riot ID that
        # was renamed away and reclaimed by another account, so merging the two
        # rows would risk moving one player's history onto another. A duplicate
        # row is the deliberate, visible, repairable outcome instead.
        player = await self.db.get(Player, account.puuid)
        if player is None:
            player = Player(
                puuid=account.puuid,
                game_name=account.game_name or game_name,
                tag_line=account.tag_line or tag_line,
                platform=platform_enum.value,
                summoner_level=summoner.summoner_level,
                profile_icon_id=summoner.profile_icon_id,
                is_tracked=False,
                profile_synced_at=now,
            )
            self.db.add(player)
        else:
            if account.game_name:
                player.game_name = account.game_name
            if account.tag_line:
                player.tag_line = account.tag_line
            player.platform = platform_enum.value
            player.summoner_level = summoner.summoner_level
            player.profile_icon_id = summoner.profile_icon_id
            player.profile_synced_at = now
            player.updated_at = now

        await self.db.commit()
        await self.db.refresh(player)
        response = PlayerResponse.model_validate(player)
        response.is_tracked = False
        return response

    async def track_player(self, puuid: str, user_id: int) -> PlayerResponse:
        """Mark a player as tracked by a specific user.

        Args:
            puuid: Player's PUUID to track.
            user_id: User who is tracking the player.

        Returns:
            Updated player data.

        Raises:
            ValueError: If player not found.
        """
        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        player = await self._require_player(puuid)

        existing = await self._is_player_tracked_by_user(puuid, user_id)
        if existing:
            response = PlayerResponse.model_validate(player)
            response.is_tracked = True
            return response

        user = await self.db.scalar(
            select(User).where(User.id == user_id).with_for_update()
        )
        if user is None:
            # Not a tracking failure: the session outlived its account row, so
            # the answer is "sign in again", not "that player does not exist".
            # `get_current_active_user` catches this in every ordinary case;
            # reaching here means the account was deleted mid-request.
            raise http_error(
                401,
                "AUTHENTICATION_REQUIRED",
                "Your account was not found. Please sign in again.",
            )

        tracked_count = await self.db.scalar(
            select(func.count())
            .select_from(UserTrackedPlayer)
            .where(UserTrackedPlayer.user_id == user_id)
        )
        if (tracked_count or 0) >= MAX_TRACKED_PLAYERS_PER_USER:
            raise TrackingLimitReachedError(
                f"You can track up to {MAX_TRACKED_PLAYERS_PER_USER} players. "
                "Manage tracked players to make room."
            )

        stmt = (
            insert(UserTrackedPlayer)
            .values(
                user_id=user_id,
                puuid=puuid,
                last_selected_at=datetime.now(UTC),
            )
            .on_conflict_do_nothing(index_elements=["user_id", "puuid"])
        )
        await self.db.execute(stmt)

        await self._update_global_tracking_flag(puuid)
        await self.db.commit()
        await self.db.refresh(player)

        logger.info(
            "Player marked as tracked",
            puuid=puuid,
            user_id=user_id,
            game_name=player.game_name,
        )

        response = PlayerResponse.model_validate(player)
        response.is_tracked = True
        return response

    async def untrack_player(self, puuid: str, user_id: int) -> PlayerResponse:
        """Remove a player from a user's tracked list.

        Args:
            puuid: Player's PUUID to untrack.
            user_id: User removing the player from tracking.

        Returns:
            Updated player data.

        Raises:
            ValueError: If player not found.
        """
        player = await self._require_player(puuid)

        stmt = delete(UserTrackedPlayer).where(
            UserTrackedPlayer.user_id == user_id,
            UserTrackedPlayer.puuid == puuid,
        )
        await self.db.execute(stmt)

        is_globally_tracked = await self._update_global_tracking_flag(puuid)
        await self.db.commit()
        await self.db.refresh(player)

        logger.info(
            "Player unmarked as tracked",
            puuid=puuid,
            user_id=user_id,
            is_globally_tracked=is_globally_tracked,
            game_name=player.game_name,
        )

        response = PlayerResponse.model_validate(player)
        response.is_tracked = False
        return response

    async def _require_player(self, puuid: str) -> Player:
        """Fetch a player or raise the error the routers translate to 404."""
        player = await self.db.get(Player, puuid)
        if not player:
            raise PlayerNotFoundError("Player not found.")
        return player

    async def get_tracked_players(self, user_id: int) -> list[PlayerResponse]:
        """Get all players tracked by a specific user.

        Returns:
            List of tracked players.
        """
        query = (
            select(Player)
            .join(UserTrackedPlayer, UserTrackedPlayer.puuid == Player.puuid)
            .where(UserTrackedPlayer.user_id == user_id)
            .order_by(
                UserTrackedPlayer.last_selected_at.desc(),
                UserTrackedPlayer.tracked_at.desc(),
                Player.game_name,
            )
        )

        result = await self.db.execute(query)
        players = result.scalars().all()

        responses = [PlayerResponse.model_validate(player) for player in players]
        for response in responses:
            response.is_tracked = True
        return responses

    async def get_player_context(self, user_id: int):
        """Return the authenticated user's current player."""
        from .schemas import PlayerContextResponse

        settings = await ensure_user_settings(self.db, user_id)

        current_player: PlayerResponse | None = None
        if settings.current_player_puuid:
            current_model = await self.db.get(Player, settings.current_player_puuid)
            if current_model is None:
                settings.current_player_puuid = None
            else:
                current_player = PlayerResponse.model_validate(current_model)
                current_player.is_tracked = await self._is_player_tracked_by_user(
                    current_model.puuid, user_id
                )

        await self.db.commit()
        return PlayerContextResponse(current_player=current_player)

    async def set_current_player(self, user_id: int, puuid: str | None):
        """Persist one user's default player and update tracked recency."""
        settings = await ensure_user_settings(self.db, user_id)

        if puuid is not None:
            await self._require_player(puuid)

        settings.current_player_puuid = puuid
        if puuid is not None:
            await self.db.execute(
                update(UserTrackedPlayer)
                .where(
                    UserTrackedPlayer.user_id == user_id,
                    UserTrackedPlayer.puuid == puuid,
                )
                .values(last_selected_at=datetime.now(UTC))
            )
        await self.db.commit()
        return await self.get_player_context(user_id)

    async def get_globally_tracked_players(self) -> list[PlayerResponse]:
        """Get all players tracked by at least one user."""
        query = (
            select(Player).where(Player.is_tracked.is_(True)).order_by(Player.game_name)
        )

        result = await self.db.execute(query)
        players = result.scalars().all()

        return [PlayerResponse.model_validate(player) for player in players]

    async def update_player_profile(
        self, player: Player, riot_api_client: RiotAPIClient
    ) -> bool:
        """Update player's profile info (game_name, tag_line, profile_icon_id, summoner_level) from Riot API.

        Fetches the latest summoner and account data and updates the player record.

        Args:
            player: Player to update profile for
            riot_api_client: RiotAPIClient instance

        Returns:
            True if profile was updated, False if unchanged

        Raises:
            ValueError: If player has invalid platform
        """
        from datetime import datetime

        from app.core.riot_api.constants import Platform, get_region_by_platform

        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        logger.debug("Updating player profile", puuid=player.puuid)

        # Convert platform string to Platform enum
        platform_enum = Platform(player.platform.lower())

        region = get_region_by_platform(platform_enum)

        # Fetch both sources before mutating the ORM object so a partial Riot
        # response cannot leave an uncommitted half-update in the session.
        summoner = await riot_api_client.get_summoner_by_puuid(
            player.puuid, platform_enum
        )
        account = await riot_api_client.get_account_by_puuid(player.puuid, region)

        changed = False
        if account.game_name is not None and account.game_name != player.game_name:
            player.game_name = account.game_name
            changed = True
        if account.tag_line is not None and account.tag_line != player.tag_line:
            player.tag_line = account.tag_line
            changed = True
        if summoner.profile_icon_id != player.profile_icon_id:
            player.profile_icon_id = summoner.profile_icon_id
            changed = True
        if summoner.summoner_level != player.summoner_level:
            player.summoner_level = summoner.summoner_level
            changed = True

        # A successful check is freshness evidence even when Riot returned the
        # same values. Keep it separate from generic ORM updated_at changes.
        player.profile_synced_at = datetime.now(UTC)

        if changed:
            player.updated_at = datetime.now(UTC)
            logger.info(
                "Updated player profile",
                puuid=player.puuid,
                game_name=player.game_name,
                profile_icon_id=player.profile_icon_id,
            )
            return True

        logger.debug("Player profile unchanged", puuid=player.puuid)
        return False

    @staticmethod
    def _solo_duo_league_entry(
        league_entries: Sequence[LeagueEntryDTO],
    ) -> LeagueEntryDTO | None:
        """Return the Solo/Duo league entry from a LEAGUE-V4 payload."""
        return next(
            (
                entry
                for entry in league_entries
                if entry.queue_type == "RANKED_SOLO_5x5"
            ),
            None,
        )

    @staticmethod
    def _league_snapshot_matches(
        current_league: PlayerLeague, solo_entry: LeagueEntryDTO
    ) -> bool:
        """Return True when the stored snapshot matches the live Solo/Duo entry."""
        return (
            current_league.tier == solo_entry.tier
            and current_league.rank == solo_entry.rank
            and current_league.league_points == solo_entry.league_points
            and current_league.wins == solo_entry.wins
            and current_league.losses == solo_entry.losses
        )

    @staticmethod
    def _player_league_from_entry(
        puuid: str, solo_entry: LeagueEntryDTO
    ) -> PlayerLeague:
        """Build an immutable league snapshot from a live Solo/Duo entry."""
        return PlayerLeague(
            puuid=puuid,
            league_id=solo_entry.league_id,
            queue_type=solo_entry.queue_type,
            tier=solo_entry.tier,
            rank=solo_entry.rank,
            league_points=solo_entry.league_points,
            wins=solo_entry.wins,
            losses=solo_entry.losses,
            veteran=solo_entry.veteran,
            inactive=solo_entry.inactive,
            fresh_blood=solo_entry.fresh_blood,
            hot_streak=solo_entry.hot_streak,
        )

    async def update_player_league(
        self, player: Player, riot_api_client: RiotAPIClient
    ) -> bool:
        """Update player's current league from Riot API.

        Fetches the player's ranked league entries and stores their
        Solo/Duo league in the PlayerLeague table only if league has changed.

        Args:
            player: Player to update league for
            riot_api_client: RiotAPIClient instance (from jobs)

        Returns:
            True if league was updated, False if no league data found or unchanged

        Raises:
            ValueError: If player has invalid platform
        """
        from app.core.riot_api.constants import Platform

        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        logger.debug("Updating player league", puuid=player.puuid)

        platform_enum = Platform(player.platform.lower())
        league_entries = await riot_api_client.get_league_entries_by_puuid(
            player.puuid, platform_enum
        )
        if not league_entries:
            logger.debug("No ranked data found for player", puuid=player.puuid)
            return False

        solo_entry = self._solo_duo_league_entry(league_entries)
        if not solo_entry:
            logger.debug("No Solo/Duo league found for player", puuid=player.puuid)
            return False

        current_league = await self.get_player_league(player.puuid)
        if current_league and self._league_snapshot_matches(current_league, solo_entry):
            logger.debug(
                "Player league unchanged, skipping insert",
                puuid=player.puuid,
                tier=solo_entry.tier,
            )
            return False

        self.db.add(self._player_league_from_entry(player.puuid, solo_entry))
        logger.info(
            "Updated player league",
            puuid=player.puuid,
            tier=solo_entry.tier,
            rank=solo_entry.rank,
            lp=solo_entry.league_points,
            hot_streak=solo_entry.hot_streak,
            fresh_blood=solo_entry.fresh_blood,
        )
        return True

    async def get_player_league(
        self, puuid: str, queue_type: str = "RANKED_SOLO_5x5"
    ) -> PlayerLeague | None:
        """Get the most recent league for a player.

        Args:
            puuid: Player's PUUID
            queue_type: Queue type (default: RANKED_SOLO_5x5)

        Returns:
            Most recent PlayerLeague or None if no league data exists
        """
        from sqlalchemy import select

        stmt = (
            select(PlayerLeague)
            .where(PlayerLeague.puuid == puuid)
            .where(PlayerLeague.queue_type == queue_type)
            .order_by(PlayerLeague.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
