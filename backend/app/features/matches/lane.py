"""Lane-opponent lookup shared by match history and playstyle analysis."""

from collections.abc import Sequence

from .participants import MatchParticipant


def opposing_lane_participant(
    player: MatchParticipant,
    participants: Sequence[MatchParticipant],
    *,
    skip_unknown: bool = False,
) -> MatchParticipant | None:
    """Return the opposing player in the same assigned lane, if any."""
    if not player.team_position:
        return None
    if skip_unknown and player.team_position == "UNKNOWN":
        return None
    for other in participants:
        if (
            other.puuid != player.puuid
            and other.team_id != player.team_id
            and other.team_position == player.team_position
        ):
            return other
    return None
