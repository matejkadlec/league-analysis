"""Shared match lookups used by playstyle evaluators and aggregates."""

from typing import Any, Dict, Optional

from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant

MatchesById = Dict[Any, Match]


def lookup_match(matches: MatchesById, match_id: Any) -> Optional[Match]:
    return matches.get(str(match_id)) or matches.get(match_id)


def team_attribute_share(
    p: MatchParticipant, match: Match, attr: str
) -> Optional[float]:
    team_participants = [x for x in match.participants if x.team_id == p.team_id]
    total = sum((getattr(x, attr) or 0) for x in team_participants)
    if total > 0:
        return (getattr(p, attr) or 0) / total * 100.0
    return None


def team_kill_participation(p: MatchParticipant, match: Match) -> Optional[float]:
    team_participants = [x for x in match.participants if x.team_id == p.team_id]
    total_kills = sum((x.kills or 0) for x in team_participants)
    if total_kills > 0:
        return ((p.kills or 0) + (p.assists or 0)) / total_kills * 100.0
    return None
