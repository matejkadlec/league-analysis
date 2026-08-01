"""Critical data-normalization regression coverage."""

from types import SimpleNamespace

from app.core.validation import (
    is_empty_or_none,
    validate_list_items,
    validate_nested_fields,
    validate_required_fields,
)
from app.features.matches.transformers import MatchDTOTransformer, PlayerDataSanitizer


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
    assert validate_list_items([{"id": 1}], ["id"])
    assert not validate_list_items([], ["id"])
    assert is_empty_or_none(None)
    assert is_empty_or_none("")
    assert not is_empty_or_none(0)
