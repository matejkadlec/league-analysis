"""Service for playstyle analysis."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import structlog
from sqlalchemy import select, update
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
from app.features.playstyle_analysis.models import AnalysisStatus, PlaystyleAnalysis

logger = structlog.get_logger(__name__)


class TagEngine:
    """Engine for processing match data and generating playstyle tags."""

    def __init__(self, participants: List[MatchParticipant], matches: List[Match]):
        """
        Initialize the tag engine.

        :param participants: List of MatchParticipant objects for the player.
                             Should be sorted by game creation time (descending).
        :param matches: List of Match objects corresponding to participants.
                        Used for game duration, mode, etc.
        """
        self.participants = participants
        self.matches = {m.match_id: m for m in matches}
        self.game_count = len(participants)

    def generate_tags(self) -> Dict[str, Any]:
        """Generate all applicable tags based on configuration."""
        detected_tags = {}

        if self.game_count == 0:
            return {}

        for tag_code, config in TAG_CONFIG.items():
            result = evaluate_tag(
                self.participants,
                self.matches,
                self.game_count,
                tag_code,
                config,
            )
            if result:
                result.setdefault("sentiment", config.get("sentiment", "neutral"))
                result.setdefault(
                    "display_name",
                    config.get("display_name", tag_code.replace("_", " ").title()),
                )
                detected_tags[tag_code] = result

        # Remove main_champion if otp is present (otp is stricter, takes precedence)
        if "otp" in detected_tags and "main_champion" in detected_tags:
            del detected_tags["main_champion"]

        return detected_tags

    def generate_summary_stats(self) -> Dict[str, Any]:
        """Generate summary statistics for the player."""
        return generate_summary_stats(self.participants, self.game_count)


class PlaystyleAnalysisService:
    """Service for managing playstyle analysis."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze_playstyle(
        self, puuid: str, force: bool = False
    ) -> PlaystyleAnalysis:
        """
        Perform playstyle analysis for a player.

        1. Fetch recent match participants.
        2. Run TagEngine.
        3. Save results.
        """
        # 1. Fetch data
        stmt = (
            select(MatchParticipant)
            .where(MatchParticipant.puuid == puuid)
            .order_by(
                MatchParticipant.match_id.desc()
            )  # Crude sort, ideally join Match.game_start_timestamp
            .limit(100)
        )
        # Note: Ideally join with Match to get timestamp sort, but simplified for now
        result = await self.db.execute(stmt)
        participants = list(result.scalars().all())

        if not participants:
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
        self, puuid: str, tags: dict, stats: dict
    ) -> PlaystyleAnalysis:
        """Save or update analysis record."""
        current_time = datetime.now(timezone.utc)

        # Update Player's last_playstyle_analysis
        stmt_player = select(Player).where(Player.puuid == puuid)
        result_player = await self.db.execute(stmt_player)
        player = result_player.scalar_one_or_none()
        if player:
            player.last_playstyle_analysis = current_time
            # Also set fully_analyzed if matches_analyzed condition met?
            # For now, we trust the caller/logic elsewhere or just set playstyle time
            self.db.add(player)

        # Update matches attached to analysis to be fully_analyzed
        # Logic: We just analyzed specific matches. But here we don't have the list of match_ids easily available
        # without passing it or re-querying.
        # Ideally, we should update the matches that were used.
        # The simplest approach is to fetch the latest 100 match IDs for the player (same as used in analysis)
        # and update them.

        # Re-fetch relevant match IDs for this player to update status
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

        # Check existing analysis record
        stmt = select(PlaystyleAnalysis).where(PlaystyleAnalysis.puuid == puuid)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.tags = tags
            existing.summary_stats = stats
            existing.status = AnalysisStatus.COMPLETED
            existing.updated_at = current_time
            self.db.add(existing)
            await self.db.commit()
            await self.db.refresh(existing)
            return existing
        else:
            new_analysis = PlaystyleAnalysis(
                puuid=puuid,
                tags=tags,
                summary_stats=stats,
                status=AnalysisStatus.COMPLETED,
            )
            self.db.add(new_analysis)
            await self.db.commit()
            await self.db.refresh(new_analysis)
            return new_analysis

    async def _save_empty_analysis(self, puuid: str) -> PlaystyleAnalysis:
        return await self._save_analysis(puuid, {}, {"note": "No match data available"})

    async def get_latest_analysis(self, puuid: str) -> Optional[PlaystyleAnalysis]:
        stmt = select(PlaystyleAnalysis).where(PlaystyleAnalysis.puuid == puuid)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
