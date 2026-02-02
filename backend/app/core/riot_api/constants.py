"""Riot API constants and enum definitions."""

from enum import Enum


class Region(str, Enum):
    """Riot API regions for regional routing."""

    AMERICAS = "americas"
    ASIA = "asia"
    EUROPE = "europe"
    SEA = "sea"


class Platform(str, Enum):
    """Riot API platforms for platform routing."""

    BR1 = "br1"
    EUN1 = "eun1"
    EUW1 = "euw1"
    JP1 = "jp1"
    KR = "kr"
    LA1 = "la1"
    LA2 = "la2"
    NA1 = "na1"
    OC1 = "oc1"
    PH2 = "ph2"
    RU = "ru"
    SG2 = "sg2"
    TH2 = "th2"
    TR1 = "tr1"
    TW2 = "tw2"
    VN2 = "vn2"


# Platform display names (community-known abbreviations)
PLATFORM_DISPLAY_NAMES: dict[str, str] = {
    "br1": "BR",
    "eun1": "EUNE",
    "euw1": "EUW",
    "jp1": "JP",
    "kr": "KR",
    "la1": "LAN",
    "la2": "LAS",
    "na1": "NA",
    "oc1": "OCE",
    "ph2": "PH",
    "ru": "RU",
    "sg2": "SG",
    "th2": "TH",
    "tr1": "TR",
    "tw2": "TW",
    "vn2": "VN",
}


def get_platform_display_name(platform: str) -> str:
    """Get the community-friendly display name for a platform.

    Args:
        platform: Platform code (e.g., 'eun1', 'EUN1')

    Returns:
        Display name (e.g., 'EUNE')
    """
    return PLATFORM_DISPLAY_NAMES.get(platform.lower(), platform.upper())


class QueueType(int, Enum):
    """Riot API queue types for match filtering."""

    # Ranked queues
    RANKED_SOLO_5X5 = 420
    RANKED_FLEX_5X5 = 440
    RANKED_FLEX_3X3 = 470

    # Normal queues
    NORMAL_DRAFT_5X5 = 400
    NORMAL_BLIND_PICK_5X5 = 430
    NORMAL_BLIND_PICK_3X3 = 450
    ARAM = 450

    # Other queues
    PRACTICE_TOOL = 2000
    TUTORIAL_1 = 2010
    TUTORIAL_2 = 2011
    TUTORIAL_3 = 2012

    # Event/Rotation queues
    ASSASSINATE = 600
    ONE_FOR_ALL = 610
    HEXAKILL = 620
    URF = 630
    DOOM_BOTS = 640
    ASCENSION = 650
    PoroKing = 700
    NEXUS_SIEGE = 720
    DefinitelyNotDominion = 800
    ARURF = 830
    PROJECT = 840
    OVERCHARGE = 860
    SNOWURF = 870
    Odyssey = 880


def get_region_by_platform(platform: str) -> Region:
    """Map platform code to regional routing value."""
    p = platform.lower()
    if p in ["na1", "br1", "la1", "la2"]:
        return Region.AMERICAS
    if p in ["kr", "jp1"]:
        return Region.ASIA
    if p in ["eun1", "euw1", "ru", "tr1"]:
        return Region.EUROPE
    if p in ["oc1", "ph2", "sg2", "th2", "tw2", "vn2"]:
        return Region.SEA
    return Region.EUROPE  # Default fallback
