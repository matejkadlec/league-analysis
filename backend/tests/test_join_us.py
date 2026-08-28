"""What the Join Us pipeline itself owns, behind `AuthService`.

`AuthService` keeps the CAPTCHA vocabulary; this file pins the parts the
`join_us` module owns: the per-subject sequence counters, the per-IP hourly
budget, and the message that actually leaves for the mailbox.
"""

import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.errors import (
    JoinUsEmailDeliveryError,
    JoinUsEmailNotConfiguredError,
    JoinUsRateLimitExceededError,
)
from app.features.auth.join_us import join_us
from app.features.auth.join_us.join_us import (
    JOIN_US_CONTACT_RECIPIENT,
    JOIN_US_MAX_REGULAR_PER_HOUR,
    build_email_subject,
    enforce_regular_rate_limit,
    reserve_sequence_number,
    send_contact_email,
)
from app.features.auth.join_us.subject_counts import SubjectCounts
from app.features.auth.schemas import JoinUsSubject


class _CountSession:
    """A session answering the locked singleton read with a scripted row."""

    def __init__(self, row: SubjectCounts | None) -> None:
        self.row = row
        self.added: list[SubjectCounts] = []
        self.committed = False

    async def execute(self, *_args: object, **_kwargs: object) -> object:
        return SimpleNamespace(scalar_one_or_none=lambda: self.row)

    def add(self, obj: SubjectCounts) -> None:
        self.added.append(obj)

    async def flush(self) -> None:
        return None

    async def commit(self) -> None:
        self.committed = True


def _counts(**values: int) -> SubjectCounts:
    return SubjectCounts(
        id=1,
        beta_tester=values.get("beta_tester", 0),
        full_stack_developer=values.get("full_stack_developer", 0),
        other=values.get("other", 0),
    )


@pytest.mark.parametrize(
    ("subject", "field"),
    [
        (JoinUsSubject.BETA_TESTER, "beta_tester"),
        (JoinUsSubject.FULL_STACK_DEVELOPER, "full_stack_developer"),
        (JoinUsSubject.OTHER, "other"),
    ],
)
async def test_each_subject_advances_only_its_own_counter(
    subject: JoinUsSubject, field: str
) -> None:
    """The three mailbox threads number independently, from one shared row."""
    session = _CountSession(_counts(beta_tester=4, full_stack_developer=4, other=4))

    number = await reserve_sequence_number(cast(AsyncSession, session), subject)

    assert number == 5
    row = session.row
    assert row is not None
    assert getattr(row, field) == 5
    assert session.committed
    assert session.added == [], "an existing singleton row is never re-created"


async def test_a_missing_singleton_row_is_created_and_counted_from_one() -> None:
    session = _CountSession(None)

    number = await reserve_sequence_number(
        cast(AsyncSession, session), JoinUsSubject.OTHER
    )

    assert number == 1
    assert len(session.added) == 1
    assert session.added[0].other == 1
    assert session.committed


class _RateLimitSession:
    """A session answering the window count, then the oldest timestamp."""

    def __init__(self, answers: list[object]) -> None:
        self.answers = list(answers)
        self.queries = 0

    async def execute(self, *_args: object, **_kwargs: object) -> object:
        self.queries += 1
        value = self.answers.pop(0)
        return SimpleNamespace(
            scalar_one=lambda: value, scalar_one_or_none=lambda: value
        )


async def test_an_addressless_submission_is_never_throttled() -> None:
    """No IP means no budget to police, and no query spent asking."""
    session = _RateLimitSession([])

    await enforce_regular_rate_limit(cast(AsyncSession, session), None)

    assert session.queries == 0


async def test_a_window_below_the_budget_costs_a_single_count() -> None:
    session = _RateLimitSession([JOIN_US_MAX_REGULAR_PER_HOUR - 1])

    await enforce_regular_rate_limit(cast(AsyncSession, session), "203.0.113.9")

    # One count suffices: the oldest-timestamp lookup only runs on a refusal.
    assert session.queries == 1


async def test_a_refusal_quotes_the_oldest_submission_plus_an_hour() -> None:
    """The retry time comes from when the first window entry falls out of it."""
    ten_minutes_ago = datetime.now(UTC) - timedelta(minutes=10)
    session = _RateLimitSession([JOIN_US_MAX_REGULAR_PER_HOUR, ten_minutes_ago])

    with pytest.raises(JoinUsRateLimitExceededError) as caught:
        await enforce_regular_rate_limit(cast(AsyncSession, session), "203.0.113.9")

    assert caught.value.retry_after_seconds == pytest.approx(50 * 60, abs=2)
    assert session.queries == 2


@pytest.mark.parametrize(
    ("subject", "label"),
    [
        (JoinUsSubject.BETA_TESTER, "Beta Tester"),
        (JoinUsSubject.FULL_STACK_DEVELOPER, "Full-Stack Developer"),
        (JoinUsSubject.OTHER, "Other"),
    ],
)
def test_subject_lines_carry_the_position_and_the_sequence(
    subject: JoinUsSubject, label: str
) -> None:
    assert build_email_subject(subject, sequence_number=7) == (
        f"League Analysis {label} #7"
    )


async def test_unconfigured_delivery_refuses_rather_than_sending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(join_us, "smtp_configured", lambda: False)

    async def _must_not_send(_message: EmailMessage) -> None:
        raise AssertionError("no message may leave an unconfigured transport")

    monkeypatch.setattr(join_us, "send_smtp_message", _must_not_send)

    with pytest.raises(JoinUsEmailNotConfiguredError):
        await send_contact_email(
            subject=JoinUsSubject.OTHER,
            sequence_number=1,
            body="hello",
            remote_ip=None,
        )


async def test_the_delivered_message_carries_the_submission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Position, sequence, sender IP and body all ride the one message."""
    monkeypatch.setattr(join_us, "smtp_configured", lambda: True)
    sent: list[EmailMessage] = []

    async def _capture(message: EmailMessage) -> None:
        sent.append(message)

    monkeypatch.setattr(join_us, "send_smtp_message", _capture)

    subject_line = await send_contact_email(
        subject=JoinUsSubject.FULL_STACK_DEVELOPER,
        sequence_number=4,
        body="please consider my application",
        remote_ip="203.0.113.9",
    )

    assert subject_line == "League Analysis Full-Stack Developer #4"
    assert len(sent) == 1
    message = sent[0]
    assert message["To"] == JOIN_US_CONTACT_RECIPIENT
    assert message["Subject"] == subject_line
    body = message.get_content()
    assert "Position: Full-Stack Developer" in body
    assert "Sequence: #4" in body
    assert "Remote IP: 203.0.113.9" in body
    assert "please consider my application" in body


@pytest.mark.parametrize(
    "failure",
    [smtplib.SMTPException("relay refused"), OSError("connection reset")],
    ids=["smtp", "os"],
)
async def test_a_transport_failure_becomes_a_named_delivery_error(
    monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    monkeypatch.setattr(join_us, "smtp_configured", lambda: True)

    async def _fail(_message: EmailMessage) -> None:
        raise failure

    monkeypatch.setattr(join_us, "send_smtp_message", _fail)

    with pytest.raises(JoinUsEmailDeliveryError) as caught:
        await send_contact_email(
            subject=JoinUsSubject.BETA_TESTER,
            sequence_number=2,
            body="hello",
            remote_ip=None,
        )

    assert caught.value.__cause__ is failure
