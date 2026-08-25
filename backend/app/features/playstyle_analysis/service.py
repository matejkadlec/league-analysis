"""Service for playstyle analysis."""

from datetime import UTC, datetime

import structlog
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.players.models import Player
from app.features.playstyle_analysis.config import TAG_CONFIG
from app.features.playstyle_analysis.evaluators import (
    evaluate_tag,
    generate_summary_stats,
)
from app.features.playstyle_analysis.models import (
    AnalysisStatus,
    DetectedTag,
    PlaystyleAnalysis,
    SummaryStats,
)

logger = structlog.get_logger(__name__)


class TagEngine:
    """Engine for processing match data and generating playstyle tags."""

    def __init__(self, participants: list[MatchParticipant], matches: list[Match]):
        """Initialize the tag engine.

        :param participants: The player's participants, newest game first.
        :param matches: The Match rows those participants belong to.
        """
        self.participants = participants
        self.matches = {m.match_id: m for m in matches}
        self.game_count = len(participants)

    def generate_tags(self) -> dict[str, DetectedTag]:
        """Generate all applicable tags based on configuration."""
        detected_tags: dict[str, DetectedTag] = {}

        for tag_code, config in TAG_CONFIG.items():
            result = evaluate_tag(
                self.participants,
                self.matches,
                self.game_count,
                tag_code,
                config,
            )
            if result:
                # Two evaluators name the champion or role they matched; every
                # other tag is named by its config, and no evaluator ever set
                # a sentiment, which is why these used to be `setdefault`.
                detected_tags[tag_code] = DetectedTag(
                    threshold_met=result["threshold_met"],
                    description=result["description"],
                    value=result["value"],
                    sentiment=config["sentiment"],
                    display_name=result.get("display_name", config["display_name"]),
                )

        # Remove main_champion if otp is present (otp is stricter, takes precedence)
        if "otp" in detected_tags and "main_champion" in detected_tags:
            del detected_tags["main_champion"]

        return detected_tags

    def generate_summary_stats(self) -> SummaryStats:
        """Generate summary statistics for the player."""
        return generate_summary_stats(self.participants, self.game_count)


class PlaystyleAnalysisService:
    """Service for managing playstyle analysis."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze_playstyle(
        self, puuid: str, force: bool = False
    ) -> PlaystyleAnalysis:
        """Perform playstyle analysis for a player."""
        # 1. Fetch data
        stmt = (
            select(MatchParticipant)
            .join(Match, MatchParticipant.match_id == Match.match_id)
            .where(MatchParticipant.puuid == puuid)
            .order_by(Match.game_start_timestamp.desc())
            .limit(100)
        )
        result = await self.db.execute(stmt)
        participants = list(result.scalars().all())

        if not participants:
            logger.info("playstyle_analysis_no_match_data", puuid=puuid)
            # Handle no data
            return await self._save_empty_analysis(puuid)

        # Fetch Matches for context - eagerly load participants to avoid lazy load issues
        match_ids = [p.match_id for p in participants]
        stmt_matches = (
            select(Match)
            .where(Match.match_id.in_(match_ids))
            .options(selectinload(Match.participants))
        )
        result_matches = await self.db.execute(stmt_matches)
        matches = list(result_matches.scalars().all())

        # 2. Run Engine
        engine = TagEngine(participants, matches)
        tags = engine.generate_tags()
        stats = engine.generate_summary_stats()

        # 3. Save
        return await self._save_analysis(puuid, tags, stats)

    async def _save_analysis(
        self,
        puuid: str,
        tags: dict[str, DetectedTag],
        stats: SummaryStats | None,
    ) -> PlaystyleAnalysis:
        """Save or update analysis record."""
        current_time = datetime.now(UTC)

        # Update Player's last_playstyle_analysis
        stmt_player = select(Player).where(Player.puuid == puuid)
        result_player = await self.db.execute(stmt_player)
        player = result_player.scalar_one_or_none()
        if player:
            player.last_playstyle_analysis = current_time
            # Only the analysis timestamp is a player column; `fully_analyzed`
            # belongs to `Match` and is set for this player's matches below.
            self.db.add(player)
        else:
            logger.warning("playstyle_analysis_player_row_missing", puuid=puuid)

        # Marks the player's newest 100 matches analysed. Ordering by match ID
        # rather than `game_start_timestamp` can mark a boundary match the
        # analysis never read, and `fully_analyzed` stops a Riot re-fetch.
        subquery = (
            select(MatchParticipant.match_id)
            .where(MatchParticipant.puuid == puuid)
            .order_by(MatchParticipant.match_id.desc())
            .limit(100)
        )
        stmt_update_matches = (
            update(Match)
            .where(Match.match_id.in_(subquery))
            .values(fully_analyzed=True)
        )
        await self.db.execute(stmt_update_matches)

        # One statement rather than select-then-insert: two concurrent first
        # analyses would both miss the select and both insert, which the unique
        # `ix_playstyle_analyses_puuid` rejects outright.
        insert_analysis = pg_insert(PlaystyleAnalysis).values(
            puuid=puuid,
            tags=tags,
            summary_stats=stats,
            status=AnalysisStatus.COMPLETED,
        )
        upsert_analysis = insert_analysis.on_conflict_do_update(
            index_elements=[PlaystyleAnalysis.puuid],
            set_={
                "tags": insert_analysis.excluded.tags,
                "summary_stats": insert_analysis.excluded.summary_stats,
                "status": insert_analysis.excluded.status,
                # `onupdate` does not fire for a Core-level upsert, so the
                # timestamp is set here exactly as the update path used to.
                "updated_at": current_time,
            },
        ).returning(PlaystyleAnalysis)
        saved_analysis = (await self.db.execute(upsert_analysis)).scalar_one()
        await self.db.commit()
        return saved_analysis

    async def _save_empty_analysis(self, puuid: str) -> PlaystyleAnalysis:
        """No matches means no statistics -- the column says so with NULL.

        It used to store `{"note": "No match data available"}`, a second shape
        in the same column that no reader distinguished from real statistics.
        """
        return await self._save_analysis(puuid, {}, None)

    async def get_latest_analysis(self, puuid: str) -> PlaystyleAnalysis | None:
        stmt = select(PlaystyleAnalysis).where(PlaystyleAnalysis.puuid == puuid)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
