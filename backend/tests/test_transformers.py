"""Critical data-normalization regression coverage."""

from types import SimpleNamespace
from typing import Any

from app.core.riot_api.models import ParticipantDTO
from app.core.validation import (
    is_empty_or_none,
    validate_list_items,
    validate_nested_fields,
    validate_required_fields,
)
from app.features.matches.participants import MatchParticipant
from app.features.matches.transformers import MatchDTOTransformer, PlayerDataSanitizer


def participant(**overrides: Any) -> ParticipantDTO:
    """A participant as Riot sends it: alias keys, only the required ten."""
    payload: dict[str, Any] = {
        "participantId": 1,
        "puuid": "p-1",
        "teamId": 100,
        "championId": 517,
        "championName": "Sylas",
        "champLevel": 18,
        "win": True,
        "kills": 5,
        "deaths": 2,
        "assists": 9,
        **overrides,
    }
    return ParticipantDTO.model_validate(payload)


def test_match_id_extraction_handles_supported_boundaries() -> None:
    assert MatchDTOTransformer.extract_match_ids(None) == []
    assert MatchDTOTransformer.extract_match_ids(["EUN1_1"]) == ["EUN1_1"]
    assert MatchDTOTransformer.extract_match_ids(
        SimpleNamespace(match_ids=("EUN1_1", "EUN1_2"))
    ) == ["EUN1_1", "EUN1_2"]
    assert MatchDTOTransformer.extract_match_ids(object()) == []


def test_name_and_platform_sanitization_is_stable() -> None:
    participant = {"game_name": "", "tag_line": "EUN1"}
    assert MatchDTOTransformer.sanitize_participant_names(participant) == {
        "game_name": None,
        "tag_line": "EUN1",
    }
    player = PlayerDataSanitizer.sanitize_player_fields(
        {"game_name": "  ", "tag_line": "", "platform": "eun1"}
    )
    assert player == {
        "game_name": "Unknown Player",
        "tag_line": None,
        "platform": "EUN1",
    }


def test_core_shape_validation_rejects_missing_or_invalid_data() -> None:
    assert validate_required_fields({"id": 1}, ["id"])
    assert not validate_required_fields({}, ["id"])
    assert validate_nested_fields({"metadata": {"id": 1}}, {"metadata": ["id"]})
    assert not validate_nested_fields({"metadata": []}, {"metadata": ["id"]})
    # A nested object that exists but lacks the field inside it — the branch
    # that recurses, not the one that checks the parent's presence.
    assert not validate_nested_fields({"metadata": {"other": 1}}, {"metadata": ["id"]})
    assert validate_list_items([{"id": 1}], ["id"])
    assert not validate_list_items([], ["id"])
    # Same distinction one level down: the item is a dict, the field is not in it.
    assert not validate_list_items([{"other": 1}], ["id"])
    assert is_empty_or_none(None)
    assert is_empty_or_none("")
    assert not is_empty_or_none(0)


def test_extracted_participant_fits_the_row_it_becomes() -> None:
    # This is the whole production path: `MatchParticipant(match_id=...,
    # **extract_participant_data(dto))` in match_persistence. The dict has
    # ~75 keys and every one must name a real column — SQLAlchemy raises on
    # an unknown kwarg, so this one construction checks the entire mapping
    # without pinning a single value to its literal.
    #
    # Instantiating a mapped class configures every mapper, so the whole
    # registry has to be imported first or MatchParticipant's relationships
    # point at names that do not exist yet.
    from app.model_registry import import_all_models

    import_all_models()

    data = MatchDTOTransformer.extract_participant_data(participant())
    row = MatchParticipant(match_id="EUN1_1", **data)

    assert row.puuid == "p-1"
    assert row.champion_name == "Sylas"
    assert row.kills == 5


def test_remake_is_the_negation_of_progression_eligibility() -> None:
    # Riot has no "remake" flag; the signal is eligibleForProgression, and
    # the transformer inverts it. Inverted the wrong way, every real game is
    # stored as a remake and excluded from every analysis.
    assert MatchDTOTransformer.extract_participant_data(participant())["remake"] is (
        False
    )
    remade = participant(eligibleForProgression=False)
    assert MatchDTOTransformer.extract_participant_data(remade)["remake"] is True


def test_display_name_falls_back_through_riot_id_then_summoner_name() -> None:
    # Three generations of Riot naming in one field. The modern riotIdGameName
    # wins; the legacy summonerName fills in when the riot id is empty string
    # (which the API sends, not null); a participant with neither still gets a
    # printable name rather than NULL in a NOT NULL column.
    riot_id = participant(riotIdGameName="Faker", summonerName="OldName")
    assert MatchDTOTransformer.extract_participant_data(riot_id)["game_name"] == (
        "Faker"
    )

    legacy = participant(riotIdGameName="", summonerName="OldName")
    assert MatchDTOTransformer.extract_participant_data(legacy)["game_name"] == (
        "OldName"
    )

    nameless = participant()
    assert MatchDTOTransformer.extract_participant_data(nameless)["game_name"] == (
        "Unknown Player"
    )


def test_lane_falls_back_to_individual_position() -> None:
    # Arena and older payloads leave teamPosition empty and fill
    # individualPosition; without the fallback those games have no lane at all.
    payload = participant(teamPosition="", individualPosition="JUNGLE")
    assert (
        MatchDTOTransformer.extract_participant_data(payload)["team_position"]
        == "JUNGLE"
    )


def test_challenge_stats_are_read_under_riots_own_names() -> None:
    # The challenges dict is raw camelCase Riot vocabulary and two of the
    # renames are non-obvious: roam_kills reads
    # killsOnOtherLanesEarlyJungleAsLaner and ally_saves reads
    # saveAllyFromDeath. A typo in any key is silent — .get(wrong, 0) writes a
    # zero into every row forever, which is exactly the class of bug the
    # lopsided prod data has hidden before.
    payload = participant(
        challenges={
            "killsOnOtherLanesEarlyJungleAsLaner": 3,
            "saveAllyFromDeath": 2,
            "goldPerMinute": 401.5,
        }
    )
    data = MatchDTOTransformer.extract_participant_data(payload)
    assert data["roam_kills"] == 3
    assert data["ally_saves"] == 2
    assert data["gold_per_minute"] == 401.5

    # And a payload with no challenges block defaults to zeros, not KeyError.
    bare = MatchDTOTransformer.extract_participant_data(participant())
    assert bare["solo_kills"] == 0


def test_missing_vision_score_becomes_zero_not_null() -> None:
    data = MatchDTOTransformer.extract_participant_data(participant())
    assert data["vision_score"] == 0

    scored = participant(visionScore=31.9)
    assert MatchDTOTransformer.extract_participant_data(scored)["vision_score"] == 31


def test_empty_tag_line_is_stored_as_null() -> None:
    data = MatchDTOTransformer.extract_participant_data(participant(riotIdTagline=""))
    assert data["tag_line"] is None
