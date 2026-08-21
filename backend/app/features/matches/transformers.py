"""Data transformation utilities for converting between DTOs and database models.

This module provides utility classes for transforming data from Riot API DTOs
to formats suitable for database storage, validation, and processing.
"""

from typing import Any

import structlog

from app.core.riot_api.models import ParticipantDTO

logger = structlog.get_logger(__name__)


class MatchDTOTransformer:
    """Utility for transforming match DTOs from Riot API."""

    @staticmethod
    def sanitize_participant_names(participant_data: dict[str, Any]) -> dict[str, Any]:
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
            if field in participant_data and (
                participant_data[field] == "" or participant_data[field] is None
            ):
                participant_data[field] = None

        return participant_data

    @staticmethod
    def extract_participant_data(participant_dto: ParticipantDTO) -> dict[str, Any]:
        """Extract participant data from DTO for database storage.

        Args:
            participant_dto: Participant DTO from match data

        Returns:
            Dictionary with participant data ready for database storage
        """
        data: dict[str, Any] = {
            # Identity
            "participant_id": participant_dto.participant_id,
            "puuid": participant_dto.puuid,
            "game_name": participant_dto.game_name
            or participant_dto.summoner_name
            or None,
            "tag_line": participant_dto.tag_line or None,
            "summoner_id": participant_dto.summoner_id,
            "profile_icon": participant_dto.profile_icon,
            "summoner_level": participant_dto.summoner_level,
            # Team & Context
            "team_id": participant_dto.team_id,
            "team_position": participant_dto.team_position
            or participant_dto.individual_position,
            # Champion
            "champion_id": participant_dto.champion_id,
            "champion_name": participant_dto.champion_name,
            "champion_level": participant_dto.champion_level,
            "champion_transform": participant_dto.champion_transform,
            # Results
            "win": participant_dto.win,
            "remake": participant_dto.remake,
            # KDA
            "kills": participant_dto.kills,
            "deaths": participant_dto.deaths,
            "assists": participant_dto.assists,
            "largest_multi_kill": participant_dto.largest_multi_kill,
            "largest_killing_spree": participant_dto.largest_killing_spree,
            "first_blood_kill": participant_dto.first_blood_kill,
            "first_tower_kill": participant_dto.first_tower_kill,
            # Damage Dealt
            "total_damage_dealt": participant_dto.total_damage_dealt,
            "total_damage_dealt_to_champions": participant_dto.total_damage_dealt_to_champions,
            "physical_damage_dealt_to_champions": participant_dto.physical_damage_dealt_to_champions,
            "magic_damage_dealt_to_champions": participant_dto.magic_damage_dealt_to_champions,
            "true_damage_dealt_to_champions": participant_dto.true_damage_dealt_to_champions,
            "damage_dealt_to_objectives": participant_dto.damage_dealt_to_objectives,
            "damage_dealt_to_turrets": participant_dto.damage_dealt_to_turrets,
            # Damage Taken
            "total_damage_taken": participant_dto.total_damage_taken,
            "physical_damage_taken": participant_dto.physical_damage_taken,
            "magic_damage_taken": participant_dto.magic_damage_taken,
            "true_damage_taken": participant_dto.true_damage_taken,
            "damage_self_mitigated": participant_dto.total_self_mitigated,
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
            "role_bound_item": participant_dto.role_bound_item,
            # Spells
            "summoner1_id": participant_dto.summoner1_id,
            "summoner1_casts": participant_dto.summoner1_casts,
            "summoner2_id": participant_dto.summoner2_id,
            "summoner2_casts": participant_dto.summoner2_casts,
            # Objectives
            "turret_kills": participant_dto.turret_kills,
            "inhibitor_kills": participant_dto.inhibitor_kills,
            "objectives_stolen": participant_dto.objectives_stolen,
            # Time
            "time_spent_dead": participant_dto.time_spent_dead,
            "time_played": participant_dto.time_played,
            # JSON Data
            "runes": participant_dto.runes,
            "advanced_stats": participant_dto.advanced_stats,
        }

        # Advanced Stats (Challenges)
        challenges = participant_dto.advanced_stats

        data.update(
            {
                "solo_kills": challenges.get("soloKills", 0),
                "gold_per_minute": challenges.get("goldPerMinute", 0),
                "vision_score_per_minute": challenges.get("visionScorePerMinute", 0),
                "kill_participation": challenges.get("killParticipation", 0),
                "team_damage_percentage": challenges.get("teamDamagePercentage", 0),
                "epic_monster_steals": challenges.get("epicMonsterSteals", 0),
            }
        )

        # Safe fallback for game name
        if not data["game_name"]:
            data["game_name"] = "Unknown Player"

        return MatchDTOTransformer.sanitize_participant_names(data)
