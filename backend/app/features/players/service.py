# `_check_exact_match` guards `game_name`/`tag_line` against NULL even though
# both the ORM and the schema now type them non-optional. The guard predates
# revision 20260816_0014 and is kept as a defence against malformed Riot
# payloads, not against a lying annotation. Mirrors
# `reportUnnecessaryComparison = "none"` in pyproject.toml, which the
# file-level `strict` pragma otherwise discards.
# pyright: reportUnnecessaryComparison=none
"""Player service for handling player data operations."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING, TypedDict

import structlog
from Levenshtein import distance as levenshtein_distance
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    PlayerServiceError,
)
from app.core.riot_api.constants import (
    Platform,
    get_region_by_platform,
    normalize_platform,
)
from app.core.riot_api.models import LeagueEntryDTO, MatchDTO
from app.features.auth.models import User
from app.features.auth.user_settings import UserSettings
from app.features.auth.user_tracked_player import UserTrackedPlayer

from .leagues import PlayerLeague
from .models import Player
from .schemas import PlayerResponse

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

logger = structlog.get_logger(__name__)

MAX_TRACKED_PLAYERS_PER_USER = 10


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
        """Update core.players.is_tracked based on all user mappings."""
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

    async def get_player_by_name_and_tag(
        self, game_name: str, tag_line: str, platform: str
    ) -> PlayerResponse:
        """
        Get player by Game Name and Tag Line from database only.

        This method searches only the local database for players already being tracked.
        To add new players from Riot API, use a separate add/import feature.

        Args:
            game_name: Game name of the player
            tag_line: Tag line of the player
            platform: Riot API platform code (e.g., "NA1", "EUW1")

        Returns:
            Player response object with player data

        Raises:
            PlayerServiceError: If player is not found or database error occurs
            ValueError: If input parameters are invalid
        """
        if not game_name or not game_name.strip():
            raise ValueError("game_name cannot be empty")
        if not platform or not platform.strip():
            raise ValueError("platform cannot be empty")

        # Normalize inputs
        safe_game_name = game_name.strip()
        safe_tag_line = tag_line.strip() if tag_line else None
        normalized_platform = normalize_platform(platform)

        # Query database only
        result = await self.db.execute(
            select(Player).where(
                Player.game_name == safe_game_name,
                Player.tag_line == safe_tag_line,
                Player.platform == normalized_platform,
            )
        )
        player = result.scalar_one_or_none()

        if not player:
            raise PlayerServiceError(
                message=f"Player not found in database: {safe_game_name}#{safe_tag_line} on {normalized_platform}. "
                f"Please track this player first.",
                operation="get_player_by_name_and_tag",
                context={
                    "game_name": safe_game_name,
                    "tag_line": safe_tag_line,
                    "platform": normalized_platform,
                },
            )

        logger.info(
            "Player data retrieved from database",
            game_name=safe_game_name,
            tag_line=safe_tag_line,
            platform=normalized_platform,
            puuid=player.puuid,
        )

        return PlayerResponse.model_validate(player)

    def _find_exact_game_name_match(
        self, players: Sequence[Player], safe_game_name: str
    ) -> Player | None:
        """Find exact game name match from list of players."""
        for player in players:
            if player.game_name and player.game_name.lower() == safe_game_name.lower():
                return player
        return None

    def _handle_no_game_name_matches(
        self, safe_game_name: str, normalized_platform: str
    ) -> None:
        """Raise error when no game name matches found."""
        logger.info(
            "No player found in database for game name",
            game_name=safe_game_name,
            platform=normalized_platform,
        )
        raise PlayerServiceError(
            message=f"No players found matching '{safe_game_name}' on {normalized_platform}. "
            f"Please check the game name and platform, or track this player first.",
            operation="get_player_by_game_name",
            context={
                "game_name": safe_game_name,
                "platform": normalized_platform,
            },
        )

    async def get_player_by_game_name(
        self, game_name: str, platform: str
    ) -> PlayerResponse:
        """
        Get player by game name from database only.

        This searches only the local database for players already being tracked.
        To add new players from Riot API, use a separate add/import feature.

        Args:
            game_name: Game name (formerly summoner name) to search for
            platform: Riot API platform code

        Returns:
            Player response object with player data

        Raises:
            PlayerServiceError: If player is not found
        """
        # Normalize inputs
        safe_game_name = game_name.strip()
        normalized_platform = normalize_platform(platform)

        # Search database for exact match or partial match
        result = await self.db.execute(
            select(Player).where(
                Player.game_name.ilike(f"%{safe_game_name}%"),
                Player.platform == normalized_platform,
            )
        )
        players = result.scalars().all()

        # Try to find exact match first
        exact_match = self._find_exact_game_name_match(players, safe_game_name)
        if exact_match:
            logger.info(
                "Found exact match for game name",
                game_name=safe_game_name,
                platform=normalized_platform,
                puuid=exact_match.puuid,
            )
            return PlayerResponse.model_validate(exact_match)

        # If only one partial match, return it
        if len(players) == 1:
            logger.info(
                "Found single partial match for game name",
                game_name=safe_game_name,
                platform=normalized_platform,
                matched_name=players[0].game_name,
            )
            return PlayerResponse.model_validate(players[0])

        # If multiple partial matches, return error with suggestions
        if len(players) > 1:
            matched_names = [p.game_name for p in players if p.game_name]
            logger.info(
                "Found multiple matches for game name",
                game_name=safe_game_name,
                platform=normalized_platform,
                matches=matched_names,
            )
            raise PlayerServiceError(
                message=f"Multiple players found matching '{safe_game_name}': {', '.join(matched_names)}. "
                f"Please be more specific.",
                operation="get_player_by_game_name",
                context={
                    "game_name": safe_game_name,
                    "platform": normalized_platform,
                    "matches": matched_names,
                },
            )

        # No matches found
        self._handle_no_game_name_matches(safe_game_name, normalized_platform)
        raise AssertionError("Unreachable after _handle_no_game_name_matches")

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
                context={"puuid": puuid, "platform": platform},
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
    def _parse_search_query(query: str) -> tuple[str, str | None, str | None]:
        """
        Parse search query to detect search type and extract components.

        Returns:
            Tuple of (search_type, game_name, tag_line)
            search_type: "full_id", "tag", "name", or "all"
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
        platform: str | None,
        search_type: str,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
    ):
        """Build SQLAlchemy query based on search type."""
        platform_filter = [Player.platform.ilike(platform.strip())] if platform else []

        if search_type == "full_id" and game_name and tag_line:
            # Search for exact or partial Full ID (GameName # TagLine)
            return select(Player).where(
                and_(
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
            )

        if search_type == "tag" and tag_line:
            # Search tags only
            return select(Player).where(
                and_(
                    *platform_filter,
                    Player.tag_line.ilike(f"%{tag_line}%"),
                )
            )

        # name or all - search game names
        search_term = game_name if game_name else query_lower
        return select(Player).where(
            and_(
                *platform_filter,
                Player.game_name.ilike(f"%{search_term}%"),
            )
        )

    @staticmethod
    def _check_exact_match(player: Player, game_name: str, tag_line: str) -> bool:
        """Check if player is an exact match."""
        return bool(
            player.game_name is not None
            and player.game_name.lower() == game_name.lower()
            and player.tag_line is not None
            and player.tag_line.lower() == tag_line.lower()
        )

    @staticmethod
    def _score_game_name(
        player: Player, search_type: str, query_lower: str
    ) -> int | None:
        """Calculate distance for game name if applicable."""
        if player.game_name and (search_type in ["name", "all"]):
            return levenshtein_distance(query_lower, player.game_name.lower())
        return None

    @staticmethod
    def _score_composite_id(
        player: Player, search_type: str, query_lower: str
    ) -> int | None:
        """Calculate distance for full_id (game_name + tag) if applicable."""
        if player.game_name and (search_type in ["name", "full_id", "all"]):
            target = (
                (f"{player.game_name}#{player.tag_line}").lower()
                if player.tag_line
                else player.game_name.lower()
            )
            return levenshtein_distance(query_lower, target)
        return None

    @staticmethod
    def _score_tag_line(
        player: Player, search_type: str, query_lower: str, tag_line: str | None
    ) -> int | None:
        """Calculate distance for tag_line if applicable."""
        if player.tag_line and (search_type in ["tag", "full_id"]):
            tag_query = tag_line.lower() if tag_line else query_lower
            return levenshtein_distance(tag_query, player.tag_line.lower())
        return None

    @staticmethod
    def _calculate_levenshtein_distances(
        player: Player,
        search_type: str,
        query_lower: str,
        tag_line: str | None,
    ) -> list[int]:
        """Calculate Levenshtein distances for all relevant fields."""
        distances: list[int] = []

        # Score game name
        name_dist = PlayerService._score_game_name(player, search_type, query_lower)
        if name_dist is not None:
            distances.append(name_dist)

        # Score full_id composite
        composite_id_dist = PlayerService._score_composite_id(
            player, search_type, query_lower
        )
        if composite_id_dist is not None:
            distances.append(composite_id_dist)

        # Score tag_line
        tag_dist = PlayerService._score_tag_line(
            player, search_type, query_lower, tag_line
        )
        if tag_dist is not None:
            distances.append(tag_dist)

        return distances

    @staticmethod
    def _score_player_match(
        player: Player,
        search_type: str,
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
            and PlayerService._check_exact_match(player, game_name, tag_line)
        ):
            return 1000.0

        # Levenshtein scoring for fuzzy matches
        distances = PlayerService._calculate_levenshtein_distances(
            player, search_type, query_lower, tag_line
        )

        if distances:
            min_dist = min(distances)
            # Convert to score: 1 / (1 + distance)
            return 1.0 / (1.0 + min_dist)

        return 0.0

    def _validate_search_query(
        self, query: str, search_type: str, game_name: str | None, tag_line: str | None
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
        search_type: str,
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
        platform: str | None,
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

    async def get_recent_opponents_with_details(
        self, puuid: str, limit: int
    ) -> list[PlayerResponse]:
        """
        Get recent opponents for a player with their details from database only.

        Only returns players that exist in our database with game_name populated.
        Does NOT make any Riot API calls.

        Args:
            puuid: Player PUUID
            limit: Maximum number of unique opponents to return

        Returns:
            List of PlayerResponse objects for opponents found in database

        Raises:
            ValueError: If puuid is empty or limit is not positive
        """
        if not puuid or not puuid.strip():
            raise ValueError("puuid cannot be empty")
        if limit <= 0:
            raise ValueError("limit must be positive")

        from app.features.matches.participants import MatchParticipant

        # Use a single JOIN query to get opponent player data efficiently (fixes N+1 query problem)
        # This joins MatchParticipant twice: once to find recent matches, once to find opponents
        recent_matches_subq = (
            select(MatchParticipant.match_id)
            .where(MatchParticipant.puuid == puuid)
            .limit(limit * 5)  # Get more matches to find enough opponents
            .subquery()
        )

        players_stmt = (
            select(Player)
            .join(MatchParticipant, Player.puuid == MatchParticipant.puuid)
            .where(
                and_(
                    MatchParticipant.match_id.in_(
                        select(recent_matches_subq.c.match_id)
                    ),
                    MatchParticipant.puuid != puuid,
                    Player.game_name.isnot(None),
                    Player.game_name != "",
                )
            )
            .distinct()
            .limit(limit)
        )

        result = await self.db.execute(players_stmt)
        players = result.scalars().all()

        logger.debug(
            "Found recent opponents with details",
            puuid=puuid,
            opponent_count=len(players),
            limit=limit,
        )

        return [PlayerResponse.model_validate(player) for player in players]

    # === Player Tracking Methods for Automated Jobs ===

    async def add_and_track_player(
        self,
        riot_client: RiotAPIClient,
        game_name: str,
        tag_line: str,
        user_id: int,
        platform: str = "eun1",
    ) -> PlayerResponse:
        """
        Fetch player from Riot API and track them.

        Combines player upsert + tracking in one flow.

        Args:
            riot_client: RiotAPIClient instance
            game_name: Riot game name
            tag_line: Riot tag line
            platform: Platform code (default: eun1)
            user_id: User ID for user-scoped tracking

        Returns:
            PlayerResponse

        Raises:
            ValueError: If player not found
        """
        try:
            player = await self.discover_player(
                riot_client=riot_client,
                game_name=game_name,
                tag_line=tag_line,
                platform=platform,
            )
            return await self.track_player(player.puuid, user_id)
        except Exception as error:
            logger.error(
                "add_and_track_player_failed",
                error_type=type(error).__name__,
            )
            raise

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
            raise ValueError(f"Player {game_name}#{tag_line} was not found.")

        summoner = await riot_client.get_summoner_by_puuid(account.puuid, platform_enum)
        if not summoner:
            raise ValueError("Player details were not found on this server.")

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
        player = await self.db.get(Player, puuid)

        if not player:
            raise ValueError("Player not found.")

        existing = await self._is_player_tracked_by_user(puuid, user_id)
        if existing:
            response = PlayerResponse.model_validate(player)
            response.is_tracked = True
            return response

        user = await self.db.scalar(
            select(User).where(User.id == user_id).with_for_update()
        )
        if user is None:
            raise ValueError("Your account was not found. Please sign in again.")

        tracked_count = await self.db.scalar(
            select(func.count())
            .select_from(UserTrackedPlayer)
            .where(UserTrackedPlayer.user_id == user_id)
        )
        if (tracked_count or 0) >= MAX_TRACKED_PLAYERS_PER_USER:
            raise ValueError(
                "You can track up to 10 players. Manage tracked players to make room."
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
        player = await self.db.get(Player, puuid)

        if not player:
            raise ValueError("Player not found.")

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

    async def get_player_tracking_status(self, puuid: str, user_id: int) -> bool:
        """Get user-specific tracking status for a player."""
        player = await self.db.get(Player, puuid)
        if not player:
            raise ValueError("Player not found.")

        return await self._is_player_tracked_by_user(puuid, user_id)

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
        """Return the authenticated user's current and recent tracked players."""
        from .schemas import PlayerContextResponse

        settings = await self.db.scalar(
            select(UserSettings).where(UserSettings.user_id == user_id)
        )
        if settings is None:
            settings = UserSettings(user_id=user_id)
            self.db.add(settings)
            await self.db.flush()

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

        tracked_players = await self.get_tracked_players(user_id)
        await self.db.commit()
        return PlayerContextResponse(
            current_player=current_player,
            tracked_players=tracked_players,
        )

    async def set_current_player(self, user_id: int, puuid: str | None):
        """Persist one user's default player and update tracked recency."""
        settings = await self.db.scalar(
            select(UserSettings)
            .where(UserSettings.user_id == user_id)
            .with_for_update()
        )
        if settings is None:
            settings = UserSettings(user_id=user_id)
            self.db.add(settings)
            await self.db.flush()

        if puuid is not None and await self.db.get(Player, puuid) is None:
            raise ValueError("Player not found")

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

    async def count_tracked_players(self) -> int:
        """Get count of currently tracked players.

        Returns:
            Number of tracked players.
        """
        query = select(func.count()).select_from(Player).where(Player.is_tracked)

        result = await self.db.execute(query)
        return result.scalar() or 0

    # === Methods for Player Analyzer Job ===

    async def get_players_needing_matches(
        self, limit: int, target_matches: int
    ) -> list[Player]:
        """
        Get discovered players with insufficient match history.

        This is used by the player analyzer job to find players that need
        more matches fetched before they can be analyzed.

        Args:
            limit: Maximum number of players to return
            target_matches: Target number of matches per player

        Returns:
            List of Player objects needing match data
        """
        from app.features.matches.participants import MatchParticipant

        stmt = (
            select(Player, func.count(MatchParticipant.match_id).label("match_count"))
            .join(
                MatchParticipant, Player.puuid == MatchParticipant.puuid, isouter=True
            )
            .where(Player.is_tracked.is_(False))
            .group_by(Player.puuid)
            .having(func.count(MatchParticipant.match_id) < target_matches)
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        rows = result.all()
        players = [row[0] for row in rows]

        logger.debug(
            "Found players needing matches",
            count=len(players),
            target_matches=target_matches,
        )

        # Log detailed info for each player to diagnose stuck state
        for row in rows:
            player, match_count = row[0], row[1]
            logger.debug(
                "Player needing matches details",
                puuid=player.puuid,
                current_matches=match_count,
                target_matches=target_matches,
                is_tracked=player.is_tracked,
            )

        return players

    async def get_players_ready_for_analysis(
        self, limit: int, min_matches: int = 20
    ) -> list[Player]:
        """
        Get unanalyzed players with sufficient match history for playstyle analysis.

        This is used by the player analyzer job to find players ready for
        playstyle analysis.

        Args:
            limit: Maximum number of players to return
            min_matches: Minimum number of matches required for analysis

        Returns:
            List of Player objects ready for analysis
        """
        from app.features.matches.participants import MatchParticipant
        from app.features.playstyle_analysis.models import PlaystyleAnalysis

        stmt = (
            select(Player, func.count(MatchParticipant.match_id).label("match_count"))
            .join(MatchParticipant, Player.puuid == MatchParticipant.puuid)
            .outerjoin(PlaystyleAnalysis, Player.puuid == PlaystyleAnalysis.puuid)
            .where(Player.is_tracked.is_(False))
            .where(PlaystyleAnalysis.puuid.is_(None))
            .group_by(Player.puuid)
            .having(func.count(MatchParticipant.match_id) >= min_matches)
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        rows = result.all()
        players = [row[0] for row in rows]

        logger.debug(
            "Found players ready for analysis",
            count=len(players),
            min_matches=min_matches,
        )

        # Log detailed info for each player to diagnose analysis readiness
        for row in rows:
            player, match_count = row[0], row[1]
            logger.debug(
                "Player ready for analysis details",
                puuid=player.puuid,
                current_matches=match_count,
                min_matches=min_matches,
                is_tracked=player.is_tracked,
            )

        return players

    # ============================================
    # Helper Methods for Jobs
    # ============================================

    async def discover_players_from_match(
        self, match_dto: MatchDTO, platform: str
    ) -> int:
        """
        Discover and create player records from match participants.

        This method checks if players exist in the database and creates
        minimal player records for any new players discovered in a match.
        These discovered players are marked as not tracked and not analyzed.

        The method handles its own transaction boundaries to ensure
        data consistency without requiring external transaction management.

        Args:
            match_dto: Match DTO from Riot API
            platform: Platform for the players

        Returns:
            Number of newly discovered players

        Raises:
            PlayerServiceError: If match processing fails
            ValueError: If input parameters are invalid
        """
        if not platform or not platform.strip():
            raise ValueError("platform cannot be empty")

        from app.features.matches.transformers import PlayerDataSanitizer

        await _ensure_riot_writer_maintenance_is_inactive(self.db)
        normalized_platform = normalize_platform(platform)
        discovered_count = 0

        for participant in match_dto.info.participants:
            # Check if player exists in database
            result = await self.db.execute(
                select(Player).where(Player.puuid == participant.puuid)
            )
            existing_player = result.scalar_one_or_none()

            if not existing_player:
                # Sanitize player data
                player_data = {
                    "game_name": participant.game_name,
                    "tag_line": participant.tag_line,
                }
                player_data = PlayerDataSanitizer.sanitize_player_fields(player_data)

                # Create new player record (discovered, not tracked)
                new_player = Player(
                    puuid=participant.puuid,
                    game_name=player_data["game_name"],
                    tag_line=player_data["tag_line"],
                    platform=normalized_platform,
                    summoner_level=participant.summoner_level,
                    is_tracked=False,
                )
                self.db.add(new_player)
                discovered_count += 1

                logger.debug(
                    "Marked new discovered player",
                    puuid=participant.puuid,
                    game_name=player_data["game_name"],
                )

        # Commit transaction for all discovered players
        if discovered_count > 0:
            await self.db.commit()
            logger.info(
                "Discovered players from match",
                match_id=match_dto.metadata.match_id,
                discovered_count=discovered_count,
                platform=normalized_platform,
            )
        else:
            logger.debug(
                "No new players discovered in match",
                match_id=match_dto.metadata.match_id,
                platform=normalized_platform,
            )

        return discovered_count

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
