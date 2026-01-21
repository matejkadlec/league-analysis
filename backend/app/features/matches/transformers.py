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
        data = {
            "puuid": participant_dto.puuid,
            "game_name": participant_dto.riot_id_game_name or None,
            "tag_line": participant_dto.riot_id_tagline or None,
            "summoner_level": participant_dto.summoner_level,
            "champion_id": participant_dto.champion_id,
            "champion_name": participant_dto.champion_name,
            "team_id": participant_dto.team_id,
            "team_position": participant_dto.team_position,
            "win": participant_dto.win,
            "kills": participant_dto.kills,
            "deaths": participant_dto.deaths,
            "assists": participant_dto.assists,
            "gold_earned": participant_dto.gold_earned,
            "cs": participant_dto.total_minions_killed
            + participant_dto.neutral_minions_killed,
            "vision_score": participant_dto.vision_score or 0,
            "total_damage_dealt_to_champions": participant_dto.total_damage_dealt_to_champions,
            "total_damage_taken": participant_dto.total_damage_taken,
        }

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
        - Region is uppercase

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

        # Normalize region to uppercase
        if "region" in player_data and player_data["region"]:
            player_data["region"] = player_data["region"].upper()

        return player_data
