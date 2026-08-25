"""Critical data-normalization regression coverage."""

from typing import Any

from app.core.riot_api.models import ParticipantDTO
from app.features.matches.participants import MatchParticipant
from app.features.matches.transformers import MatchDTOTransformer


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


def test_name_sanitization_is_stable() -> None:
    participant = {"game_name": "", "tag_line": "EUN1"}
    assert MatchDTOTransformer.sanitize_participant_names(participant) == {
        "game_name": None,
        "tag_line": "EUN1",
    }


def test_extracted_participant_fits_the_row_it_becomes() -> None:
    # This is the whole production path: `MatchParticipant(match_id=...,
    # **extract_participant_data(dto))` in match_persistence. The dict has ~75
    # keys and every one must name a real column — SQLAlchemy raises on an
    # unknown kwarg, so one construction checks the entire mapping.
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

    summoner_name_only = participant(riotIdGameName="", summonerName="OldName")
    fallen_back = MatchDTOTransformer.extract_participant_data(summoner_name_only)
    assert fallen_back["game_name"] == "OldName"

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
    # The challenges dict is raw camelCase Riot vocabulary, and a typo in any key
    # is silent -- .get(wrong, 0) writes a zero into every row forever. Only the
    # six columns something still reads are copied out; the rest of the object
    # stays in `advanced_stats`, where the blob is the single copy.
    payload = participant(
        challenges={
            "soloKills": 3,
            "goldPerMinute": 401.5,
            "visionScorePerMinute": 1.25,
            "killParticipation": 0.62,
            "teamDamagePercentage": 0.31,
            "epicMonsterSteals": 2,
        }
    )
    data = MatchDTOTransformer.extract_participant_data(payload)
    assert data["solo_kills"] == 3
    assert data["gold_per_minute"] == 401.5
    assert data["vision_score_per_minute"] == 1.25
    assert data["kill_participation"] == 0.62
    assert data["team_damage_percentage"] == 0.31
    assert data["epic_monster_steals"] == 2

    # And a payload with no challenges block defaults to zeros, not KeyError.
    bare = MatchDTOTransformer.extract_participant_data(participant())
    assert bare["solo_kills"] == 0


def test_the_challenges_blob_is_stored_whole() -> None:
    """The columns above are a projection; the object itself is the record.

    Fifteen more columns used to copy one key each out of this blob and were
    read by nothing, so revision 0027 dropped them. That is only safe while
    the blob is still stored verbatim.
    """
    challenges = {"skillshotsHit": 41, "buffsStolen": 1, "soloKills": 3}
    data = MatchDTOTransformer.extract_participant_data(
        participant(challenges=challenges)
    )

    assert data["advanced_stats"] == challenges


def test_missing_vision_score_becomes_zero_not_null() -> None:
    data = MatchDTOTransformer.extract_participant_data(participant())
    assert data["vision_score"] == 0

    scored = participant(visionScore=31.9)
    assert MatchDTOTransformer.extract_participant_data(scored)["vision_score"] == 31


def test_empty_tag_line_is_stored_as_null() -> None:
    data = MatchDTOTransformer.extract_participant_data(participant(riotIdTagline=""))
    assert data["tag_line"] is None
