"""Timeline row construction regressions."""

from types import SimpleNamespace
from typing import cast

from app.features.matches.match_sync import build_synthetic_match_dto
from app.features.matches.participants import MatchParticipant
from app.features.matches.timeline import build_match_timeline_rows


def test_synthetic_dto_includes_stored_game_version() -> None:
    # `build_synthetic_match_dto` reads only these three attributes, but its
    # parameter is nominally typed, and a real mapped instance would drag the
    # whole ORM registry into a unit test.
    participant = cast(
        MatchParticipant, SimpleNamespace(participant_id=1, team_id=100, puuid="p1")
    )
    dto = build_synthetic_match_dto("EUN1_1", [participant], "16.1.1")
    assert dto.info.game_version == "16.1.1"
    assert dto.metadata.match_id == "EUN1_1"


def test_timeline_rows_tolerate_missing_game_version() -> None:
    # A stored match with no recorded version reaches timeline replacement as a
    # synthetic DTO whose `game_version` defaults to "" — the backfill path in
    # `backfill_timeline_only_match` does exactly this. The old hand-rolled
    # namespace dropped the attribute entirely, a shape no caller can produce.
    participant = cast(
        MatchParticipant, SimpleNamespace(participant_id=1, team_id=100, puuid="p1")
    )
    match_dto = build_synthetic_match_dto("EUN1_1", [participant])
    rows = build_match_timeline_rows(
        match_dto,
        {"info": {"frameInterval": 60000, "frames": [{"events": []}]}},
    )
    assert rows == [] or all("match_id" in row for row in rows)
