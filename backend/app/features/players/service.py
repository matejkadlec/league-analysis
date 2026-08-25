"""Player service for handling player data operations."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final

import structlog
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ServiceException
from app.core.http_errors import http_error
from app.core.riot_api.constants import (
    Platform,
    get_region_by_platform,
)
from app.features.auth.models import User
from app.features.auth.user_settings import ensure_user_settings
from app.features.auth.user_tracked_player import UserTrackedPlayer
from app.features.jobs.maintenance import ensure_riot_writer_maintenance_is_inactive
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

from . import player_search
from .leagues import (
    PlayerLeague,
    league_snapshot_matches,
    player_league_from_entry,
    solo_duo_league_entry,
)
from .models import Player
from .schemas import PlayerResponse

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

logger = structlog.get_logger(__name__)

MAX_TRACKED_PLAYERS_PER_USER: Final = 10


class PlayerNotFoundError(ValueError):
    """No player row matches the PUUID or Riot ID the caller named.

    A `ValueError` subclass on purpose: the routers that answer 404 for every
    failure of an operation still catch `ValueError` unconditionally and keep
    working. Only the routes that need to tell 404 from 400 catch this.
    """


class TrackingLimitReachedError(ValueError):
    """The user already tracks `MAX_TRACKED_PLAYERS_PER_USER` players."""


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
        """Update core.players.is_tracked_by_anyone from all user mappings.

        Locks the player row first: count-then-write races otherwise leave
        the stale count last. A correlated `EXISTS` does not fix it -- under
        READ COMMITTED the subquery's snapshot predates the lock wait.
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
                is_tracked_by_anyone=is_globally_tracked,
                updated_at=datetime.now(UTC),
            )
        )

        return is_globally_tracked

    async def get_player_by_puuid(self, puuid: str, user_id: int) -> PlayerResponse:
        """Get player by PUUID from database only. Never calls Riot API."""
        # Query database only
        result = await self.db.execute(select(Player).where(Player.puuid == puuid))
        player = result.scalar_one_or_none()

        if not player:
            raise ServiceException(
                message=f"Player not found in database: {puuid}. "
                f"Please track this player first.",
                service="PlayerService",
                operation="get_player_by_puuid",
            )

        response = await self._one_player(player, user_id)

        # Logged off the response rather than from a second `_match_counts`:
        # `_one_player` has already run those two COUNTs to fill it.
        logger.info(
            "Player data retrieved by PUUID from database",
            puuid=puuid,
            platform=player.platform,
            total_matches=response.total_matches,
            analyzed_matches=response.analyzed_matches,
        )

        return response

    async def _match_counts(self, puuid: str) -> tuple[int, int]:
        """How many matches are stored for a player, and how many are analyzed."""
        count_result = await self.db.execute(
            select(func.count())
            .select_from(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
        )
        analyzed_count_result = await self.db.execute(
            select(func.count(Match.match_id))
            .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
            .where(
                MatchParticipant.puuid == puuid,
                Match.fully_analyzed.is_(True),
            )
        )
        return count_result.scalar() or 0, analyzed_count_result.scalar() or 0

    async def _one_player(self, player: Player, user_id: int) -> PlayerResponse:
        """One complete player, however the caller reached it.

        Both `/players/{puuid}` and the `current_player` on `/players/context`
        answer with a `PlayerResponse` for the same row, so both must fill the
        match counts here -- `PlayerResponse` silently defaults them to 0.
        """
        response = self._to_response(
            player,
            is_tracked=await self._is_player_tracked_by_user(player.puuid, user_id),
        )
        response.total_matches, response.analyzed_matches = await self._match_counts(
            player.puuid
        )
        return response

    @staticmethod
    def _to_response(player: Player, *, is_tracked: bool) -> PlayerResponse:
        """One player as one user sees it.

        `is_tracked` is per-user and has no column: `core.players` stores
        `is_tracked_by_anyone`, the writer jobs' allowlist. Passing it is
        therefore not optional.
        """
        response = PlayerResponse.model_validate(player)
        response.is_tracked = is_tracked
        return response

    async def fuzzy_search_players(
        self,
        query: str,
        platform: Platform | None,
        user_id: int,
        limit: int = 10,
    ) -> list[PlayerResponse]:
        """Search stored players and answer with per-user tracking flags.

        The search algorithm itself — parsing, SQL shape, scoring, ranking —
        lives in `player_search`; this method owns the database round trip
        and the per-user response assembly.
        """
        search_type, game_name, tag_line = player_search.parse_search_query(query)

        if not player_search.validate_search_query(
            query, search_type, game_name, tag_line
        ):
            return []

        query_lower = query.lower().strip()
        stmt = player_search.build_player_search_query(
            platform, search_type, query_lower, game_name, tag_line
        )
        stmt = stmt.limit(100)  # Prevent excessive result sets

        result = await self.db.execute(stmt)
        players = result.scalars().all()

        top_players = player_search.score_and_sort_players(
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

        user_tracked_puuids = await self._get_user_tracked_puuids(
            user_id, [item["player"].puuid for item in top_players]
        )

        return [
            self._to_response(
                item["player"],
                is_tracked=item["player"].puuid in user_tracked_puuids,
            )
            for item in top_players
        ]

    # === Player Tracking Methods for Automated Jobs ===

    async def discover_player(
        self,
        riot_client: RiotAPIClient,
        game_name: str,
        tag_line: str,
        platform: Platform,
        user_id: int,
    ) -> PlayerResponse:
        """Resolve one Riot ID into shared canonical data without tracking it."""
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        region = get_region_by_platform(platform)
        account = await riot_client.get_account_by_riot_id(game_name, tag_line, region)
        if not account:
            raise PlayerNotFoundError(f"Player {game_name}#{tag_line} was not found.")

        summoner = await riot_client.get_summoner_by_puuid(account.puuid, platform)
        if not summoner:
            raise PlayerNotFoundError("Player details were not found on this server.")

        now = datetime.now(UTC)
        # A Riot ID whose stored row carries a different PUUID is left alone:
        # discovery cannot tell a re-encrypted PUUID from a reclaimed Riot ID,
        # so merging would risk moving one player's history onto another.
        player = await self.db.get(Player, account.puuid)
        if player is None:
            player = Player(
                puuid=account.puuid,
                game_name=account.game_name or game_name,
                tag_line=account.tag_line or tag_line,
                platform=platform.value,
                summoner_level=summoner.summoner_level,
                profile_icon_id=summoner.profile_icon_id,
                profile_synced_at=now,
            )
            self.db.add(player)
        else:
            if account.game_name:
                player.game_name = account.game_name
            if account.tag_line:
                player.tag_line = account.tag_line
            player.platform = platform.value
            player.summoner_level = summoner.summoner_level
            player.profile_icon_id = summoner.profile_icon_id
            player.profile_synced_at = now
            player.updated_at = now

        await self.db.commit()
        await self.db.refresh(player)
        # Discovery resolves a Riot ID; it says nothing about tracking, and
        # the viewer may well track this player already.
        return self._to_response(
            player,
            is_tracked=await self._is_player_tracked_by_user(player.puuid, user_id),
        )

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
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        player = await self._require_player(puuid)

        existing = await self._is_player_tracked_by_user(puuid, user_id)
        if existing:
            return self._to_response(player, is_tracked=True)

        user = await self.db.scalar(
            select(User).where(User.id == user_id).with_for_update()
        )
        if user is None:
            # Not a tracking failure: the session outlived its account row, so
            # the answer is "sign in again", not "that player does not exist".
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

        return self._to_response(player, is_tracked=True)

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

        return self._to_response(player, is_tracked=False)

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

        return [self._to_response(player, is_tracked=True) for player in players]

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
                current_player = await self._one_player(current_model, user_id)

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

    async def get_globally_tracked_players(self) -> list[Player]:
        """Get all players tracked by at least one user.

        Rows, not `PlayerResponse`: the only callers are the two writer jobs
        and the job test runner, none of which has a current user, so the
        per-user `is_tracked` field on the response has no meaning for them.
        """
        query = (
            select(Player)
            .where(Player.is_tracked_by_anyone.is_(True))
            .order_by(Player.game_name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

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
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        logger.debug("Updating player profile", puuid=player.puuid)

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
        await ensure_riot_writer_maintenance_is_inactive(self.db)
        logger.debug("Updating player league", puuid=player.puuid)

        platform_enum = Platform(player.platform.lower())
        league_entries = await riot_api_client.get_league_entries_by_puuid(
            player.puuid, platform_enum
        )
        if not league_entries:
            logger.debug("No ranked data found for player", puuid=player.puuid)
            return False

        solo_entry = solo_duo_league_entry(league_entries)
        if not solo_entry:
            logger.debug("No Solo/Duo league found for player", puuid=player.puuid)
            return False

        current_league = await self.get_player_league(player.puuid)
        if current_league and league_snapshot_matches(current_league, solo_entry):
            logger.debug(
                "Player league unchanged, skipping insert",
                puuid=player.puuid,
                tier=solo_entry.tier,
            )
            return False

        self.db.add(player_league_from_entry(player.puuid, solo_entry))
        logger.info(
            "Updated player league",
            puuid=player.puuid,
            tier=solo_entry.tier,
            rank=solo_entry.rank,
            lp=solo_entry.league_points,
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
        stmt = (
            select(PlayerLeague)
            .where(PlayerLeague.puuid == puuid)
            .where(PlayerLeague.queue_type == queue_type)
            .order_by(PlayerLeague.created_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
