"""Player service for handling player data operations."""

from typing import List, Any, TYPE_CHECKING
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, and_, or_
from Levenshtein import distance as levenshtein_distance
import structlog

from .models import Player
from .schemas import PlayerResponse
from app.core.exceptions import (
    PlayerServiceError,
)
from app.core.decorators import service_error_handler, input_validation
from app.core.riot_api.constants import Region, Platform

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient
    from .leagues import PlayerLeague

logger = structlog.get_logger(__name__)


class PlayerService:
    """Service for handling player data operations."""

    def __init__(self, db: AsyncSession):
        """Initialize player service with database session only."""
        self.db = db

    @service_error_handler("PlayerService")
    @input_validation(
        validate_non_empty=["game_name", "platform"],
    )
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
            ValidationError: If input parameters are invalid
        """
        # Normalize inputs
        safe_game_name = game_name.strip()
        safe_tag_line = tag_line.strip() if tag_line else None
        normalized_platform = platform.strip().upper()

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
        self, players: list[Player], safe_game_name: str
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
            ValidationError: If input parameters are invalid
        """
        # Normalize inputs
        safe_game_name = game_name.strip()
        normalized_platform = platform.strip().upper()

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

    async def get_player_by_puuid(
        self, puuid: str, platform: str = "eun1"
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
        from app.features.matches.participants import MatchParticipant
        from app.features.matches.models import Match

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
            .where(MatchParticipant.puuid == puuid, Match.fully_analyzed == True)
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
        platform: str,
        search_type: str,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
    ):
        """Build SQLAlchemy query based on search type."""
        if search_type == "full_id" and game_name and tag_line:
            # Search for exact or partial Full ID (GameName # TagLine)
            return select(Player).where(
                and_(
                    Player.platform == platform,
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
                    Player.platform == platform,
                    Player.tag_line.ilike(f"%{tag_line}%"),
                )
            )

        # name or all - search game names
        search_term = game_name if game_name else query_lower
        return select(Player).where(
            and_(
                Player.platform == platform,
                Player.game_name.ilike(f"%{search_term}%"),
            )
        )

    @staticmethod
    def _check_exact_match(player: Player, game_name: str, tag_line: str) -> bool:
        """Check if player is an exact match."""
        return (
            player.game_name
            and player.game_name.lower() == game_name.lower()
            and player.tag_line
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
        distances = []

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
        players: list[Player],
        search_type: str,
        query_lower: str,
        game_name: str | None,
        tag_line: str | None,
        limit: int,
    ) -> list[dict]:
        """Score players by relevance and return top matches."""
        scored_players = [
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
        self, query: str, platform: str, limit: int = 10
    ) -> List[PlayerResponse]:
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

        return [PlayerResponse.model_validate(p["player"]) for p in top_players]

    @service_error_handler("PlayerService")
    @input_validation(validate_non_empty=["puuid"], validate_positive=["limit"])
    async def get_recent_opponents_with_details(
        self, puuid: str, limit: int
    ) -> List[PlayerResponse]:
        """
        Get recent opponents for a player with their details from database only.

        Only returns players that exist in our database with game_name populated.
        Does NOT make any Riot API calls.

        Args:
            puuid: Player PUUID
            limit: Maximum number of unique opponents to return

        Returns:
            List of PlayerResponse objects for opponents found in database
        """
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
                    MatchParticipant.match_id.in_(recent_matches_subq),
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
        riot_client: "RiotAPIClient",
        game_name: str,
        tag_line: str,
        platform: str = "eun1",
    ) -> PlayerResponse:
        """
        Fetch player from Riot API and immediately track them.

        Combines get_player + track_player in one transaction.

        Args:
            riot_client: RiotAPIClient instance
            game_name: Riot game name
            tag_line: Riot tag line
            platform: Platform code (default: eun1)

        Returns:
            PlayerResponse with is_tracked=True

        Raises:
            ValueError: If player not found
        """
        try:
            # Determine Region from Platform for Account API
            # Heuristic mapping
            platform_lower = platform.lower()
            region = Region.EUROPE  # Default

            if platform_lower in ["na1", "br1", "la1", "la2"]:
                region = Region.AMERICAS
            elif platform_lower in ["kr", "jp1"]:
                region = Region.ASIA
            elif platform_lower in ["ph2", "sg2", "th2", "tw2", "vn2"]:
                region = Region.SEA

            platform_enum = Platform(platform_lower)

            # 1. Fetch Account data (PUUID, Name#Tag)
            account = await riot_client.get_account_by_riot_id(
                game_name, tag_line, region
            )

            if not account:
                raise ValueError(f"Player not found: {game_name}#{tag_line}")

            # 2. Fetch Summoner data (Level, Icon)
            summoner = await riot_client.get_summoner_by_puuid(
                account.puuid, platform_enum
            )

            if not summoner:
                # Should theoretically exist if account exists, but maybe different shard?
                raise ValueError(f"Summoner not found for PUUID: {account.puuid}")

            # 3. Upsert Player in DB
            stmt = select(Player).where(Player.puuid == account.puuid)
            result = await self.db.execute(stmt)
            player = result.scalar_one_or_none()

            if player:
                # Update existing
                player.game_name = account.game_name
                player.tag_line = account.tag_line
                player.platform = platform
                player.summoner_level = summoner.summoner_level
                player.profile_icon_id = summoner.profile_icon_id
                player.is_tracked = True
                player.updated_at = datetime.now(timezone.utc)

                logger.info(
                    "Player updated and tracked",
                    puuid=player.puuid,
                    game_name=player.game_name,
                )
            else:
                # Create new
                player = Player(
                    puuid=account.puuid,
                    game_name=account.game_name,
                    tag_line=account.tag_line,
                    platform=platform,
                    summoner_level=summoner.summoner_level,
                    profile_icon_id=summoner.profile_icon_id,
                    is_tracked=True,
                )
                self.db.add(player)

                logger.info(
                    "Player created and tracked",
                    puuid=player.puuid,
                    game_name=player.game_name,
                )

            await self.db.commit()
            await self.db.refresh(player)

            return PlayerResponse.model_validate(player)

        except Exception as e:
            # Check if it is a 404 from Riot API (usually comes as exception from client)
            # You might want to handle it specifically if your client raises specific exceptions
            logger.error("add_and_track_player_failed", error=str(e))
            raise e

    async def track_player(self, puuid: str) -> PlayerResponse:
        """Mark a player as tracked for automated monitoring.

        Args:
            puuid: Player's PUUID to track.

        Returns:
            Updated player data.

        Raises:
            ValueError: If player not found.
        """
        # Update player to tracked status
        stmt = (
            update(Player)
            .where(Player.puuid == puuid)
            .values(is_tracked=True, updated_at=datetime.now(timezone.utc))
            .returning(Player)
        )

        result = await self.db.execute(stmt)
        player = result.scalar_one_or_none()

        if not player:
            raise ValueError(f"Player not found: {puuid}")

        await self.db.commit()

        logger.info(
            "Player marked as tracked",
            puuid=puuid,
            game_name=player.game_name,
        )

        return PlayerResponse.model_validate(player)

    async def untrack_player(self, puuid: str) -> PlayerResponse:
        """Remove a player from tracked status.

        Args:
            puuid: Player's PUUID to untrack.

        Returns:
            Updated player data.

        Raises:
            ValueError: If player not found.
        """
        stmt = (
            update(Player)
            .where(Player.puuid == puuid)
            .values(is_tracked=False, updated_at=datetime.now(timezone.utc))
            .returning(Player)
        )

        result = await self.db.execute(stmt)
        player = result.scalar_one_or_none()

        if not player:
            raise ValueError(f"Player not found: {puuid}")

        await self.db.commit()

        logger.info(
            "Player unmarked as tracked",
            puuid=puuid,
            game_name=player.game_name,
        )

        return PlayerResponse.model_validate(player)

    async def get_tracked_players(self) -> List[PlayerResponse]:
        """Get all players currently marked for tracking.

        Returns:
            List of tracked players.
        """
        query = (
            select(Player).where(Player.is_tracked == True).order_by(Player.game_name)
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
    ) -> List[Player]:
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
    ) -> List[Player]:
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

    async def get_players_for_ban_check(
        self, days: int, limit: int = 10
    ) -> List[Player]:
        """
        Get detected smurfs that need ban status checking.

        Note: Method deprecated/disabled due to schema changes (removal of last_ban_check).
        """
        # Feature disabled temporarily until schema is updated to support ban checks again
        return []

    async def check_ban_status(
        self, player: Player, riot_api_client: "RiotAPIClient"
    ) -> bool:
        """
        Check if a player is banned by attempting to fetch their summoner data.

        Note: Feature temporarily disabled.
        """
        # Feature disabled
        return False

    # ============================================
    # Helper Methods for Jobs
    # ============================================

    @service_error_handler("PlayerService")
    @input_validation(
        validate_non_empty=["platform"],
    )
    async def discover_players_from_match(self, match_dto: Any, platform: str) -> int:
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
            ValidationError: If input parameters are invalid
            DatabaseError: If database operations fail
        """
        from app.features.matches.transformers import PlayerDataSanitizer

        normalized_platform = platform.strip().upper()
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

    @service_error_handler("PlayerService")
    async def update_player_profile(
        self, player: Player, riot_api_client: "RiotAPIClient"
    ) -> bool:
        """Update player's profile info (game_name, tag_line, profile_icon_id, summoner_level) from Riot API.

        Fetches the latest summoner and account data and updates the player record.

        Args:
            player: Player to update profile for
            riot_api_client: RiotAPIClient instance

        Returns:
            True if profile was updated, False if unchanged or error

        Raises:
            ValueError: If player has invalid platform
        """
        from app.core.riot_api.constants import Platform, Region
        from datetime import datetime, timezone

        logger.debug("Updating player profile", puuid=player.puuid)

        # Convert platform string to Platform enum
        platform_enum = Platform(player.platform.lower())

        # Determine region from platform
        platform_lower = player.platform.lower()
        region = Region.EUROPE  # Default

        if platform_lower in ["na1", "br1", "la1", "la2"]:
            region = Region.AMERICAS
        elif platform_lower in ["kr", "jp1"]:
            region = Region.ASIA
        elif platform_lower in ["ph2", "sg2", "th2", "tw2", "vn2"]:
            region = Region.SEA

        try:
            # Fetch summoner data for profile_icon_id and summoner_level
            summoner = await riot_api_client.get_summoner_by_puuid(
                player.puuid, platform_enum
            )

            # Fetch account data for game_name and tag_line
            account = await riot_api_client.get_account_by_puuid(player.puuid, region)

            # Check if anything changed
            changed = False
            if account.game_name != player.game_name:
                player.game_name = account.game_name
                changed = True
            if account.tag_line != player.tag_line:
                player.tag_line = account.tag_line
                changed = True
            if summoner.profile_icon_id != player.profile_icon_id:
                player.profile_icon_id = summoner.profile_icon_id
                changed = True
            if summoner.summoner_level != player.summoner_level:
                player.summoner_level = summoner.summoner_level
                changed = True

            if changed:
                player.updated_at = datetime.now(timezone.utc)
                logger.info(
                    "Updated player profile",
                    puuid=player.puuid,
                    game_name=player.game_name,
                    profile_icon_id=player.profile_icon_id,
                )
                return True
            else:
                logger.debug("Player profile unchanged", puuid=player.puuid)
                return False

        except Exception as e:
            logger.error(
                "Failed to update player profile",
                puuid=player.puuid,
                error=str(e),
            )
            return False

    @service_error_handler("PlayerService")
    async def update_player_league(
        self, player: Player, riot_api_client: "RiotAPIClient"
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
        from .leagues import PlayerLeague

        logger.debug("Updating player league", puuid=player.puuid)

        # Convert platform string to Platform enum
        platform_enum = Platform(player.platform.lower())

        # Fetch league data from Riot API using PUUID-based endpoint
        league_entries = await riot_api_client.get_league_entries_by_puuid(
            player.puuid, platform_enum
        )

        if not league_entries:
            logger.debug("No ranked data found for player", puuid=player.puuid)
            return False

        # Find Solo/Duo ranked entry
        solo_entry = next(
            (e for e in league_entries if e.queue_type == "RANKED_SOLO_5x5"), None
        )

        if not solo_entry:
            logger.debug("No Solo/Duo league found for player", puuid=player.puuid)
            return False

        # Get the most recent league to compare
        current_league = await self.get_player_league(player.puuid)

        # Check if league has changed (tier, rank, LP, wins, losses)
        if current_league:
            is_same = (
                current_league.tier == solo_entry.tier
                and current_league.rank == solo_entry.rank
                and current_league.league_points == solo_entry.league_points
                and current_league.wins == solo_entry.wins
                and current_league.losses == solo_entry.losses
            )
            if is_same:
                logger.debug(
                    "Player league unchanged, skipping insert",
                    puuid=player.puuid,
                    tier=solo_entry.tier,
                )
                return False

        # Create league record with all fields from Riot API
        league_record = PlayerLeague(
            puuid=player.puuid,
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

        self.db.add(league_record)

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
    ) -> "PlayerLeague | None":
        """Get the most recent league for a player.

        Args:
            puuid: Player's PUUID
            queue_type: Queue type (default: RANKED_SOLO_5x5)

        Returns:
            Most recent PlayerLeague or None if no league data exists
        """
        from sqlalchemy import select
        from .leagues import PlayerLeague

        stmt = (
            select(PlayerLeague)
            .where(PlayerLeague.puuid == puuid)
            .where(PlayerLeague.queue_type == queue_type)
            .order_by(PlayerLeague.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
