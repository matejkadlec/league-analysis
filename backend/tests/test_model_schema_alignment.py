"""Every response field must admit the values its column is allowed to hold.

A response schema promises what the API sends; a column's `nullable=True`
promises what the database may store. When the second is wider, one NULL row
makes `model_validate` raise and 500s every response that carries that row.
"""

from __future__ import annotations

import types
import typing

import annotated_types
import pytest
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import DeclarativeBase

from app.features.auth.schemas import UserResponse
from app.features.auth.users.models import User
from app.features.jobs.models import JobConfiguration, JobExecution, PlayerSyncRun
from app.features.jobs.schemas import JobConfigurationResponse, JobExecutionResponse
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.matches.schemas import (
    EnemyLaneOpponent,
    MatchResponse,
    MatchWithPlayerData,
    PlayerMatchParticipant,
)
from app.features.matchmaking_analysis.models import MatchmakingAnalysis
from app.features.matchmaking_analysis.schemas import (
    MatchmakingAnalysisResponse,
)
from app.features.players.leagues import PlayerLeague
from app.features.players.leagues_schemas import PlayerLeagueResponse
from app.features.players.models import Player
from app.features.players.schemas import PlayerResponse, PlayerSyncRunResponse
from app.features.smurf_boost_detection.models import SmurfBoostAnalysis
from app.features.smurf_boost_detection.schemas import SmurfBoostAnalysisResponse

# Explicit rather than discovered: pairing a schema to a table by name overlap
# invents pairs that share `puuid` and reports failures nobody can act on.
# `test_every_orm_backed_response_schema_is_paired` is what keeps this honest.
PAIRS: list[tuple[type[DeclarativeBase], type[BaseModel]]] = [
    (JobConfiguration, JobConfigurationResponse),
    (JobExecution, JobExecutionResponse),
    (Match, MatchResponse),
    (Match, MatchWithPlayerData),
    (MatchParticipant, EnemyLaneOpponent),
    (MatchParticipant, PlayerMatchParticipant),
    (MatchmakingAnalysis, MatchmakingAnalysisResponse),
    (Player, PlayerResponse),
    (PlayerLeague, PlayerLeagueResponse),
    (PlayerSyncRun, PlayerSyncRunResponse),
    (SmurfBoostAnalysis, SmurfBoostAnalysisResponse),
    (User, UserResponse),
]


def _admits_none(annotation: object) -> bool:
    """Whether a field annotation accepts None."""
    if typing.get_origin(annotation) in (typing.Union, types.UnionType):
        return any(arg is type(None) for arg in typing.get_args(annotation))
    return annotation is type(None) or annotation is typing.Any


@pytest.mark.parametrize(("model", "schema"), PAIRS, ids=lambda p: p.__name__)
def test_no_response_field_forbids_a_null_its_column_allows(
    model: type[DeclarativeBase], schema: type[BaseModel]
) -> None:
    """A nullable column may not sit under a field that rejects None."""
    columns = {column.key: column for column in sa_inspect(model).columns}

    offenders = [
        f"{model.__name__}.{name} is nullable, but "
        f"{schema.__name__}.{name} is {info.annotation}"
        for name, info in schema.model_fields.items()
        if (column := columns.get(name)) is not None
        and column.nullable
        and not _admits_none(info.annotation)
    ]

    assert offenders == []


@pytest.mark.parametrize(("model", "schema"), PAIRS, ids=lambda p: p.__name__)
def test_no_response_field_caps_a_column_the_database_does_not_cap(
    model: type[DeclarativeBase], schema: type[BaseModel]
) -> None:
    """A ceiling on a response field can only ever reject a real row.

    An upper bound the database does not enforce turns a stored value into a
    `ResponseValidationError`, which FastAPI serves as a 500. Lower bounds and
    fields that are not columns are left alone.
    """
    columns = {column.key for column in sa_inspect(model).columns}

    offenders = [
        f"{schema.__name__}.{name} caps {model.__name__}.{name} at {bound}"
        for name, info in schema.model_fields.items()
        if name in columns
        for bound in info.metadata
        if isinstance(bound, (annotated_types.Le, annotated_types.Lt))
    ]

    assert offenders == []


@pytest.mark.parametrize(("model", "schema"), PAIRS, ids=lambda p: p.__name__)
def test_no_response_field_is_shorter_than_the_column_it_reads(
    model: type[DeclarativeBase], schema: type[BaseModel]
) -> None:
    """The string half of the same rule, where the column does set a ceiling.

    `max_length` is kept rather than deleted the way a numeric cap is: a
    `String(78)` column really is bounded, and the bound reaches the OpenAPI
    document. What it may not do is claim a *tighter* bound than the column.
    """
    columns = {column.key: column for column in sa_inspect(model).columns}

    offenders: list[str] = []
    for name, info in schema.model_fields.items():
        column = columns.get(name)
        # `is None`, not falsiness: a Column builds a SQL expression rather
        # than answering a truth value, and raises if asked for one.
        if column is None:
            continue
        column_length = getattr(column.type, "length", None)
        if column_length is None:
            continue
        offenders += [
            f"{schema.__name__}.{name} accepts {bound.max_length} characters, "
            f"{model.__name__}.{name} stores {column_length}"
            for bound in info.metadata
            if isinstance(bound, annotated_types.MaxLen)
            and bound.max_length < column_length
        ]

    assert offenders == []


def test_every_orm_backed_response_schema_is_paired() -> None:
    """A new `from_attributes` schema must be paired above or named below.

    Without this, adding a response model silently adds an unchecked one.
    """
    # Schemas that read from an ORM object but are not one table's shape:
    # envelopes, sub-objects assembled in Python, and the parked playstyle
    # package (see its CLAUDE.md).
    not_one_table = {
        "ChampionStatsItem",
        "ChampionStatsResponse",
        "JobExecutionListResponse",
        "LaneStatsItem",
        "LaneStatsResponse",
        "MatchListResponse",
        "MatchListWithPlayerDataResponse",
        "MatchStatsResponse",
        "MatchmakingAnalysisHistoryItem",
        "MatchmakingAnalysisHistoryResponse",
        "PlaystyleAnalysisResponse",
        "RunesData",
        "SettingResponse",
        "TeamChampion",
        "TeamComposition",
        "TeamStats",
        "TeamStatsComposition",
        "UserCookieConsentResponse",
    }

    found = _orm_backed_schema_names()
    # Self-check first: `app.routes` cannot be walked for this (FastAPI keeps
    # included routers as opaque `_IncludedRouter` entries), and a discovery
    # that silently finds nothing would make both assertions below vacuous.
    assert len(found) >= 25, f"schema discovery found only {sorted(found)}"

    paired = {schema.__name__ for _, schema in PAIRS}
    assert sorted(found - paired - not_one_table) == []
    assert sorted(not_one_table - found) == [], (
        "these exclusions name schemas that are gone"
    )


def _orm_backed_schema_names() -> set[str]:
    """Every `from_attributes` Pydantic model defined in a feature schema module."""
    import importlib
    import inspect
    import pkgutil

    import app.features as features_package

    names: set[str] = set()
    for module_info in pkgutil.iter_modules(features_package.__path__):
        for suffix in ("schemas", "leagues_schemas"):
            try:
                module = importlib.import_module(
                    f"app.features.{module_info.name}.{suffix}"
                )
            except ModuleNotFoundError:
                continue
            for name, obj in inspect.getmembers(module, inspect.isclass):
                if (
                    issubclass(obj, BaseModel)
                    and obj.__module__ == module.__name__
                    and obj.model_config.get("from_attributes")
                ):
                    names.add(name)
    return names
