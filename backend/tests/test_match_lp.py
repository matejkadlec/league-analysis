"""Persisted per-match LP observation regressions."""

import os
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.matches.match_lp import (
    LP_SOURCE_OBSERVED,
    LP_SOURCE_REMAKE,
    LP_SOURCE_UNAVAILABLE,
    attribute_lp_change,
    initialize_participant_lp,
    league_snapshot_datetime,
    persist_match_lp_observations,
)
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.players.leagues import PlayerLeague

BASE_TIME = datetime(2026, 8, 15, 12, tzinfo=UTC)

# The three doubles below mirror one column group each, with the column's own
# `Mapped[...]` type. Real ORM instances are not usable here: constructing one
# configures every mapper, dragging the model universe into an arithmetic test.


@dataclass
class _LeagueSnapshot:
    """The `PlayerLeague` columns LP attribution reads."""

    created_at: datetime
    league_points: int
    wins: int
    losses: int
    tier: str
    rank: str | None


@dataclass
class _Participant:
    """The `MatchParticipant` columns LP attribution reads and writes."""

    match_id: str
    win: bool
    remake: bool
    lp_change: int | None
    lp_change_source: str | None
    lp_change_reason: str | None
    lp_before_snapshot_at: datetime | None
    lp_after_snapshot_at: datetime | None


@dataclass
class _Match:
    """The `Match` columns LP attribution reads."""

    match_id: str
    queue_id: int
    game_end_timestamp: int | None


def _snapshot(
    *,
    created_at: datetime,
    lp: int,
    wins: int,
    losses: int,
    tier: str = "GOLD",
    rank: str = "II",
) -> PlayerLeague:
    return cast(
        PlayerLeague,
        _LeagueSnapshot(
            created_at=created_at,
            league_points=lp,
            wins=wins,
            losses=losses,
            tier=tier,
            rank=rank,
        ),
    )


def _participant(*, win: bool, remake: bool = False) -> MatchParticipant:
    return cast(
        MatchParticipant,
        _Participant(
            match_id="EUN1_123",
            win=win,
            remake=remake,
            lp_change=None,
            lp_change_source=None,
            lp_change_reason=None,
            lp_before_snapshot_at=None,
            lp_after_snapshot_at=None,
        ),
    )


def _match(*, queue_id: int = 420, minutes_after: int = 30) -> Match:
    end = BASE_TIME + timedelta(minutes=minutes_after)
    return cast(
        Match,
        _Match(
            match_id="EUN1_123",
            queue_id=queue_id,
            game_end_timestamp=int(end.timestamp() * 1000),
        ),
    )


@pytest.mark.parametrize(
    ("win", "before_lp", "after_lp", "wins", "losses", "expected"),
    [
        (True, 40, 58, (10, 11), (8, 8), 18),
        (False, 40, 24, (10, 10), (8, 9), -16),
    ],
)
def test_single_match_counter_transition_has_exact_signed_lp(
    win: bool,
    before_lp: int,
    after_lp: int,
    wins: tuple[int, int],
    losses: tuple[int, int],
    expected: int,
) -> None:
    before = _snapshot(
        created_at=BASE_TIME,
        lp=before_lp,
        wins=wins[0],
        losses=losses[0],
    )
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=after_lp,
        wins=wins[1],
        losses=losses[1],
    )

    result = attribute_lp_change(
        _participant(win=win),
        _match(),
        before,
        after,
        progression_match_count=1,
    )

    assert result.change == expected
    assert result.source == LP_SOURCE_OBSERVED


def test_win_remake_loss_batch_keeps_only_the_remake_certain() -> None:
    before = _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8)
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=42,
        wins=11,
        losses=9,
    )
    win = attribute_lp_change(
        _participant(win=True),
        _match(),
        before,
        after,
        progression_match_count=2,
    )
    remake = attribute_lp_change(
        _participant(win=False, remake=True),
        _match(),
        before,
        after,
        progression_match_count=2,
    )
    loss = attribute_lp_change(
        _participant(win=False),
        _match(),
        before,
        after,
        progression_match_count=2,
    )

    assert (win.change, win.reason) == (None, "ambiguous_progression_batch")
    assert (remake.change, remake.source) == (0, LP_SOURCE_REMAKE)
    assert (loss.change, loss.reason) == (None, "ambiguous_progression_batch")


