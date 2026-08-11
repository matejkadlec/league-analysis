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


class MatchType(str, Enum):
    """MATCH-V5 match-list type filters."""

    RANKED = "ranked"
    NORMAL = "normal"
    TOURNEY = "tourney"
    TUTORIAL = "tutorial"


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
    """Current Riot queue IDs accepted by MATCH-V5 filters.

    Names follow Riot's maintained queue dataset, which includes active and
    retained historical entries. Product support is a narrower allowlist
    declared below.
    """

    NORMAL_DRAFT_5X5 = 400
    RANKED_SOLO_5X5 = 420
    NORMAL_BLIND_PICK_5X5 = 430
    RANKED_FLEX_5X5 = 440
    ARAM = 450
    SWIFTPLAY = 480
    QUICKPLAY = 490

    BLOOD_HUNT_ASSASSIN = 600
    DARK_STAR_SINGULARITY = 610
    SUMMONERS_RIFT_CLASH = 700
    ARAM_CLASH = 720
    COOP_VS_AI_INTERMEDIATE_TWISTED_TREELINE = 800
    COOP_VS_AI_INTRO_TWISTED_TREELINE = 810
    COOP_VS_AI_BEGINNER_TWISTED_TREELINE = 820
    COOP_VS_AI_INTRO = 870
    COOP_VS_AI_BEGINNER = 880
    COOP_VS_AI_INTERMEDIATE = 890
    ARURF = 900
    ASCENSION = 910
    PORO_KING = 920
    NEXUS_SIEGE = 940
    DOOM_BOTS_VOTING = 950
    DOOM_BOTS_STANDARD = 960
    STAR_GUARDIAN_NORMAL = 980
    STAR_GUARDIAN_ONSLAUGHT = 990
    PROJECT_HUNTERS = 1000
    SNOW_ARURF = 1010
    ONE_FOR_ALL = 1020
    ODYSSEY_INTRO = 1030
    ODYSSEY_CADET = 1040
    ODYSSEY_CREWMEMBER = 1050
    ODYSSEY_CAPTAIN = 1060
    ODYSSEY_ONSLAUGHT = 1070
    NEXUS_BLITZ = 1300
    ULTIMATE_SPELLBOOK = 1400
    ARENA = 1700
    ARENA_16_PLAYER = 1710
    SWARM_SOLO = 1810
    SWARM_DUO = 1820
    SWARM_TRIO = 1830
    SWARM_SQUAD = 1840
    PICK_URF = 1900
    TUTORIAL_1 = 2000
    TUTORIAL_2 = 2010
    TUTORIAL_3 = 2020
    BRAWL = 2300
    ARAM_MAYHEM = 2400


PRODUCT_SUPPORTED_QUEUE_TYPES: tuple[QueueType, ...] = (
    QueueType.RANKED_SOLO_5X5,
    QueueType.RANKED_FLEX_5X5,
    QueueType.SWIFTPLAY,
    QueueType.NORMAL_DRAFT_5X5,
    QueueType.ARAM,
    QueueType.ARAM_MAYHEM,
)
PRODUCT_SUPPORTED_QUEUE_IDS: tuple[int, ...] = tuple(
    queue.value for queue in PRODUCT_SUPPORTED_QUEUE_TYPES
)


def get_region_by_platform(platform: Platform | str) -> Region:
    """Map a supported platform to its regional route or fail closed."""
    p = platform.value if isinstance(platform, Platform) else platform.lower()
    if p in ["na1", "br1", "la1", "la2"]:
        return Region.AMERICAS
    if p in ["kr", "jp1"]:
        return Region.ASIA
    if p in ["eun1", "euw1", "ru", "tr1"]:
        return Region.EUROPE
    if p in ["oc1", "ph2", "sg2", "th2", "tw2", "vn2"]:
        return Region.SEA
    raise ValueError(f"Unsupported Riot platform: {platform}")
