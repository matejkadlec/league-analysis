"""The timeline DTOs must keep agreeing with Riot's published schema.

`MatchTimelineDTO` and friends were generated from Riot's OpenAPI
specification, and the point of generating them is lost the moment the two
drift apart. The specification slice is vendored next to this test rather than
fetched, because the suite is offline by construction (`--disable-socket`) and
because a gate that reaches the network fails for reasons unrelated to the
change under review.

When Riot adds or renames a field, the workflow is:

    curl -sSfL https://raw.githubusercontent.com/MingweiSamuel/riotapi-schema/gh-pages/openapi-3.0.0.json \
      | uv run --project backend python backend/tests/data/refresh_timeline_schema.py

which turns the change into a reviewable diff, and this test into the thing
that says whether the DTOs still match it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.core.riot_api.models import (
    MatchTimelineChampionStatsDTO,
    MatchTimelineDamageStatsDTO,
    MatchTimelineDTO,
    MatchTimelineEventDTO,
    MatchTimelineFrameDTO,
    MatchTimelineInfoDTO,
    MatchTimelineMetadataDTO,
    MatchTimelineParticipantDTO,
    MatchTimelineParticipantFrameDTO,
    MatchTimelinePositionDTO,
    MatchTimelineVictimDamageDTO,
)

SCHEMA_PATH = Path(__file__).parent / "data" / "riot_match_v5_timeline_schema.json"

# Every DTO paired with the schema it was generated from.
DTO_FOR_SCHEMA: dict[str, type[BaseModel]] = {
    "match-v5.TimelineDto": MatchTimelineDTO,
    "match-v5.MetadataTimeLineDto": MatchTimelineMetadataDTO,
    "match-v5.InfoTimeLineDto": MatchTimelineInfoDTO,
    "match-v5.FramesTimeLineDto": MatchTimelineFrameDTO,
    "match-v5.EventsTimeLineDto": MatchTimelineEventDTO,
    "match-v5.ParticipantTimeLineDto": MatchTimelineParticipantDTO,
    "match-v5.ParticipantFrameDto": MatchTimelineParticipantFrameDTO,
    "match-v5.ChampionStatsDto": MatchTimelineChampionStatsDTO,
    "match-v5.DamageStatsDto": MatchTimelineDamageStatsDTO,
    "match-v5.PositionDto": MatchTimelinePositionDTO,
    "match-v5.MatchTimelineVictimDamage": MatchTimelineVictimDamageDTO,
}


# Riot's own name for each field, as the payload spells it.
def wire_names(model: type[BaseModel]) -> set[str]:
    return {info.alias or name for name, info in model.model_fields.items()}


def load_schemas() -> dict[str, Any]:
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)["schemas"]


def test_every_vendored_schema_has_a_dto() -> None:
    """A new schema in the vendored slice must gain a DTO, not be ignored."""
    assert set(load_schemas()) == set(DTO_FOR_SCHEMA)


@pytest.mark.parametrize("schema_name", sorted(DTO_FOR_SCHEMA))
def test_dto_covers_every_documented_field(schema_name: str) -> None:
    """Riot documents no field the DTO is missing.

    This is the half that catches Riot ADDING something: the DTO silently
    ignores unknown keys, so without this the new field is invisible.
    """
    documented = set(load_schemas()[schema_name].get("properties", {}))
    modelled = wire_names(DTO_FOR_SCHEMA[schema_name])
    assert documented - modelled == set()


@pytest.mark.parametrize("schema_name", sorted(DTO_FOR_SCHEMA))
def test_dto_invents_no_field(schema_name: str) -> None:
    """The DTO claims no field Riot does not document.

    This is the half that catches a rename: the old name lingers in the DTO,
    reads as `None` forever, and nothing else would notice.
    """
    documented = set(load_schemas()[schema_name].get("properties", {}))
    modelled = wire_names(DTO_FOR_SCHEMA[schema_name])
    assert modelled - documented == set()


def test_only_the_structural_spine_is_required() -> None:
    """Leaves stay optional even where Riot marks them required.

    Riot's specification is generated from a reference that carries documented
    errors, and this repository has already been bitten by a field the portal
    called required and the live API omitted. Requiring a leaf nothing reads
    would turn a Riot quirk into a failed match sync, so the guarantee is
    deliberately narrow — and this test is what keeps a future regeneration
    from quietly widening it.
    """
    required_by_model = {
        name: {
            info.alias or field
            for field, info in model.model_fields.items()
            if info.is_required()
        }
        for name, model in DTO_FOR_SCHEMA.items()
    }
    assert required_by_model == {
        "match-v5.TimelineDto": {"metadata", "info"},
        "match-v5.MetadataTimeLineDto": {"matchId", "participants"},
        "match-v5.InfoTimeLineDto": {"frames", "frameInterval"},
        "match-v5.FramesTimeLineDto": {"timestamp", "events"},
        "match-v5.EventsTimeLineDto": {"timestamp", "type"},
        "match-v5.ParticipantTimeLineDto": {"participantId", "puuid"},
        "match-v5.ParticipantFrameDto": set(),
        "match-v5.ChampionStatsDto": set(),
        "match-v5.DamageStatsDto": set(),
        "match-v5.PositionDto": {"x", "y"},
        "match-v5.MatchTimelineVictimDamage": set(),
    }


def test_every_key_timeline_parsing_reads_is_documented() -> None:
    """The keys the parser consumes all exist in Riot's schema.

    `app/features/matches/timeline.py` reads the payload by name. This pins the
    names it depends on to the published schema, so a Riot rename shows up here
    rather than as a column that quietly stops being populated.
    """
    schemas = load_schemas()
    documented = {
        key for schema in schemas.values() for key in schema.get("properties", {})
    }
    consumed = {
        "assistingParticipantIds",
        "buildingType",
        "events",
        "frameInterval",
        "frames",
        "info",
        "killerId",
        "killerTeamId",
        "laneType",
        "monsterSubType",
        "monsterType",
        "teamId",
        "timestamp",
        "towerType",
        "type",
    }
    assert consumed - documented == set()