@pytest.mark.parametrize(
    ("before", "after", "match", "expected_reason"),
    [
        (None, None, _match(), "missing_before_snapshot"),
        (
            _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8),
            _snapshot(
                created_at=BASE_TIME + timedelta(hours=1),
                lp=58,
                wins=12,
                losses=8,
            ),
            _match(),
            "counter_mismatch",
        ),
        (
            _snapshot(created_at=BASE_TIME, lp=90, wins=10, losses=8),
            _snapshot(
                created_at=BASE_TIME + timedelta(hours=1),
                lp=8,
                wins=11,
                losses=8,
                rank="I",
            ),
            _match(),
            "rank_boundary",
        ),
        (
            _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8),
            _snapshot(
                created_at=BASE_TIME + timedelta(hours=1),
                lp=58,
                wins=11,
                losses=8,
            ),
            _match(queue_id=440),
            "not_ranked_solo",
        ),
    ],
)
def test_unprovable_lp_transitions_remain_unavailable(
    before: PlayerLeague | None,
    after: PlayerLeague | None,
    match: Match,
    expected_reason: str,
) -> None:
    result = attribute_lp_change(
        _participant(win=True),
        match,
        before,
        after,
        progression_match_count=1,
    )

    assert result.change is None
    assert result.source == LP_SOURCE_UNAVAILABLE
    assert result.reason == expected_reason


def test_lp_initialization_preserves_an_observation_during_reprocessing() -> None:
    participant = _participant(win=True)
    initialize_participant_lp(
        participant,
        queue_id=420,
        remake=False,
    )
    assert participant.lp_change_source == LP_SOURCE_UNAVAILABLE

    participant.lp_change = 18
    participant.lp_change_source = LP_SOURCE_OBSERVED
    participant.lp_change_reason = "single_match_counter_transition"
    initialize_participant_lp(
        participant,
        queue_id=420,
        remake=False,
    )

    assert participant.lp_change == 18
    assert participant.lp_change_source == LP_SOURCE_OBSERVED


class _RowsResult:
    def __init__(self, rows: list[tuple[MatchParticipant, Match]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[MatchParticipant, Match]]:
        return self._rows


class _ObservationSession:
    def __init__(self, rows: list[tuple[MatchParticipant, Match]]) -> None:
        self.rows = rows

    async def execute(self, _statement: object) -> _RowsResult:
        return _RowsResult(self.rows)


async def test_persisted_observation_is_idempotent_on_retry() -> None:
    participant = _participant(win=True)
    match = _match()
    before = _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8)
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=58,
        wins=11,
        losses=8,
    )
    # The double answers the one `execute` the function makes with fixed rows;
    # `AsyncSession` is too large to implement, so the seam is a named cast.
    session = cast(AsyncSession, _ObservationSession([(participant, match)]))

    first = await persist_match_lp_observations(
        session,
        "player-puuid",
        [match.match_id],
        before,
        after,
    )
    second = await persist_match_lp_observations(
        session,
        "player-puuid",
        [match.match_id],
        before,
        after,
    )

    assert first == 1
    assert second == 0
    assert participant.lp_change == 18


def test_a_win_that_lost_lp_is_refused_rather_than_recorded() -> None:
    """A signed LP change must agree with the result it is attached to.

    The counters can transition by exactly one while the LP moved the other
    way -- a decay, a promotion adjustment, or a snapshot pair spanning more
    than one match. Persisting it puts a negative LP change on a victory.
    """
    before = _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8)
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=24,
        wins=11,
        losses=8,
    )

    result = attribute_lp_change(
        _participant(win=True),
        _match(),
        before,
        after,
        progression_match_count=1,
    )

    assert result.change is None
    assert result.source == LP_SOURCE_UNAVAILABLE
    assert result.reason == "invalid_result_direction"


