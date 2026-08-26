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

# Product bucket for a player with no league entry. LEAGUE-V4 itself never
# emits this; matchmaking invents it so unranked players are counted, not
# averaged in as Iron IV.
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
