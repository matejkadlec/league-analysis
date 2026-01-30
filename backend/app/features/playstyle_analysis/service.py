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
from app.features.players.models import Player
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

    def _format_value(self, value: float) -> str:
        """Format value for display with smart rounding and thousands separators."""
        if value >= 1000:
            return f"{int(value):,}"

        if isinstance(value, int):
            return str(value)

        # Round to 1 decimal place first
        formatted = f"{value:.1f}"
        if formatted.endswith(".0"):
            return formatted[:-2]
        return formatted

    def generate_tags(self) -> Dict[str, Any]:
        """Generate all applicable tags based on configuration."""
        detected_tags = {}

        if self.game_count == 0:
            return {}

        for tag_code, config in TAG_CONFIG.items():
            result = self._evaluate_tag(tag_code, config)
            if result:
                # Add metadata from config
                result["sentiment"] = config.get("sentiment", "neutral")
                result["display_name"] = config.get(
                    "display_name", tag_code.replace("_", " ").title()
                )
                detected_tags[tag_code] = result

        return detected_tags

    def generate_summary_stats(self) -> Dict[str, Any]:
        """Generate summary statistics for the player."""
        if self.game_count == 0:
            return {}

        wins = sum(1 for p in self.participants if p.win)
        losses = self.game_count - wins

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

        # Average stats (kills, deaths, assists)
        avg_kills = total_kills / self.game_count
        avg_deaths = total_deaths / self.game_count
        avg_assists = total_assists / self.game_count

        # Recent 10 games analysis
        recent_participants = self.participants[:10]
        recent_total = len(recent_participants)
        recent_win_rate = 0.0
        if recent_total > 0:
            recent_wins = sum(1 for p in recent_participants if p.win)
            recent_win_rate = recent_wins / recent_total

        # Lane stats
        roles = {}
        champs = {}
        for p in self.participants:
            role = p.team_position or "UNKNOWN"
            if role != "UNKNOWN":
                roles[role] = roles.get(role, 0) + 1

            champ = p.champion_name
            if champ:
                champs[champ] = champs.get(champ, 0) + 1

        most_played_role = "None"
        if roles:
            most_played_role = max(roles.items(), key=lambda x: x[1])[0]

        most_played_champion = "None"
        if most_played_role != "None" and most_played_role != "UNKNOWN":
            # Filter champs for only the main role
            role_champs = {}
            for p in self.participants:
                if p.team_position == most_played_role and p.champion_name:
                    role_champs[p.champion_name] = (
                        role_champs.get(p.champion_name, 0) + 1
                    )

            if role_champs:
                most_played_champion = max(role_champs.items(), key=lambda x: x[1])[0]

        return {
            "total_games": self.game_count,
            "total_wins": wins,
            "total_losses": losses,
            "win_rate": float(wins) / float(self.game_count),  # Return decimal (0-1)
            "recent_win_rate": recent_win_rate,
            "avg_kills": avg_kills,
            "avg_deaths": avg_deaths,
            "avg_assists": avg_assists,
            "main_role": most_played_role,
            "avg_kda": float(avg_kda),
            "most_played_champion": most_played_champion,
        }

    def _evaluate_tag(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate a single tag configuration."""

        # 1. Specialized Checks based on "type"
        tag_type = config.get("type")
        if tag_type == "damage_type":
            return self._evaluate_damage_type(tag_code, config)
        elif tag_type == "side_preference":
            return self._evaluate_side_preference(tag_code, config)
        elif tag_type == "surrender_check":
            return self._evaluate_surrender(tag_code, config)

        # 2. Global Tags (One-offs)
        if tag_code == "nolifer":
            return self._evaluate_nolifer(config)
        if tag_code == "otp":
            return self._evaluate_otp(config)
        if tag_code == "main_role":
            return self._evaluate_main_role(config)

        # 3. Match-Based Threshold Tags (Default)
        # Supports min/max checks with percentage_matches requirement
        return self._evaluate_generic_threshold(tag_code, config)

    def _evaluate_generic_threshold(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        target_percentage = config.get("percentage_matches", 0.0)
        matching_games = 0

        # Determine aggregate value (average per game usually)
        aggregate_value = self._calculate_aggregate_value(tag_code, config)

        for p in self.participants:
            if self._check_match_condition(p, tag_code, config):
                matching_games += 1

        pct_matches = (
            (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0
        )

        # Special casing for passive_laner (max check logic) or things requiring 'less than'
        # Currently `_check_match_condition` handles the boolean yes/no per match.
        # For Passive Laner we check "first_blood_kill=false" in more than X% matches.

        if pct_matches >= target_percentage:
            formatted_value = self._format_value(aggregate_value)
            description = config.get("hover_template", "Met criteria").format(
                value=formatted_value
            )
            return {
                "threshold_met": True,
                "description": description,
                "value": aggregate_value,  # Return the avg value for display usage context if needed
            }

        return None

    def _check_match_condition(
        self, p: MatchParticipant, tag_code: str, config: Dict[str, Any]
    ) -> bool:
        """Check if a single match meets the criteria."""

        # Boolean / Count Checks
        if "min_kills" in config:
            return p.kills >= config["min_kills"]
        if "min_deaths" in config:
            return p.deaths >= config["min_deaths"]
        if "min_assists" in config:
            return p.assists >= config["min_assists"]
        if "min_kda" in config:
            deaths = p.deaths if p.deaths > 0 else 1
            kda = (p.kills + p.assists) / deaths
            return kda >= config["min_kda"]

        if "min_turret_kills" in config:
            return (p.turret_kills or 0) >= config["min_turret_kills"]

        if "min_first_blood_participation" in config:
            # Check if player got FB kill.
            # (If model supported assist, we would check that too)
            return p.first_blood_kill is True

        if "max_first_blood_participation" in config:
            # Logic: "Passive Laner" -> FB == False
            return not p.first_blood_kill

        if "min_dead_time_ratio" in config:
            duration = p.time_played if (p.time_played and p.time_played > 0) else 1
            ratio = (p.time_spent_dead or 0) / duration * 100.0
            return ratio >= config["min_dead_time_ratio"]

        if "min_potions" in config:
            potions = (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
            return potions >= config["min_potions"]

        if "min_wards_placed" in config:
            return (p.wards_placed or 0) >= config["min_wards_placed"]

        if "min_pentakills" in config:
            return (p.largest_multi_kill or 0) >= 5

        if "min_healing" in config:
            return (p.total_healing or 0) >= config["min_healing"]

        if "min_vision_score" in config:
            return (p.vision_score or 0) >= config["min_vision_score"]

        if "min_damage_champions" in config:
            return (p.total_damage_dealt_to_champions or 0) >= config[
                "min_damage_champions"
            ]

        if "min_total_minions" in config:
            # Using total_minions_killed + neutral_minions_killed
            cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
            return cs >= config["min_total_minions"]

        if "min_wards_killed" in config:
            return (p.wards_killed or 0) >= config["min_wards_killed"]

        if "min_objectives_stolen" in config:
            return (p.objectives_stolen or 0) >= config["min_objectives_stolen"]

        return False

    def _calculate_aggregate_value(
        self, tag_code: str, config: Dict[str, Any]
    ) -> float:
        """Calculate the average value (or specific metric) for the tag to display."""
        # This is what goes into {value} in hover text

        game_count = self.game_count if self.game_count > 0 else 1

        if tag_code == "aggresive_laner":
            # For these, value is % of games with condition met
            fb_count = sum(1 for p in self.participants if p.first_blood_kill)
            return (fb_count / game_count) * 100.0

        if tag_code == "passive_laner":
            # Value is % of games WITHOUT first blood
            no_fb_count = sum(1 for p in self.participants if not p.first_blood_kill)
            return (no_fb_count / game_count) * 100.0

        if "min_dead_time_ratio" in config:
            # Global ratio: Total dead time / Total time
            total_dead = sum(p.time_spent_dead or 0 for p in self.participants)
            total_time = sum(p.time_played or 0 for p in self.participants)
            if total_time == 0:
                return 0.0
            return (total_dead / total_time) * 100.0

        # Sum-able metrics (return Average)
        total_val = 0.0

        if "min_kills" in config or tag_code == "slayer":
            total_val = sum(p.kills for p in self.participants)
        elif "min_deaths" in config or tag_code == "corpse":
            total_val = sum(p.deaths for p in self.participants)
            if self.game_count > 0:
                return total_val / self.game_count
            return 0.0
        elif "min_assists" in config or tag_code == "assisting":
            total_val = sum(p.assists for p in self.participants)
        elif "min_turret_kills" in config or tag_code == "splitpusher":
            total_val = sum(p.turret_kills or 0 for p in self.participants)
        elif "min_kda" in config or tag_code == "kda_player":
            # Avg KDA
            kills = sum(p.kills for p in self.participants)
            assists = sum(p.assists for p in self.participants)
            deaths = sum(p.deaths for p in self.participants)
            return (kills + assists) / deaths if deaths > 0 else (kills + assists)
        elif "min_potions" in config:
            total_val = sum(
                (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
                for p in self.participants
            )
        elif "min_wards_placed" in config:
            total_val = sum(p.wards_placed or 0 for p in self.participants)
        elif "min_pentakills" in config:
            total_val = sum(
                1 for p in self.participants if (p.largest_multi_kill or 0) == 5
            )
        elif "min_healing" in config:
            total_val = sum(p.total_healing or 0 for p in self.participants)
        elif "min_vision_score" in config:
            total_val = sum(p.vision_score or 0 for p in self.participants)
        elif "min_damage_champions" in config:
            total_val = sum(
                p.total_damage_dealt_to_champions or 0 for p in self.participants
            )
        elif "min_total_minions" in config:
            total_val = sum(
                (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
                for p in self.participants
            )
        elif "min_wards_killed" in config:
            total_val = sum(p.wards_killed or 0 for p in self.participants)
        elif "min_objectives_stolen" in config:
            total_val = sum(p.objectives_stolen or 0 for p in self.participants)

        return total_val / game_count

    def _evaluate_damage_type(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        target_percentage = config.get("percentage_matches", 50.0)
        target_type = config.get("target")  # 'physical' or 'magic'

        matching_games = 0
        for p in self.participants:
            phys = p.physical_damage_dealt_to_champions or 0
            magic = p.magic_damage_dealt_to_champions or 0
            if target_type == "physical" and phys > magic:
                matching_games += 1
            elif target_type == "magic" and magic > phys:
                matching_games += 1

        pct = (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0

        if pct >= target_percentage:
            formatted_value = self._format_value(pct)
            description = config.get("hover_template", "").format(value=formatted_value)
            return {"threshold_met": True, "description": description, "value": pct}
        return None

    def _evaluate_side_preference(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        target_team = config.get("target")  # 100 or 200

        blue_stats = {"wins": 0, "games": 0}
        red_stats = {"wins": 0, "games": 0}

        for p in self.participants:
            if p.team_id == 100:
                blue_stats["games"] += 1
                if p.win:
                    blue_stats["wins"] += 1
            elif p.team_id == 200:
                red_stats["games"] += 1
                if p.win:
                    red_stats["wins"] += 1

        if blue_stats["games"] == 0 or red_stats["games"] == 0:
            return None  # Need data for both to compare preference

        blue_wr = (blue_stats["wins"] / blue_stats["games"]) * 100.0
        red_wr = (red_stats["wins"] / red_stats["games"]) * 100.0

        diff = 5.0  # Min diff

        is_blue_favored = (blue_wr - red_wr) >= diff
        is_red_favored = (red_wr - blue_wr) >= diff

        result_wr = 0.0
        if target_team == 100 and is_blue_favored:
            result_wr = blue_wr
        elif target_team == 200 and is_red_favored:
            result_wr = red_wr
        else:
            return None

        formatted_value = self._format_value(result_wr)
        description = config.get("hover_template", "").format(value=formatted_value)
        return {"threshold_met": True, "description": description, "value": result_wr}

    def _evaluate_surrender(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        check_type = config.get("check")  # 'often' or 'never'

        # Count surrenders
        surrender_count = 0
        early_surrender_count = 0
        losses = 0

        for p in self.participants:
            if not p.win:
                losses += 1
                m = self.matches.get(p.match_id)
                if not m:
                    continue

                # Check match data for surrender flags
                if getattr(m, "surrender", False):
                    surrender_count += 1
                if getattr(m, "early_surrender", False):
                    early_surrender_count += 1

        if losses == 0:
            return None

        if check_type == "never":
            # Condition: Lost games > 5 AND Surrender == 0
            if losses >= 5 and surrender_count == 0:
                description = config.get("hover_template", "")
                return {"threshold_met": True, "description": description, "value": 0}

        if check_type == "early":
            rate = (early_surrender_count / losses) * 100.0
            if rate >= config.get("min_early_surrender_rate", 20.0):
                description = config.get("hover_template", "").format(
                    value=self._format_value(rate)
                )
                return {
                    "threshold_met": True,
                    "description": description,
                    "value": rate,
                }

        return None

    def _evaluate_nolifer(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.participants:
            return None
        # Summoner level is usually on participant but static per player at time of match. Best estimate is latest match.
        level = self.participants[0].summoner_level or 0
        if level >= config.get("min_summoner_level", 500):
            description = config.get("hover_template", "").format(value=level)
            return {"threshold_met": True, "description": description, "value": level}
        return None

    def _evaluate_otp(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        champs = {}
        for p in self.participants:
            champs[p.champion_name] = champs.get(p.champion_name, 0) + 1

        if not champs:
            return None
        top_champ, count = max(champs.items(), key=lambda x: x[1])
        rate = (count / self.game_count) * 100.0

        if rate >= config.get("min_play_rate", 70.0):
            description = config.get("hover_template", "").format(
                value=self._format_value(rate), champion=top_champ
            )
            # Adjust display name dynamically
            display_name = config.get("display_name", "").format(champion=top_champ)

            return {
                "threshold_met": True,
                "description": description,
                "value": rate,
                "display_name": display_name,
            }
        return None

    def _evaluate_main_role(self, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        roles = {}
        for p in self.participants:
            r = p.team_position
            if r and r != "UNKNOWN":
                roles[r] = roles.get(r, 0) + 1

        if not roles:
            return None
        top_role, count = max(roles.items(), key=lambda x: x[1])
        rate = (count / self.game_count) * 100.0

        if rate >= config.get("min_play_rate", 50.0):
            description = config.get("hover_template", "").format(
                value=self._format_value(rate), role=top_role
            )
            display_name = config.get("display_name", "").format(role=top_role)
            return {
                "threshold_met": True,
                "description": description,
                "value": rate,
                "display_name": display_name,
            }
        return None


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
        current_time = datetime.now(timezone.utc)

        # Update Player's last_playstyle_analysis
        stmt_player = select(Player).where(Player.puuid == puuid)
        result_player = await self.db.execute(stmt_player)
        player = result_player.scalar_one_or_none()
        if player:
            player.last_playstyle_analysis = current_time
            self.db.add(player)

        # Check existing
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
