"""Data transformation utilities for converting between DTOs and database models.

This module provides utility classes for transforming data from Riot API DTOs
to formats suitable for database storage, validation, and processing.
"""

from typing import Any, Dict, List, Optional

import structlog

logger = structlog.get_logger(__name__)


class MatchDTOTransformer:
    """Utility for transforming match DTOs from Riot API."""

    @staticmethod
    def extract_match_ids(match_list_dto: Any) -> List[str]:
        """Extract match IDs from match list DTO.

        Handles different DTO formats from Riot API.

        Args:
            match_list_dto: Match list DTO from Riot API

        Returns:
            List of match ID strings

        Example:
            >>> dto = MatchListDTO(match_ids=['EUN1_123', 'EUN1_456'])
            >>> MatchDTOTransformer.extract_match_ids(dto)
            ['EUN1_123', 'EUN1_456']
        """
        if match_list_dto is None:
            return []

        # Handle DTO with match_ids attribute
        if hasattr(match_list_dto, "match_ids"):
            return list(match_list_dto.match_ids)

        # Handle direct list
        if isinstance(match_list_dto, list):
            return list(match_list_dto)

        # Fallback to empty list
        logger.warning(
            "Unexpected match list DTO format",
            dto_type=type(match_list_dto).__name__,
        )
        return []

    @staticmethod
    def sanitize_participant_names(participant_data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize player name fields by converting empty strings to None.

        The Riot API sometimes returns empty strings for name fields instead of null.
        This normalizes the data for proper database storage.

        Args:
            participant_data: Participant data dictionary

        Returns:
            Sanitized participant data with None instead of empty strings

        Example:
            >>> data = {'game_name': '', 'tag_line': 'EUW'}
            >>> MatchDTOTransformer.sanitize_participant_names(data)
            {'game_name': None, 'tag_line': 'EUW'}
        """
        name_fields = ["game_name", "tag_line"]

        for field in name_fields:
            if field in participant_data:
                if participant_data[field] == "" or participant_data[field] is None:
                    participant_data[field] = None

        return participant_data

    @staticmethod
    def extract_participant_data(participant_dto: Any) -> Dict[str, Any]:
        """Extract participant data from DTO for database storage.

        Args:
            participant_dto: Participant DTO from match data

        Returns:
            Dictionary with participant data ready for database storage
        """
        # Determine remake status (inverted logic)
        is_remake = not getattr(participant_dto, "eligible_for_progression", True)

        data = {
            # Identity
            "participant_id": participant_dto.participant_id,
            "puuid": participant_dto.puuid,
            "game_name": participant_dto.game_name
            or participant_dto.summoner_name
            or None,
            "tag_line": participant_dto.tag_line or None,
            "summoner_id": participant_dto.summoner_id,
            "profile_icon": getattr(
                participant_dto, "profile_icon", 0
            ),  # Fallback if missing
            "summoner_level": participant_dto.summoner_level,
            # Team & Context
            "team_id": participant_dto.team_id,
            "team_position": participant_dto.team_position
            or participant_dto.individual_position,
            # Champion
            "champion_id": participant_dto.champion_id,
            "champion_name": participant_dto.champion_name,
            "champion_level": participant_dto.champion_level,
            "champion_transform": getattr(participant_dto, "champion_transform", 0),
            # Results
            "win": participant_dto.win,
            "remake": is_remake,
            # KDA
            "kills": participant_dto.kills,
            "deaths": participant_dto.deaths,
            "assists": participant_dto.assists,
            "largest_multi_kill": getattr(participant_dto, "largest_multi_kill", 0),
            "largest_killing_spree": getattr(
                participant_dto, "largest_killing_spree", 0
            ),
            "first_blood_kill": getattr(participant_dto, "first_blood_kill", False),
            "first_tower_kill": getattr(participant_dto, "first_tower_kill", False),
            # Damage Dealt
            "total_damage_dealt": participant_dto.total_damage_dealt,
            "total_damage_dealt_to_champions": participant_dto.total_damage_dealt_to_champions,
            "physical_damage_dealt_to_champions": getattr(
                participant_dto, "physical_damage_dealt_to_champions", 0
            ),
            "magic_damage_dealt_to_champions": getattr(
                participant_dto, "magic_damage_dealt_to_champions", 0
            ),
            "true_damage_dealt_to_champions": getattr(
                participant_dto, "true_damage_dealt_to_champions", 0
            ),
            "damage_dealt_to_objectives": getattr(
                participant_dto, "damage_dealt_to_objectives", 0
            ),
            "damage_dealt_to_turrets": getattr(
                participant_dto, "damage_dealt_to_turrets", 0
            ),
            # Damage Taken
            "total_damage_taken": participant_dto.total_damage_taken,
            "physical_damage_taken": getattr(
                participant_dto, "physical_damage_taken", 0
            ),
            "magic_damage_taken": getattr(participant_dto, "magic_damage_taken", 0),
            "true_damage_taken": getattr(participant_dto, "true_damage_taken", 0),
            "damage_self_mitigated": getattr(
                participant_dto, "total_self_mitigated", 0
            ),
            # Support
            "total_self_healing": participant_dto.total_self_healing,
            "total_healing": participant_dto.total_healing,
            "total_shielding": participant_dto.total_shielding,
            # Vision
            "vision_score": int(participant_dto.vision_score or 0),
            "wards_placed": participant_dto.wards_placed,
            "wards_killed": participant_dto.wards_killed,
            "vision_wards_placed": participant_dto.vision_wards_placed,
            "vision_wards_bought": participant_dto.vision_wards_bought,
            # Farming
            "total_minions_killed": participant_dto.total_minions_killed,
            "neutral_minions_killed": participant_dto.neutral_minions_killed,
            "gold_earned": participant_dto.gold_earned,
            "gold_spent": participant_dto.gold_spent,
            # Items
            "item0": participant_dto.item0,
            "item1": participant_dto.item1,
            "item2": participant_dto.item2,
            "item3": participant_dto.item3,
            "item4": participant_dto.item4,
            "item5": participant_dto.item5,
            "trinket": participant_dto.trinket,
            "items_purchased": participant_dto.items_purchased,
            "consumables_purchased": participant_dto.consumables_purchased,
            "role_bound_item": getattr(participant_dto, "role_bound_item", 0),
            # Spells
            "summoner1_id": getattr(participant_dto, "summoner1_id", None),
            "summoner1_casts": getattr(participant_dto, "summoner1_casts", 0),
            "summoner2_id": getattr(participant_dto, "summoner2_id", None),
            "summoner2_casts": getattr(participant_dto, "summoner2_casts", 0),
            # Objectives
            "turret_kills": getattr(participant_dto, "turret_kills", 0),
            "inhibitor_kills": getattr(participant_dto, "inhibitor_kills", 0),
            "objectives_stolen": getattr(participant_dto, "objectives_stolen", 0),
            # Time
            "time_spent_dead": getattr(participant_dto, "time_spent_dead", 0),
            "time_played": getattr(participant_dto, "time_played", 0),
            # JSON Data
            "runes": participant_dto.runes,
            "advanced_stats": participant_dto.advanced_stats,
        }

        # Advanced Stats (Challenges)
        challenges = getattr(participant_dto, "advanced_stats", {}) or {}

        data.update(
            {
                "solo_kills": challenges.get("soloKills", 0),
                "gold_per_minute": challenges.get("goldPerMinute", 0),
                "vision_score_per_minute": challenges.get("visionScorePerMinute", 0),
                "kill_participation": challenges.get("killParticipation", 0),
                "max_kill_deficit": challenges.get("maxKillDeficit", 0),
                "team_damage_percentage": challenges.get("teamDamagePercentage", 0),
                "damage_taken_on_team_percentage": challenges.get(
                    "damageTakenOnTeamPercentage", 0
                ),
                "roam_kills": challenges.get("killsOnOtherLanesEarlyJungleAsLaner", 0),
                "enemy_jungle_monster_kills": challenges.get(
                    "enemyJungleMonsterKills", 0
                ),
                "turret_plates_taken": challenges.get("turretPlatesTaken", 0),
                "ally_saves": challenges.get("saveAllyFromDeath", 0),
                "survived_single_digit_hp_count": challenges.get(
                    "survivedSingleDigitHpCount", 0
                ),
                "skillshots_hit": challenges.get("skillshotsHit", 0),
                "skillshots_dodged": challenges.get("skillshotsDodged", 0),
                "enemy_immobilizations": challenges.get(
                    "enemyChampionImmobilizations", 0
                ),
                "kills_near_enemy_turret": challenges.get("killsNearEnemyTurret", 0),
                "takedowns_first_x_minutes": challenges.get(
                    "takedownsFirstXMinutes", 0
                ),
                "buffs_stolen": challenges.get("buffsStolen", 0),
                "epic_monster_steals": challenges.get("epicMonsterSteals", 0),
                "laning_phase_gold_exp_advantage": challenges.get(
                    "earlyLaningPhaseGoldExpAdvantage", 0
                ),
                "max_cs_advantage": challenges.get("maxCsAdvantageOnLaneOpponent", 0),
            }
        )

        # Safe fallback for game name
        if not data["game_name"]:
            data["game_name"] = "Unknown Player"

        return MatchDTOTransformer.sanitize_participant_names(data)


class PlayerDataSanitizer:
    """Utility for sanitizing player data."""

    @staticmethod
    def ensure_game_name(game_name: Optional[str]) -> str:
        """Ensure game name is never null or empty string.

        Args:
            game_name: Game name from API (may be None or empty)

        Returns:
            Valid game name or fallback value

        Example:
            >>> PlayerDataSanitizer.ensure_game_name(None)
            'Unknown Player'
            >>> PlayerDataSanitizer.ensure_game_name('')
            'Unknown Player'
            >>> PlayerDataSanitizer.ensure_game_name('Player1')
            'Player1'
        """
        if not game_name or game_name.strip() == "":
            return "Unknown Player"
        return game_name

    @staticmethod
    def sanitize_player_fields(player_data: Dict[str, Any]) -> Dict[str, Any]:
        """Sanitize all player data fields.

        Ensures:
        - Empty strings converted to None
        - Game name has fallback value
        - platform is uppercase

        Args:
            player_data: Player data dictionary

        Returns:
            Sanitized player data
        """
        # Convert empty strings to None
        name_fields = ["game_name", "tag_line"]
        for field in name_fields:
            if field in player_data:
                if player_data[field] == "":
                    player_data[field] = None

        # Ensure game name has a value
        if "game_name" in player_data:
            player_data["game_name"] = PlayerDataSanitizer.ensure_game_name(
                player_data.get("game_name")
            )

        # Normalize platform to uppercase
        if "platform" in player_data and player_data["platform"]:
            player_data["platform"] = player_data["platform"].upper()

        return player_data
