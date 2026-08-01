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
                # Add metadata from config (but don't overwrite if already set by evaluator)
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
        role_wins = {}  # Track wins per role
        champs = {}
        for p in self.participants:
            role = p.team_position or "UNKNOWN"
            if role != "UNKNOWN":
                roles[role] = roles.get(role, 0) + 1
                if p.win:
                    role_wins[role] = role_wins.get(role, 0) + 1

            champ = p.champion_name
            if champ:
                champs[champ] = champs.get(champ, 0) + 1

        most_played_role = "None"
        main_role_win_rate = 0.0
        if roles:
            most_played_role = max(roles.items(), key=lambda x: x[1])[0]
            role_play_count = roles[most_played_role]
            role_play_rate = role_play_count / self.game_count

            # Only use as main role if > 50% play rate
            if role_play_rate <= 0.5:
                most_played_role = "None"
            else:
                # Calculate win rate for main role
                if role_play_count > 0:
                    main_role_win_rate = (
                        role_wins.get(most_played_role, 0) / role_play_count
                    )

        most_played_champion = "None"
        most_played_champion_win_rate = 0.0

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
        else:
            # No main role (<=50%), use most played champion across all games
            if champs:
                most_played_champion = max(champs.items(), key=lambda x: x[1])[0]

        # Calculate winrate for most played champion (across all games with that champ)
        if most_played_champion != "None":
            champ_games = [
                p for p in self.participants if p.champion_name == most_played_champion
            ]
            if champ_games:
                champ_wins = sum(1 for p in champ_games if p.win)
                most_played_champion_win_rate = champ_wins / len(champ_games)

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
            "main_role_win_rate": main_role_win_rate,
            "avg_kda": float(avg_kda),
            "most_played_champion": most_played_champion,
            "most_played_champion_win_rate": most_played_champion_win_rate,
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
        elif tag_type == "gold_diff_check":
            return self._evaluate_gold_diff_check(tag_code, config)
        elif tag_type == "kill_greed_check":
            return self._evaluate_kill_greed(tag_code, config)
        elif tag_type == "solo_kill_ratio_check":
            return self._evaluate_solo_kill_ratio(tag_code, config)
        elif tag_type == "objective_participation_check":
            return self._evaluate_objective_participation(tag_code, config)

        # 2. Global Tags (One-offs)
        if tag_code == "nolifer":
            return self._evaluate_nolifer(config)
        if tag_code == "otp":
            return self._evaluate_otp(config)
        if tag_code == "main_champion":
            return self._evaluate_main_champion(config)
        if tag_code == "main_role":
            return self._evaluate_main_role(config)

        # 3. Match-Based Threshold Tags (Default)
        # Supports min/max checks with percentage_matches requirement
        return self._evaluate_generic_threshold(tag_code, config)

    def _evaluate_gold_diff_check(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate gold diff vs opponent (lead or deficit).

        Calculates average gold difference across ALL games with lane opponents.
        Shows tag only if that average meets the threshold.
        """
        check_deficit = config.get("check_deficit", False)

        min_threshold = 1000
        if check_deficit:
            min_threshold = config.get("min_lane_gold_deficit", 1000)
        else:
            min_threshold = config.get("min_lane_gold_lead", 1000)

        total_gold_diff = 0
        games_with_opponent = 0

        for p in self.participants:
            # Find opponent
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if not match:
                continue

            # Naive lane opponent finding: Same team_position, different team_id
            opponent = None
            if match.participants and p.team_position and p.team_position != "UNKNOWN":
                for other in match.participants:
                    if (
                        other.team_id != p.team_id
                        and other.team_position == p.team_position
                    ):
                        opponent = other
                        break

            if opponent:
                games_with_opponent += 1
                diff = (p.gold_earned or 0) - (opponent.gold_earned or 0)
                total_gold_diff += diff

        if games_with_opponent == 0:
            return None

        # Calculate average gold difference across ALL games
        avg_gold_diff = total_gold_diff / games_with_opponent

        # Check if average meets threshold
        if check_deficit:
            # For deficit: average should be <= -1000
            if avg_gold_diff <= -min_threshold:
                display_value = abs(avg_gold_diff)
                formatted_value = self._format_value(display_value)
                return {
                    "threshold_met": True,
                    "description": config.get("hover_template", "").format(
                        value=formatted_value
                    ),
                    "value": display_value,
                }
        else:
            # For lead: average should be >= 1000
            if avg_gold_diff >= min_threshold:
                display_value = avg_gold_diff
                formatted_value = self._format_value(display_value)
                return {
                    "threshold_met": True,
                    "description": config.get("hover_template", "").format(
                        value=formatted_value
                    ),
                    "value": display_value,
                }

        return None

    def _evaluate_generic_threshold(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate threshold based on actual average across ALL games.

        For tags with 'min_' or 'max_' thresholds:
        - Calculates aggregate value (average) across ALL games
        - Checks if that average meets the threshold
        - Returns tag if threshold is met

        Special cases:
        - aggressive_laner/passive_laner: Check occurrence percentage (not average)
        - pentakiller/epic_thief: Check total count (occurrence-based)
        """

        # Special handling for occurrence-based tags (not averages)
        if tag_code in ["aggresive_laner", "passive_laner"]:
            return self._evaluate_occurrence_percentage(tag_code, config)

        if tag_code in ["pentakiller", "epic_thief", "thief"]:
            return self._evaluate_occurrence_count(tag_code, config)

        # Calculate aggregate value (average across ALL games)
        aggregate_value = self._calculate_aggregate_value(tag_code, config)

        # Check if aggregate meets min threshold
        for key, threshold in config.items():
            if key.startswith("min_") and key != "min_play_rate":
                if aggregate_value >= threshold:
                    formatted_value = self._format_value(aggregate_value)
                    description = config.get("hover_template", "Met criteria").format(
                        value=formatted_value
                    )
                    return {
                        "threshold_met": True,
                        "description": description,
                        "value": float(aggregate_value),
                    }
                return None

            # Check if aggregate meets max threshold
            elif key.startswith("max_") and key != "max_percentage_matches":
                if aggregate_value <= threshold:
                    formatted_value = self._format_value(aggregate_value)
                    description = config.get("hover_template", "Met criteria").format(
                        value=formatted_value
                    )
                    return {
                        "threshold_met": True,
                        "description": description,
                        "value": float(aggregate_value),
                    }
                return None

        return None

    def _evaluate_occurrence_percentage(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate tags based on occurrence percentage (for aggressive/passive laner)."""
        target_percentage = config.get("percentage_matches", 0.0)
        max_percentage = config.get("max_percentage_matches")

        # Calculate occurrence percentage
        aggregate_value = self._calculate_aggregate_value(tag_code, config)

        if max_percentage is not None:
            if aggregate_value < max_percentage:
                formatted_value = self._format_value(aggregate_value)
                description = config.get("hover_template", "Met criteria").format(
                    value=formatted_value
                )
                return {
                    "threshold_met": True,
                    "description": description,
                    "value": float(aggregate_value),
                }
            return None

        if aggregate_value >= target_percentage:
            formatted_value = self._format_value(aggregate_value)
            description = config.get("hover_template", "Met criteria").format(
                value=formatted_value
            )
            return {
                "threshold_met": True,
                "description": description,
                "value": float(aggregate_value),
            }
        return None

    def _evaluate_occurrence_count(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate tags based on total occurrence count (pentakills, epic steals)."""
        # Get the total count
        aggregate_value = self._calculate_aggregate_value(tag_code, config)

        # These tags just need at least 1 occurrence
        if aggregate_value >= 1:
            formatted_value = self._format_value(aggregate_value)
            description = config.get("hover_template", "Met criteria").format(
                value=formatted_value
            )
            return {
                "threshold_met": True,
                "description": description,
                "value": float(aggregate_value),
            }
        return None

    def _check_match_condition(
        self, p: MatchParticipant, tag_code: str, config: Dict[str, Any]
    ) -> bool:
        """Check if a single match meets the criteria.

        Now supports generic attribute mapping for keys starting with 'min_'.
        """

        # 1. Handle Complex/Calculated logic first (override generic behavior)
        if "min_kda" in config:
            deaths = p.deaths if p.deaths > 0 else 1
            kda = (p.kills + p.assists) / deaths
            if kda < config["min_kda"]:
                return False

        if "min_first_blood_participation" in config:
            if not p.first_blood_kill:
                return False

        if "max_first_blood_participation" in config:
            if p.first_blood_kill:
                return False

        if "min_dead_time_ratio" in config:
            duration = p.time_played if (p.time_played and p.time_played > 0) else 1
            ratio = (p.time_spent_dead or 0) / duration * 100.0
            if ratio < config["min_dead_time_ratio"]:
                return False

        if "min_potions" in config:
            potions = (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
            if potions < config["min_potions"]:
                return False

        if "min_total_minions" in config:
            cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
            if cs < config["min_total_minions"]:
                return False

        if "min_cs" in config:
            duration_min = (p.time_played or 1) / 60.0
            cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
            cspm = cs / duration_min if duration_min > 0 else 0
            if cspm < config["min_cs"]:
                return False

        if "max_cs" in config:
            duration_min = (p.time_played or 1) / 60.0
            cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
            cspm = cs / duration_min if duration_min > 0 else 0
            if cspm > config["max_cs"]:
                return False

        if "min_vision_score_per_minute" in config:
            duration_min = (p.time_played or 1) / 60.0
            vspm = (p.vision_score or 0) / duration_min if duration_min > 0 else 0
            if vspm < config["min_vision_score_per_minute"]:
                return False

        if "min_team_damage_pct" in config:
            # Requires match team totals.
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if match:
                team_participants = [
                    x for x in match.participants if x.team_id == p.team_id
                ]
                total_dmg = sum(
                    (x.total_damage_dealt_to_champions or 0) for x in team_participants
                )
                if total_dmg > 0:
                    pct = (p.total_damage_dealt_to_champions or 0) / total_dmg * 100.0
                    if pct < config["min_team_damage_pct"]:
                        return False

        if "min_team_damage_taken_pct" in config:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if match:
                team_participants = [
                    x for x in match.participants if x.team_id == p.team_id
                ]
                total_taken = sum(
                    (x.total_damage_taken or 0) for x in team_participants
                )
                if total_taken > 0:
                    pct = (p.total_damage_taken or 0) / total_taken * 100.0
                    if pct < config["min_team_damage_taken_pct"]:
                        return False

        if "min_kill_participation" in config:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if match:
                team_participants = [
                    x for x in match.participants if x.team_id == p.team_id
                ]
                total_kills = sum((x.kills or 0) for x in team_participants)
                if total_kills > 0:
                    kp = ((p.kills or 0) + (p.assists or 0)) / total_kills * 100.0
                    if kp < config["min_kill_participation"]:
                        return False

        if "max_team_damage_taken_pct" in config:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if match:
                team_participants = [
                    x for x in match.participants if x.team_id == p.team_id
                ]
                total_taken = sum(
                    (x.total_damage_taken or 0) for x in team_participants
                )
                if total_taken > 0:
                    pct = (p.total_damage_taken or 0) / total_taken * 100.0
                    if pct > config["max_team_damage_taken_pct"]:
                        return False

        if "max_kill_participation" in config:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if match:
                team_participants = [
                    x for x in match.participants if x.team_id == p.team_id
                ]
                total_kills = sum((x.kills or 0) for x in team_participants)
                if total_kills > 0:
                    kp = ((p.kills or 0) + (p.assists or 0)) / total_kills * 100.0
                    if kp > config["max_kill_participation"]:
                        return False

        # 2. Generic Attribute Checks
        # Handles: min_kills, min_deaths, min_assists, min_turret_kills,
        # min_solo_kills, min_gold_per_minute, min_roam_kills, etc.
        for key, value in config.items():
            if key.startswith("min_") and key not in [
                "min_kda",
                "min_first_blood_participation",
                "min_dead_time_ratio",
                "min_potions",
                "min_total_minions",
                "min_cs",
                "min_vision_score_per_minute",
                "min_team_damage_pct",
                "min_team_damage_taken_pct",
                "min_kill_participation",
            ]:
                attr_name = key[4:]  # remove "min_"
                # Check if attribute exists on model
                if hasattr(p, attr_name):
                    attr_val = getattr(p, attr_name) or 0
                    if attr_val < value:
                        return False

        # Handle max_ checks (e.g., max_cs, max_vision_score, max_gold_per_minute)
        for key, value in config.items():
            if key.startswith("max_") and key not in [
                "max_cs",
                "max_team_damage_taken_pct",
                "max_kill_participation",
            ]:
                attr_name = key[4:]  # remove "max_"
                # Check if attribute exists on model
                if hasattr(p, attr_name):
                    attr_val = getattr(p, attr_name) or 0
                    if attr_val > value:
                        return False

        return True

    def _calculate_aggregate_value(
        self, tag_code: str, config: Dict[str, Any]
    ) -> float:
        """Calculate the average value (or specific metric) for the tag to display."""
        game_count = self.game_count if self.game_count > 0 else 1

        # 1. Custom Aggregations
        if tag_code == "aggresive_laner" or tag_code == "passive_laner":
            fb_count = sum(1 for p in self.participants if p.first_blood_kill)
            return (fb_count / game_count) * 100.0

        if "min_dead_time_ratio" in config:
            total_dead = sum(p.time_spent_dead or 0 for p in self.participants)
            total_time = sum(p.time_played or 0 for p in self.participants)
            if total_time == 0:
                return 0.0
            return (total_dead / total_time) * 100.0

        # CS per minute (for good_at_farming, bad_at_farming)
        if "min_cs" in config or "max_cs" in config:
            total_cs = 0
            total_time_min = 0
            for p in self.participants:
                cs = (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
                duration_min = (p.time_played or 1) / 60.0
                total_cs += cs
                total_time_min += duration_min
            return total_cs / total_time_min if total_time_min > 0 else 0.0

        # Total CS per game (for farms_a_lot)
        if "min_total_minions" in config:
            total_cs = sum(
                (p.total_minions_killed or 0) + (p.neutral_minions_killed or 0)
                for p in self.participants
            )
            return total_cs / game_count

        if "min_kda" in config:
            t_k = sum(p.kills for p in self.participants)
            t_d = sum(p.deaths for p in self.participants)
            t_a = sum(p.assists for p in self.participants)
            denom = t_d if t_d > 0 else 1
            return (t_k + t_a) / denom

        if "min_potions" in config:
            total_val = sum(
                (p.consumables_purchased or 0) - (p.vision_wards_bought or 0)
                for p in self.participants
            )
            return total_val / game_count

        # Pentakiller: return total count, not average
        if "min_largest_multi_kill" in config:
            return sum(1 for p in self.participants if (p.largest_multi_kill or 0) >= 5)

        # Epic Thief: return total count
        if "min_epic_monster_steals" in config:
            return sum(p.epic_monster_steals or 0 for p in self.participants)

        # Team damage percentage: avg team damage share
        if "min_team_damage_pct" in config:
            percentages = []
            for p in self.participants:
                match = self.matches.get(str(p.match_id)) or self.matches.get(
                    p.match_id
                )
                if match:
                    team_participants = [
                        x for x in match.participants if x.team_id == p.team_id
                    ]
                    total_dmg = sum(
                        (x.total_damage_dealt_to_champions or 0)
                        for x in team_participants
                    )
                    if total_dmg > 0:
                        pct = (
                            (p.total_damage_dealt_to_champions or 0) / total_dmg * 100.0
                        )
                        percentages.append(pct)
            return sum(percentages) / len(percentages) if percentages else 0.0

        # Team damage taken percentage
        if (
            "min_team_damage_taken_pct" in config
            or "max_team_damage_taken_pct" in config
        ):
            percentages = []
            for p in self.participants:
                match = self.matches.get(str(p.match_id)) or self.matches.get(
                    p.match_id
                )
                if match:
                    team_participants = [
                        x for x in match.participants if x.team_id == p.team_id
                    ]
                    total_taken = sum(
                        (x.total_damage_taken or 0) for x in team_participants
                    )
                    if total_taken > 0:
                        pct = (p.total_damage_taken or 0) / total_taken * 100.0
                        percentages.append(pct)
            return sum(percentages) / len(percentages) if percentages else 0.0

        # Kill participation: average KP
        if "min_kill_participation" in config or "max_kill_participation" in config:
            kps = []
            for p in self.participants:
                match = self.matches.get(str(p.match_id)) or self.matches.get(
                    p.match_id
                )
                if match:
                    team_participants = [
                        x for x in match.participants if x.team_id == p.team_id
                    ]
                    total_kills = sum((x.kills or 0) for x in team_participants)
                    if total_kills > 0:
                        kp = ((p.kills or 0) + (p.assists or 0)) / total_kills * 100.0
                        kps.append(kp)
            return sum(kps) / len(kps) if kps else 0.0

        # 2. Generic Aggregation based on the primary 'min_' or 'max_' key
        main_metric = None
        for key in config:
            if key.startswith("min_") and hasattr(MatchParticipant, key[4:]):
                main_metric = key[4:]
                break
            if key.startswith("max_") and hasattr(MatchParticipant, key[4:]):
                main_metric = key[4:]
                break

        if main_metric:
            total_val = sum(getattr(p, main_metric) or 0 for p in self.participants)
            return total_val / game_count

        # Fallback
        return 0.0

    def _evaluate_damage_type(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        target_percentage = config.get("percentage_matches", 50.0)
        target_type = config.get("target")  # 'physical' or 'magic'

        matching_games = 0
        total_phys_damage = 0
        total_magic_damage = 0
        total_damage = 0

        for p in self.participants:
            phys = p.physical_damage_dealt_to_champions or 0
            magic = p.magic_damage_dealt_to_champions or 0

            total_phys_damage += phys
            total_magic_damage += magic
            total_damage += phys + magic

            if target_type == "physical" and phys > magic:
                matching_games += 1
            elif target_type == "magic" and magic > phys:
                matching_games += 1

        pct = (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0

        if pct >= target_percentage:
            # Calculate damage percentage (what % of all damage is this type)
            if total_damage > 0:
                if target_type == "physical":
                    damage_pct = (total_phys_damage / total_damage) * 100.0
                else:  # magic
                    damage_pct = (total_magic_damage / total_damage) * 100.0
            else:
                damage_pct = 0.0

            formatted_value = self._format_value(damage_pct)
            description = config.get("hover_template", "").format(value=formatted_value)
            return {
                "threshold_met": True,
                "description": description,
                "value": damage_pct,
            }
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

        # Count surrenders (excluding early_surrender/remakes)
        surrender_count = 0
        total_games = 0

        for p in self.participants:
            m = self.matches.get(p.match_id)
            if not m:
                continue

            total_games += 1

            # Count regular surrenders (not early surrenders/remakes)
            if getattr(m, "surrender", False) and not getattr(
                m, "early_surrender", False
            ):
                surrender_count += 1

        if total_games == 0:
            return None

        surrender_rate = (surrender_count / total_games) * 100.0

        if check_type == "never":
            # Low surrender rate (e.g., < 10%)
            if surrender_rate <= 10.0:
                formatted_value = self._format_value(surrender_rate)
                description = config.get("hover_template", "").format(
                    value=formatted_value
                )
                return {
                    "threshold_met": True,
                    "description": description,
                    "value": surrender_rate,
                }

        if check_type == "often":
            # High surrender rate (e.g., >= 30%)
            if surrender_rate >= 30.0:
                formatted_value = self._format_value(surrender_rate)
                description = config.get("hover_template", "").format(
                    value=formatted_value
                )
                return {
                    "threshold_met": True,
                    "description": description,
                    "value": surrender_rate,
                }

        return None

    def _evaluate_kill_greed(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate takes_all_kills: Non-solo kills vs assists ratio (per-match)."""
        target_percentage = config.get("percentage_matches", 40.0)
        min_ratio = config.get("min_kill_assist_ratio", 4.0)

        matching_games = 0
        total_ratio = 0
        valid_games = 0

        for p in self.participants:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if not match:
                continue

            player_kills = p.kills or 0
            player_assists = p.assists or 0
            player_solo_kills = p.solo_kills or 0

            # Non-solo kills = total kills - solo kills
            non_solo_kills = player_kills - player_solo_kills

            # Calculate ratio
            if player_assists == 0:
                # If 0 assists and has at least 3 non-solo kills, flag it
                if non_solo_kills >= 3:
                    matching_games += 1
                    ratio = non_solo_kills  # Just use the count as the ratio
                    total_ratio += ratio
                    valid_games += 1
            else:
                ratio = non_solo_kills / player_assists
                total_ratio += ratio
                valid_games += 1

                if ratio >= min_ratio:
                    matching_games += 1

        pct_matches = (
            (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0
        )

        if pct_matches >= target_percentage:
            avg_ratio = total_ratio / valid_games if valid_games > 0 else 0
            formatted_value = self._format_value(avg_ratio)
            description = config.get("hover_template", "").format(value=formatted_value)
            return {
                "threshold_met": True,
                "description": description,
                "value": avg_ratio,
            }
        return None

    def _evaluate_solo_kill_ratio(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate duelist: Solo kills vs assists ratio (per-match)."""
        target_percentage = config.get("percentage_matches", 30.0)
        min_ratio = config.get("min_solo_kill_assist_ratio", 4.0)

        matching_games = 0
        total_ratio = 0
        valid_games = 0

        for p in self.participants:
            player_solo_kills = p.solo_kills or 0
            player_assists = p.assists or 0

            # Skip games with no solo kills (can't be a duelist without solo kills)
            if player_solo_kills == 0:
                continue

            valid_games += 1

            if player_assists == 0:
                # If they have solo kills but 0 assists, that's infinite ratio - definitely a duelist
                matching_games += 1
                ratio = player_solo_kills * 10  # Use a large ratio value
                total_ratio += ratio
            else:
                ratio = player_solo_kills / player_assists
                total_ratio += ratio

                if ratio >= min_ratio:
                    matching_games += 1

        pct_matches = (
            (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0
        )

        if pct_matches >= target_percentage:
            avg_ratio = total_ratio / valid_games if valid_games > 0 else 0
            formatted_value = self._format_value(avg_ratio)
            description = config.get("hover_template", "").format(value=formatted_value)
            return {
                "threshold_met": True,
                "description": description,
                "value": avg_ratio,
            }
        return None

    def _evaluate_objective_participation(
        self, tag_code: str, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Evaluate ignores_objectives: Player's obj damage < 10% of team (per-match)."""
        target_percentage = config.get("percentage_matches", 40.0)
        max_pct = config.get("max_objective_damage_pct", 10)

        matching_games = 0
        total_pct = 0
        valid_games = 0

        for p in self.participants:
            match = self.matches.get(str(p.match_id)) or self.matches.get(p.match_id)
            if not match:
                continue

            # Get team participants for this match
            team_participants = [
                x for x in match.participants if x.team_id == p.team_id
            ]
            total_team_obj_dmg = sum(
                (x.damage_dealt_to_objectives or 0) for x in team_participants
            )

            # Skip if team did no objective damage
            if total_team_obj_dmg == 0:
                continue

            valid_games += 1
            player_obj_dmg = p.damage_dealt_to_objectives or 0
            pct = (player_obj_dmg / total_team_obj_dmg) * 100.0
            total_pct += pct

            if pct < max_pct:
                matching_games += 1

        pct_matches = (
            (matching_games / self.game_count) * 100.0 if self.game_count > 0 else 0
        )

        if pct_matches >= target_percentage:
            avg_pct = total_pct / valid_games if valid_games > 0 else 0
            formatted_value = self._format_value(avg_pct)
            description = config.get("hover_template", "").format(value=formatted_value)
            return {
                "threshold_met": True,
                "description": description,
                "value": avg_pct,
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

    def _evaluate_main_champion(
        self, config: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        champs = {}
        for p in self.participants:
            champs[p.champion_name] = champs.get(p.champion_name, 0) + 1

        if not champs:
            return None
        top_champ, count = max(champs.items(), key=lambda x: x[1])
        rate = (count / self.game_count) * 100.0

        if rate >= config.get("min_play_rate", 50.0):
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
            # Title case the role (e.g., "MIDDLE" -> "Middle")
            formatted_role = top_role.title()
            description = config.get("hover_template", "").format(
                value=self._format_value(rate), role=formatted_role
            )
            display_name = config.get("display_name", "").format(role=formatted_role)
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
