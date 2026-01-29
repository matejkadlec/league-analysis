"""Service for playstyle analysis."""

from datetime import datetime, timezone
import math
from typing import List, Dict, Any, Optional

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
import structlog

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.playstyle_analysis.models import PlaystyleAnalysis, AnalysisStatus
from app.features.playstyle_analysis.config import TAG_CONFIG
from app.core.models import Base

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
            result = self._evaluate_tag(tag_code, config)
            if result:
                detected_tags[tag_code] = result

        return detected_tags

    def generate_summary_stats(self) -> Dict[str, Any]:
        """Generate summary statistics for the player."""
        if self.game_count == 0:
            return {}

        wins = sum(1 for p in self.participants if p.win)

        # Calculate Average KDA
        total_kills = sum(p.kills for p in self.participants)
        total_deaths = sum(p.deaths for p in self.participants)
        total_assists = sum(p.assists for p in self.participants)

        # Avoid division by zero
        avg_kda = (
            (total_kills + total_assists) / total_deaths
            if total_deaths > 0
            else (total_kills + total_assists)
        )

        # Lane stats
        roles = {}
        for p in self.participants:
            role = p.team_position or "UNKNOWN"
            roles[role] = roles.get(role, 0) + 1

        most_played_role = (
            max(roles.items(), key=lambda x: x[1])[0] if roles else "UNKNOWN"
        )

        return {
            "total_games": self.game_count,
            "win_rate": float(wins) / float(self.game_count),  # Return decimal (0-1)
            "most_played_role": most_played_role,
            "avg_kda": float(avg_kda),
        }

    def _evaluate_tag(
        self, tag_code: str, config: Dict[str, float]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate a single tag configuration."""

        # 1. Match-Based Threshold Tags (e.g. Slayer, Splitpusher)
        # Check if config has "percentage_matches" and some metric threshold
        if "percentage_matches" in config:
            return self._evaluate_match_threshold_tag(tag_code, config)

        # 2. Global Tags (e.g. OTP, NoLifer)
        # These require specific custom logic usually
        return self._evaluate_global_tag(tag_code, config)

    def _evaluate_match_threshold_tag(
        self, tag_code: str, config: Dict[str, float]
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluate tags that require X metric in Y% of matches.

        Supports:
        - min_kills, min_deaths, min_assists
        - min_turret_kills, min_first_blood_rate (bool check)
        - min_kda
        - min_dead_time_ratio
        """
        matching_games = 0

        target_percentage = config["percentage_matches"]

        for p in self.participants:
            match_passes = False

            # Kills
            if "min_kills" in config and p.kills >= config["min_kills"]:
                match_passes = True

            # Deaths
            elif "min_deaths" in config and p.deaths >= config["min_deaths"]:
                match_passes = True

            # Assists
            elif "min_assists" in config and p.assists >= config["min_assists"]:
                match_passes = True

            # Turrets
            elif (
                "min_turret_kills" in config
                and (p.turret_kills or 0) >= config["min_turret_kills"]
            ):
                match_passes = True

            # First Blood (Rate is checked as boolean presence here)
            elif "min_first_blood_rate" in config and p.first_blood_kill:
                match_passes = True

            elif "max_first_blood_rate" in config:
                # Passive laner logic: Condition "Got FB in <= 5% games".
                # My generic loop counts matches where condition is TRUE.
                # Here condition should reflect POSITIVE MATCH ("Passive Game").
                # So a "Passive Game" is one where NOT First Blood? No..
                # Wait, "Passive Laner" tag logic: "first_blood_kill=false in more than X% matches".
                # User config says: "max_first_blood_rate": 5.0.
                # This implies global rate check, not per-match count check unless I verify logic.
                # Let's pivot: Count matches with FB. If (count/total)*100 <= max_rate, then award tag.
                # But _evaluate_match_threshold_tag logic is "Count > Threshold".
                # I'll handle Passive Laner explicitly in global logic or hack it here?
                # I'll skip it in this generic handler if key is "max_..." and move to global logic or specialized logic.
                pass

            # KDA
            elif "min_kda" in config:
                deaths = p.deaths if p.deaths > 0 else 1
                kda = (p.kills + p.assists) / deaths
                if kda >= config["min_kda"]:
                    match_passes = True

            # Dead Time
            elif "min_dead_time_ratio" in config:
                # User requested time_spent_dead / time_played
                duration = p.time_played if (p.time_played and p.time_played > 0) else 1
                dead_ratio = (p.time_spent_dead or 0) / duration * 100.0
                if dead_ratio >= config["min_dead_time_ratio"]:
                    match_passes = True

            # Potions
            elif "min_potions" in config:
                potions = (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
                if potions >= config["min_potions"]:
                    match_passes = True

            # Wards
            elif "min_wards_placed" in config:
                if (p.wards_placed or 0) >= config["min_wards_placed"]:
                    match_passes = True

            # Pentakills
            elif "min_pentakills" in config:
                if (p.largest_multi_kill or 0) >= 5:
                    match_passes = True

            # Damage Type (Warrior/Wizard)
            elif tag_code == "warrior":
                phys = p.physical_damage_dealt_to_champions or 0
                magic = p.magic_damage_dealt_to_champions or 0
                if phys > magic:
                    match_passes = True

            elif tag_code == "wizard":
                phys = p.physical_damage_dealt_to_champions or 0
                magic = p.magic_damage_dealt_to_champions or 0
                if magic > phys:
                    match_passes = True

            if match_passes:
                matching_games += 1

        pct = (matching_games / self.game_count) * 100.0

        # Inverted logic for 'passive_laner' if simpler?
        # Actually for 'passive_laner' with 'max_first_blood_rate':
        # If we count matches WITH FB, we want pct <= max.
        if "max_first_blood_rate" in config:
            # Counted FB games.
            # Check if Rate <= Max
            matching_games_fb = 0
            for p in self.participants:
                if p.first_blood_kill:
                    matching_games_fb += 1
            fb_rate = (matching_games_fb / self.game_count) * 100.0
            if fb_rate <= config["max_first_blood_rate"]:
                return {
                    "value": fb_rate,
                    "threshold_met": True,
                    "description": f"First Blood in only {fb_rate:.1f}% of games",
                }
            return None

        if pct >= target_percentage:
            return {
                "value": pct,
                "threshold_met": True,
                "description": f"Met criteria in {int(pct)}% of games",
            }

        return None

    def _evaluate_global_tag(
        self, tag_code: str, config: Dict[str, float]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate global tags like Side Preference, OTP, etc."""

        if tag_code in ["prefers_blue_side", "prefers_red_side"]:
            blue_wins = 0
            blue_games = 0
            red_wins = 0
            red_games = 0

            for p in self.participants:
                if p.team_id == 100:
                    blue_games += 1
                    if p.win:
                        blue_wins += 1
                elif p.team_id == 200:
                    red_games += 1
                    if p.win:
                        red_wins += 1

            if blue_games == 0 or red_games == 0:
                return None

            blue_wr = (blue_wins / blue_games) * 100.0
            red_wr = (red_wins / red_games) * 100.0

            diff = config.get("winrate_diff_threshold", 5.0)

            if tag_code == "prefers_blue_side" and (blue_wr - red_wr) >= diff:
                return {
                    "value": blue_wr - red_wr,
                    "threshold_met": True,
                    "details": f"Blue WR: {blue_wr:.1f}%, Red WR: {red_wr:.1f}%",
                    "description": "Wins significantly more on Blue Side",
                }

            if tag_code == "prefers_red_side" and (red_wr - blue_wr) >= diff:
                return {
                    "value": red_wr - blue_wr,
                    "threshold_met": True,
                    "details": f"Red WR: {red_wr:.1f}%, Blue WR: {blue_wr:.1f}%",
                    "description": "Wins significantly more on Red Side",
                }

        if tag_code == "nolifer":
            if not self.participants:
                return None
            level = self.participants[0].summoner_level or 0
            if level >= config.get("min_summoner_level", 400.0):
                return {
                    "value": level,
                    "threshold_met": True,
                    "description": f"High summoner level: {level}",
                }

        if tag_code == "otp":
            # Count MOST played champion freq
            # But 'otp' check implies ONE specific champ > 70?
            champs = {}
            for p in self.participants:
                champs[p.champion_name] = champs.get(p.champion_name, 0) + 1

            if not champs:
                return None

            top_champ, count = max(champs.items(), key=lambda x: x[1])
            rate = (count / self.game_count) * 100.0

            if rate >= config.get("min_play_rate", 70.0):
                return {
                    "value": rate,
                    "threshold_met": True,
                    "details": top_champ,
                    "description": f"One-Trick Pony: {top_champ} ({rate:.1f}%)",
                }

        if tag_code == "main_role":
            roles = {}
            for p in self.participants:
                r = p.team_position
                if r:
                    roles[r] = roles.get(r, 0) + 1
            if not roles:
                return None
            top_role, count = max(roles.items(), key=lambda x: x[1])
            rate = (count / self.game_count) * 100.0
            if rate >= config.get("min_role_rate", 50.0):
                return {
                    "value": rate,
                    "threshold_met": True,
                    "details": top_role,
                    "description": f"Main Role: {top_role} ({rate:.1f}%)",
                }

        return None


class PlaystyleAnalysisService:
    """Service for managing playstyle analysis."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def analyze_player(
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

        # Fetch Matches for context
        match_ids = [p.match_id for p in participants]
        stmt_matches = select(Match).where(Match.match_id.in_(match_ids))
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
        # Check existing
        stmt = select(PlaystyleAnalysis).where(PlaystyleAnalysis.puuid == puuid)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.tags = tags
            existing.summary_stats = stats
            existing.status = AnalysisStatus.COMPLETED
            existing.updated_at = datetime.now(timezone.utc)
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
