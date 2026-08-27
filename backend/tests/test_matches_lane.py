"""Lane-opponent lookup shared by match history and playstyle analysis.

The rule is three-way: other player, other team, same assigned lane. Match
history additionally asks that `UNKNOWN` positions never pair up; playstyle
analysis leans on the raw rule.
"""

from dataclasses import dataclass
from typing import cast

from app.features.matches.lane import opposing_lane_participant
from app.features.matches.participants import MatchParticipant


@dataclass
class _Participant:
    """The `MatchParticipant` columns the lane lookup reads."""

    puuid: str
    team_id: int
    team_position: str | None


def _player(
    puuid: str = "player",
    team_id: int = 100,
    team_position: str | None = "MIDDLE",
) -> MatchParticipant:
    return cast(MatchParticipant, _Participant(puuid, team_id, team_position))


def _roster(
    player: MatchParticipant, *others: MatchParticipant
) -> list[MatchParticipant]:
    return [player, *others]


def test_the_same_position_on_the_other_team_is_the_opponent() -> None:
    player = _player()
    opponent = _player(puuid="foe", team_id=200, team_position="MIDDLE")
    decoys = [
        _player(puuid="teammate", team_id=100, team_position="MIDDLE"),
        _player(puuid="roamer", team_id=200, team_position="TOP"),
        _player(puuid="unseated", team_id=200, team_position=None),
    ]

    found = opposing_lane_participant(player, _roster(player, *decoys, opponent))

    assert found is opponent


def test_a_positionless_player_has_no_opponent() -> None:
    player = _player(team_position=None)
    other = _player(puuid="foe", team_id=200, team_position=None)

    assert opposing_lane_participant(player, _roster(player, other)) is None, (
        "null positions must not pair two arbitrary players"
    )


def test_unknown_positions_pair_only_when_the_caller_allows_it() -> None:
    player = _player(team_position="UNKNOWN")
    other = _player(puuid="foe", team_id=200, team_position="UNKNOWN")
    roster = _roster(player, other)

    assert opposing_lane_participant(player, roster, skip_unknown=True) is None
    assert opposing_lane_participant(player, roster, skip_unknown=False) is other
