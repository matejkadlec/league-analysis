"""Persisted per-match LP observation regressions."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.features.matches.match_lp import (
    LP_SOURCE_OBSERVED,
    LP_SOURCE_REMAKE,
    LP_SOURCE_UNAVAILABLE,
    attribute_lp_change,
    initialize_participant_lp,
    persist_match_lp_observations,
)

BASE_TIME = datetime(2026, 8, 15, 12, tzinfo=UTC)


def _snapshot(
    *,
    created_at: datetime,
    lp: int,
    wins: int,
    losses: int,
    tier: str = "GOLD",
    rank: str = "II",
) -> SimpleNamespace:
    return SimpleNamespace(
        created_at=created_at,
        league_points=lp,
        wins=wins,
        losses=losses,
        tier=tier,
        rank=rank,
    )


def _participant(*, win: bool, remake: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        match_id="EUN1_123",
        win=win,
        remake=remake,
        lp_change=None,
        lp_change_source=None,
        lp_change_reason=None,
        lp_before_snapshot_at=None,
        lp_after_snapshot_at=None,
    )


def _match(*, queue_id: int = 420, minutes_after: int = 30) -> SimpleNamespace:
    end = BASE_TIME + timedelta(minutes=minutes_after)
    return SimpleNamespace(
        match_id="EUN1_123",
        queue_id=queue_id,
        game_end_timestamp=int(end.timestamp() * 1000),
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
        _participant(win=win),  # type: ignore[arg-type]
        _match(),  # type: ignore[arg-type]
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
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
        _participant(win=True),  # type: ignore[arg-type]
        _match(),  # type: ignore[arg-type]
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
        progression_match_count=2,
    )
    remake = attribute_lp_change(
        _participant(win=False, remake=True),  # type: ignore[arg-type]
        _match(),  # type: ignore[arg-type]
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
        progression_match_count=2,
    )
    loss = attribute_lp_change(
        _participant(win=False),  # type: ignore[arg-type]
        _match(),  # type: ignore[arg-type]
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
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
    before: SimpleNamespace | None,
    after: SimpleNamespace | None,
    match: SimpleNamespace,
    expected_reason: str,
) -> None:
    result = attribute_lp_change(
        _participant(win=True),  # type: ignore[arg-type]
        match,  # type: ignore[arg-type]
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
        progression_match_count=1,
    )

    assert result.change is None
    assert result.source == LP_SOURCE_UNAVAILABLE
    assert result.reason == expected_reason


def test_lp_initialization_preserves_an_observation_during_reprocessing() -> None:
    participant = _participant(win=True)
    initialize_participant_lp(  # type: ignore[arg-type]
        participant,
        queue_id=420,
        remake=False,
    )
    assert participant.lp_change_source == LP_SOURCE_UNAVAILABLE

    participant.lp_change = 18
    participant.lp_change_source = LP_SOURCE_OBSERVED
    participant.lp_change_reason = "single_match_counter_transition"
    initialize_participant_lp(  # type: ignore[arg-type]
        participant,
        queue_id=420,
        remake=False,
    )

    assert participant.lp_change == 18
    assert participant.lp_change_source == LP_SOURCE_OBSERVED


class _RowsResult:
    def __init__(self, rows: list[tuple[object, object]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[object, object]]:
        return self._rows


class _ObservationSession:
    def __init__(self, rows: list[tuple[object, object]]) -> None:
        self.rows = rows

    async def execute(self, _statement: object) -> _RowsResult:
        return _RowsResult(self.rows)


@pytest.mark.asyncio
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
    session = _ObservationSession([(participant, match)])

    first = await persist_match_lp_observations(
        session,  # type: ignore[arg-type]
        "player-puuid",
        [match.match_id],
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
    )
    second = await persist_match_lp_observations(
        session,  # type: ignore[arg-type]
        "player-puuid",
        [match.match_id],
        before,  # type: ignore[arg-type]
        after,  # type: ignore[arg-type]
    )

    assert first == 1
    assert second == 0
    assert participant.lp_change == 18
