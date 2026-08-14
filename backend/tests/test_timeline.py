"""Timeline row construction regressions."""

from types import SimpleNamespace

from app.features.matches.service_helpers import build_synthetic_match_dto
from app.features.matches.timeline import build_match_timeline_rows


def test_synthetic_dto_includes_stored_game_version() -> None:
    participant = SimpleNamespace(participant_id=1, team_id=100, puuid="p1")
    dto = build_synthetic_match_dto("EUN1_1", [participant], "16.1.1")
    assert dto.info.game_version == "16.1.1"
    assert dto.metadata.match_id == "EUN1_1"


def test_timeline_rows_tolerate_missing_game_version() -> None:
    match_dto = SimpleNamespace(
        metadata=SimpleNamespace(match_id="EUN1_1"),
        info=SimpleNamespace(
            participants=[SimpleNamespace(participant_id=1, team_id=100, puuid="p1")]
        ),
    )
    rows = build_match_timeline_rows(
        match_dto,
        {"info": {"frameInterval": 60000, "frames": [{"events": []}]}},
    )
    assert rows == [] or all("match_id" in row for row in rows)