@pytest.mark.parametrize(
    "minutes_after",
    [
        # Ended before the earlier snapshot was taken.
        -30,
        # Ended after the later one.
        120,
    ],
)
def test_a_match_outside_the_snapshot_pair_proves_nothing(
    minutes_after: int,
) -> None:
    """LP is only attributable when the two snapshots bracket the match.

    Both snapshots and the counters can look perfect while the match happened
    outside them -- the LP then belongs to some other game in the window. The
    bracket is what makes the attribution a proof instead of a guess.
    """
    before = _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8)
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=58,
        wins=11,
        losses=8,
    )

    result = attribute_lp_change(
        _participant(win=True),
        _match(minutes_after=minutes_after),
        before,
        after,
        progression_match_count=1,
    )

    assert result.change is None
    assert result.reason == "outside_snapshot_window"


def test_a_win_and_a_loss_between_snapshots_prove_neither() -> None:
    """Both counters moving means the window holds more than this match.

    `progression_match_count` only counts the matches in the batch being
    persisted, not the games between the two snapshots. Requiring the *other*
    counter to have stayed still refuses a window holding a win and a loss.
    """
    before = _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8)
    after = _snapshot(
        created_at=BASE_TIME + timedelta(hours=1),
        lp=50,
        wins=11,
        losses=9,
    )

    result = attribute_lp_change(
        _participant(win=True),
        _match(),
        before,
        after,
        progression_match_count=1,
    )

    assert result.change is None
    assert result.reason == "counter_mismatch"


def test_a_missing_later_snapshot_is_named_as_such() -> None:
    """The two missing-snapshot refusals are distinct and both are recorded.

    `lp_change_reason` is the only record of why a match has no LP, and a
    pending after-snapshot is recoverable on the next league sync while other
    refusals are not. Collapsing the two loses that distinction.
    """
    result = attribute_lp_change(
        _participant(win=True),
        _match(),
        _snapshot(created_at=BASE_TIME, lp=40, wins=10, losses=8),
        None,
        progression_match_count=1,
    )

    assert result.change is None
    assert result.reason == "missing_after_snapshot"


def test_a_remake_is_initialized_as_a_certain_zero() -> None:
    """A remake's LP is known to be zero before any league snapshot arrives.

    Riot marks it ineligible for progression, so nothing was won or lost.
    Left pending, the next observation window sees an unattributed match and
    a real LP change from a different game can land on it.
    """
    participant = _participant(win=False, remake=True)

    initialize_participant_lp(participant, queue_id=420, remake=True)

    assert participant.lp_change == 0
    assert participant.lp_change_source == LP_SOURCE_REMAKE
    assert participant.lp_change_reason == "riot_eligible_for_progression_false"


@pytest.fixture
def clock_far_from_utc() -> Iterator[None]:
    """Run a test under a zone 14 hours from UTC, then restore the real one.

    The gate container runs UTC, so a bug that reads a stored timestamp in
    local time is invisible there and wrong by hours on the Prague host.
    Forcing a zone makes the difference observable wherever the suite runs.
    """
    previous = os.environ.get("TZ")
    os.environ["TZ"] = "Pacific/Kiritimati"
    time.tzset()
    try:
        yield
    finally:
        if previous is None:
            del os.environ["TZ"]
        else:
            os.environ["TZ"] = previous
        time.tzset()


def test_a_stored_timestamp_without_a_zone_is_read_as_utc(
    clock_far_from_utc: None,
) -> None:
    """A naive league timestamp means UTC, not whatever zone the host is in.

    Every other time in this module is UTC, and the comparison that decides
    whether a match sits between two snapshots mixes them. Reading a naive
    value as local time silently moves matches in and out of the window.
    """
    del clock_far_from_utc
    naive = _snapshot(
        created_at=datetime(2026, 8, 15, 12),
        lp=40,
        wins=10,
        losses=8,
    )

    assert league_snapshot_datetime(naive) == datetime(2026, 8, 15, 12, tzinfo=UTC)
