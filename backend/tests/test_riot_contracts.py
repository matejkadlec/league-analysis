"""Sanitized current Riot contract and objective-retention tests."""

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.core.riot_api.models import (
    AccountDTO,
    MatchDTO,
    MatchTimelineDTO,
    SummonerDTO,
)
from app.features.matches.timeline import build_match_timeline_rows

FIXTURE: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "riot_contracts_2026_08_08.json").read_text()
)
QUEUE_VARIANTS: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "supported_queue_variants.json").read_text()
)


def _match_payload(queue_id: str) -> dict[str, Any]:
    payload: dict[str, Any] = deepcopy(FIXTURE["matches"][queue_id])
    payload.pop("timeline")
    payload["info"]["participants"] = [deepcopy(FIXTURE["participant"])]
    return payload


def _timeline_metadata(queue_id: str) -> dict[str, Any]:
    """The metadata block Riot always sends and the timeline DTO requires.

    Aggregation never reads it — the match DTO supplies match identity — but
    the client now validates the whole response, so the sample carries it.
    """
    return deepcopy(FIXTURE["matches"][queue_id]["metadata"])


def _timeline_payload(queue_id: str) -> MatchTimelineDTO:
    event_samples = FIXTURE["matches"][queue_id]["timeline"]["info"]["events"]
    events: list[dict[str, Any]] = []
    for index, sample in enumerate(event_samples, start=1):
        event: dict[str, Any] = deepcopy(sample)
        event.update(
            {
                "killerId": 1,
                "killerTeamId": 100,
                "timestamp": index * 60_000,
            }
        )
        events.append(event)
    return MatchTimelineDTO.model_validate(
        {
            "metadata": _timeline_metadata(queue_id),
            "info": {
                "frameInterval": 60_000,
                "frames": [{"timestamp": 0, "events": events}],
            },
        }
    )


def test_current_account_and_summoner_contracts_allow_provider_optionality() -> None:
    account = AccountDTO.model_validate(FIXTURE["account"])
    summoner = SummonerDTO.model_validate(FIXTURE["summoner"])
    assert account.game_name == "Sanitized Player"
    assert summoner.profile_icon_id == 29

    identity_free = AccountDTO.model_validate({"puuid": "sanitized"})
    assert identity_free.game_name is None
    assert identity_free.tag_line is None


def test_empty_platform_id_is_rejected_not_defaulted() -> None:
    """A match with no region is a failure, not an EUN1 match.

    `upsert_match` used to fall back to "EUN1", and that value is written onto
    every participant's player row. A KR player first seen through that path
    was routed to the wrong regional host by every later Riot call, forever.
    """
    payload = _match_payload("420")
    payload["info"]["platformId"] = ""

    with pytest.raises(ValidationError):
        MatchDTO.model_validate(payload)


@pytest.mark.parametrize("queue_id", ["400", "420", "440", "450"])
def test_current_match_contracts_keep_creation_and_actual_start(queue_id: str) -> None:
    match = MatchDTO.model_validate(_match_payload(queue_id))
    assert match.info.queue_id == int(queue_id)
    assert match.info.game_creation_timestamp == 1_786_100_000_000
    assert match.info.game_start_timestamp == 1_786_100_060_000
    assert match.info.participants[0].summoner_name == "Sanitized Legacy Name"


@pytest.mark.parametrize("variant", QUEUE_VARIANTS["queues"])
def test_new_supported_queue_variants_preserve_queue_identity(
    variant: dict[str, Any],
) -> None:
    payload = _match_payload(variant["base_fixture"])
    payload["metadata"]["matchId"] = f"EUN1_SANITIZED_{variant['id']}"
    payload["info"].update(
        {
            "queueId": variant["id"],
            "gameMode": variant["game_mode"],
            "mapId": variant["map_id"],
        }
    )

    match = MatchDTO.model_validate(payload)

    assert match.info.queue_id == variant["id"]
    assert match.info.game_mode == variant["game_mode"]

    rows = build_match_timeline_rows(match, _timeline_payload(variant["base_fixture"]))
    assert len(rows) == 1


@pytest.mark.parametrize("queue_id", ["400", "420", "440", "450"])
def test_current_mode_timeline_samples_remain_parseable(queue_id: str) -> None:
    match = MatchDTO.model_validate(_match_payload(queue_id))
    rows = build_match_timeline_rows(match, _timeline_payload(queue_id))
    assert len(rows) == 1
    assert rows[0]["objective_takedowns_total"] == len(
        FIXTURE["matches"][queue_id]["timeline"]["info"]["events"]
    )


def test_atakhan_is_historical_and_unknown_current_objectives_are_retained() -> None:
    current = MatchDTO.model_validate(_match_payload("420"))
    current_timeline = MatchTimelineDTO.model_validate(
        {
            "metadata": _timeline_metadata("420"),
            "info": {
                "frameInterval": 60_000,
                "frames": [
                    {
                        "timestamp": 0,
                        "events": [
                            {
                                "type": "ELITE_MONSTER_KILL",
                                "monsterType": "ATAKHAN",
                                "monsterSubType": "RUINOUS_ATAKHAN",
                                "killerId": 1,
                                "timestamp": 60_000,
                            },
                            {
                                "type": "ELITE_MONSTER_KILL",
                                "monsterType": "FUTURE_MONSTER",
                                "killerId": 1,
                                "timestamp": 120_000,
                            },
                            {
                                "type": "BUILDING_KILL",
                                "buildingType": "FUTURE_BUILDING",
                                "killerId": 1,
                                "timestamp": 180_000,
                            },
                        ],
                    }
                ],
            },
        }
    )
    current_row = build_match_timeline_rows(current, current_timeline)[0]
    assert current_row["atakhan_takedowns"] == 0
    assert current_row["other_epic_monster_takedowns"] == {
        "ATAKHAN": 1,
        "FUTURE_MONSTER": 1,
    }
    assert [event["m"] for event in current_row["objective_events"][:2]] == [
        "ATAKHAN",
        "FUTURE_MONSTER",
    ]
    assert current_row["objective_events"][2]["o"] == "other_building"

    historical_payload = _match_payload("420")
    historical_payload["info"]["gameVersion"] = "15.24.1.1"
    historical = MatchDTO.model_validate(historical_payload)
    historical_row = build_match_timeline_rows(historical, current_timeline)[0]
    assert historical_row["atakhan_takedowns"] == 1
