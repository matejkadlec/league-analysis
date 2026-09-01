"""The shared match lookups playstyle evaluators and aggregates read through.

Their two edges -- a missing match, and a team whose total is zero -- decide what
every team-context tag sees, not just what it scores.
"""

from dataclasses import dataclass
from typing import cast

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.playstyle_analysis.tag_checks import (
    lookup_match,
    team_attribute_share,
    team_kill_participation,
)


@dataclass
class _Participant:
    """The `MatchParticipant` columns the shared lookups read."""

    puuid: str
    team_id: int
    kills: int = 0
    assists: int = 0
    total_damage_dealt_to_champions: int = 0


@dataclass
class _Match:
    """The `Match` surface the lookups read: its participants."""

    match_id: str
    participants: list[MatchParticipant]


def _match(match_id: str, participants: list[MatchParticipant]) -> Match:
    return cast(Match, _Match(match_id, participants))


def _blue_team() -> list[MatchParticipant]:
    return [
        cast(
            MatchParticipant,
            _Participant(
                "carry", 100, kills=2, assists=2, total_damage_dealt_to_champions=300
            ),
        ),
        cast(
            MatchParticipant,
            _Participant(
                "support", 100, kills=1, assists=5, total_damage_dealt_to_champions=100
            ),
        ),
        cast(
            MatchParticipant,
            _Participant(
                "tank", 100, kills=2, assists=3, total_damage_dealt_to_champions=100
            ),
        ),
    ]


def test_lookup_match_finds_the_match_and_reports_a_miss() -> None:
    found = _match("EUN1_1", [])
    missing = _match("EUN1_2", [])

    assert lookup_match({"EUN1_1": found, "EUN1_2": missing}, "EUN1_1") is found
    assert lookup_match({"EUN1_1": found, "EUN1_2": missing}, "EUN1_9") is None


def test_attribute_shares_count_only_the_players_own_team() -> None:
    """A share of a team total; the enemy side must not dilute it."""
    blue = _blue_team()
    red = [
        cast(
            MatchParticipant,
            _Participant(
                "foe", 200, kills=9, assists=9, total_damage_dealt_to_champions=900
            ),
        )
    ]
    match = _match("EUN1_1", blue + red)
    carry = blue[0]

    share = team_attribute_share(carry, match, "total_damage_dealt_to_champions")

    assert share == 60.0  # 300 of the blue side's 500, not of 1400


def test_a_zero_team_total_reports_no_share_at_all() -> None:
    """Zero divided by zero must not surface as a perfect 100% share."""
    participants = [cast(MatchParticipant, _Participant("idle", 100))]
    match = _match("EUN1_1", participants)

    assert (
        team_attribute_share(participants[0], match, "total_damage_dealt_to_champions")
        is None
    )
    assert team_kill_participation(participants[0], match) is None


def test_kill_participation_counts_kills_and_assists_over_team_kills() -> None:
    blue = _blue_team()
    match = _match("EUN1_1", blue)

    # (2 kills + 2 assists) / 5 team kills.
    assert team_kill_participation(blue[0], match) == 80.0
    # (1 + 5) / 5.
    assert team_kill_participation(blue[1], match) == 120.0
