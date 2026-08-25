"""Riot API constants and enum definitions."""

from enum import Enum
from typing import Final


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

# The one queue every stats surface reports on. Derived from the enum so the
# Riot fact (420 = ranked solo/duo) is declared exactly once.
RANKED_SOLO_QUEUE_ID: Final[int] = QueueType.RANKED_SOLO_5X5.value


def normalize_platform(platform: Platform | str) -> str:
    """Return the canonical stored spelling of a platform id.

    Lowercase is canonical: every read and write of `core.players.platform`
    goes through here, under the check constraint on `Player.__table_args__`.
    Membership is checked so an unknown id fails here, not later in a response.

    Raises:
        ValueError: the id is not one of Riot's platforms.
    """
    value = platform.value if isinstance(platform, Platform) else platform
    return Platform(value.strip().lower()).value


# Keyed by the enum so a platform added above cannot silently miss its
# route: test_riot_api_boundaries.py walks every Platform member through
# `get_region_by_platform`.
PLATFORM_REGIONS: Final[dict[Platform, Region]] = {
    Platform.NA1: Region.AMERICAS,
    Platform.BR1: Region.AMERICAS,
    Platform.LA1: Region.AMERICAS,
    Platform.LA2: Region.AMERICAS,
    Platform.KR: Region.ASIA,
    Platform.JP1: Region.ASIA,
    Platform.EUN1: Region.EUROPE,
    Platform.EUW1: Region.EUROPE,
    Platform.RU: Region.EUROPE,
    Platform.TR1: Region.EUROPE,
    Platform.OC1: Region.SEA,
    Platform.PH2: Region.SEA,
    Platform.SG2: Region.SEA,
    Platform.TH2: Region.SEA,
    Platform.TW2: Region.SEA,
    Platform.VN2: Region.SEA,
}


def get_region_by_platform(platform: Platform | str) -> Region:
    """Map a supported platform to its regional route or fail closed."""
    try:
        return PLATFORM_REGIONS[Platform(normalize_platform(platform))]
    except ValueError:
        raise ValueError(f"Unsupported Riot platform: {platform}") from None


def enum_str(value: Region | Platform | str) -> str:
    """Extract string value from enum or return as-is.

    Not `normalize_platform`: that one lowercases and strips because the
    platform column has to match case-sensitively, and a region built through
    it would be a different kind of value.
    """
    if isinstance(value, Enum):
        return str(value.value)
    return value
