"""The page envelope's field names, which three endpoints now share.

One edit to `PaginatedResponse` moves every paginated endpoint at once. These
are the names the client reads.
"""

import pytest
from pydantic import BaseModel

from app.core.schemas import PaginatedResponse
from app.features.jobs.schemas import JobExecutionListResponse
from app.features.matches.schemas import (
    MatchListResponse,
    MatchListWithPlayerDataResponse,
)

SUPPLIED_FIELDS = {"total", "page", "size"}
# Derived from `total` and `size`, so it is on every response without any
# endpoint being able to supply a wrong one.
DERIVED_FIELDS = {"pages"}
PAGE_FIELDS = SUPPLIED_FIELDS | DERIVED_FIELDS

ENVELOPES = [
    JobExecutionListResponse,
    MatchListResponse,
    MatchListWithPlayerDataResponse,
]


def test_the_envelope_is_exactly_these_four_counters() -> None:
    assert set(PaginatedResponse.model_fields) == SUPPLIED_FIELDS
    assert set(PaginatedResponse.model_computed_fields) == DERIVED_FIELDS


def test_every_counter_is_required() -> None:
    """A missing counter must be a parse failure, not a silent zero.

    `pages` gets there differently: a computed field can neither be absent nor
    disagree with `total` and `size`.
    """
    assert all(
        PaginatedResponse.model_fields[name].is_required() for name in SUPPLIED_FIELDS
    )


def test_the_page_count_is_a_ceiling_not_a_floor() -> None:
    """A partial last page still has to be counted, and an empty page size
    must not divide by zero."""
    assert PaginatedResponse(total=0, page=0, size=20).pages == 0
    assert PaginatedResponse(total=1, page=0, size=20).pages == 1
    assert PaginatedResponse(total=20, page=0, size=20).pages == 1
    assert PaginatedResponse(total=21, page=0, size=20).pages == 2
    assert PaginatedResponse(total=5, page=0, size=0).pages == 0


@pytest.mark.parametrize("envelope", ENVELOPES, ids=lambda e: e.__name__)
def test_each_list_response_carries_the_envelope(
    envelope: type[BaseModel],
) -> None:
    assert set(envelope.model_fields) | set(envelope.model_computed_fields) >= (
        PAGE_FIELDS
    )
    assert issubclass(envelope, PaginatedResponse)


@pytest.mark.parametrize("envelope", ENVELOPES, ids=lambda e: e.__name__)
def test_each_list_response_still_reads_from_orm_attributes(
    envelope: type[BaseModel],
) -> None:
    """Inherited from the base -- the subclasses no longer declare it."""
    assert envelope.model_config.get("from_attributes") is True
