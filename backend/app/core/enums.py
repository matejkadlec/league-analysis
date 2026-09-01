"""Shared enums used across features.

This module provides a single source of truth for enums used in both models and schemas.
"""

from enum import Enum
from typing import Final, Literal


class Tier(str, Enum):
    """League of Legends rank tiers from LEAGUE-V4."""

    IRON = "IRON"
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"
    PLATINUM = "PLATINUM"
    EMERALD = "EMERALD"
    DIAMOND = "DIAMOND"
    MASTER = "MASTER"
    GRANDMASTER = "GRANDMASTER"
    CHALLENGER = "CHALLENGER"


class Division(str, Enum):
    """LEAGUE-V4 division within a tier. Master and above still send ``I``."""

    I = "I"  # noqa: E741 — Riot's division spelling.
    II = "II"
    III = "III"
    IV = "IV"


UNRANKED: Final = "UNRANKED"

# LEAGUE-V4 never emits UNRANKED; matchmaking invents it so players with no
# league entry are counted rather than averaged in as Iron IV.
LobbyTier = Literal[
    "IRON",
    "BRONZE",
    "SILVER",
    "GOLD",
    "PLATINUM",
    "EMERALD",
    "DIAMOND",
    "MASTER",
    "GRANDMASTER",
    "CHALLENGER",
    "UNRANKED",
]


def lobby_tier_values() -> tuple[str, ...]:
    """Tier members plus the product UNRANKED bucket, in chart order."""
    return (*tuple(tier.value for tier in Tier), UNRANKED)
