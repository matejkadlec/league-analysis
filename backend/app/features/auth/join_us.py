"""Join Us contact submissions.

Owns everything about the public contact form except the CAPTCHA decision:
per-subject sequence counters, per-IP rate limiting, anti-spam accounting,
and message delivery. Orchestration stays on `AuthService`, which owns the
CAPTCHA vocabulary both login and Join Us share.
"""

import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .errors import (
    JoinUsEmailDeliveryError,
    JoinUsEmailNotConfiguredError,
    JoinUsRateLimitExceededError,
)
from .join_us_contact_submission import JoinUsContactSubmission
from .mailer import send_smtp_message, smtp_configured
from .schemas import JoinUsSubject
from .subject_counts import SubjectCounts

logger = structlog.get_logger(__name__)

JOIN_US_CONTACT_RECIPIENT = "contact@example.com"
JOIN_US_MIN_BODY_LENGTH = 300
JOIN_US_MAX_REGULAR_PER_HOUR = 3

JOIN_US_SUBJECT_LABELS: dict[JoinUsSubject, str] = {
    JoinUsSubject.BETA_TESTER: "Beta Tester",
    JoinUsSubject.FULL_STACK_DEVELOPER: "Full-Stack Developer",
    JoinUsSubject.OTHER: "Other",
}


async def get_subject_counts_for_update(db: AsyncSession) -> SubjectCounts:
    """Fetch singleton subject counter row with a write lock."""
    result = await db.execute(
        select(SubjectCounts).where(SubjectCounts.id == 1).with_for_update()
    )
    subject_counts = result.scalar_one_or_none()
    if subject_counts is not None:
        return subject_counts

    subject_counts = SubjectCounts(
        id=1,
        beta_tester=0,
        full_stack_developer=0,
        other=0,
    )
    db.add(subject_counts)
    await db.flush()
    return subject_counts


async def reserve_sequence_number(db: AsyncSession, subject: JoinUsSubject) -> int:
    """Increment and persist the per-subject sequence counter."""
    subject_counts = await get_subject_counts_for_update(db)

    if subject == JoinUsSubject.BETA_TESTER:
        subject_counts.beta_tester += 1
        sequence_number = subject_counts.beta_tester
    elif subject == JoinUsSubject.FULL_STACK_DEVELOPER:
        subject_counts.full_stack_developer += 1
        sequence_number = subject_counts.full_stack_developer
    else:
        subject_counts.other += 1
        sequence_number = subject_counts.other

    await db.commit()
    return sequence_number


async def enforce_regular_rate_limit(db: AsyncSession, remote_ip: str | None) -> None:
    """Allow at most N regular submissions per hour for one IP."""
    if not remote_ip:
        return

    now = datetime.now(UTC)
    window_start = now - timedelta(hours=1)

    in_window = (
        JoinUsContactSubmission.remote_ip == remote_ip,
        JoinUsContactSubmission.submitted_at >= window_start,
    )

    recent_count_result = await db.execute(
        select(func.count(JoinUsContactSubmission.id)).where(*in_window)
    )
    recent_count = int(recent_count_result.scalar_one() or 0)
    if recent_count < JOIN_US_MAX_REGULAR_PER_HOUR:
        return

    oldest_in_window_result = await db.execute(
        select(JoinUsContactSubmission.submitted_at)
        .where(*in_window)
        .order_by(JoinUsContactSubmission.submitted_at.asc())
        .limit(1)
    )
    oldest_in_window = oldest_in_window_result.scalar_one_or_none()

    retry_after_seconds = 3600
    if oldest_in_window is not None:
        retry_at = oldest_in_window + timedelta(hours=1)
        retry_after_seconds = max(1, int((retry_at - now).total_seconds()))

    raise JoinUsRateLimitExceededError(retry_after_seconds=retry_after_seconds)


async def record_submission(
    db: AsyncSession,
    *,
    remote_ip: str | None,
    subject: JoinUsSubject,
) -> None:
    """Persist accepted Join Us submissions for anti-spam accounting."""
    if not remote_ip:
        return

    db.add(
        JoinUsContactSubmission(
            remote_ip=remote_ip,
            subject=subject.value,
        )
    )
    await db.commit()


def build_email_subject(subject: JoinUsSubject, *, sequence_number: int) -> str:
    """Build mailbox subject line for Join Us requests."""
    subject_label = JOIN_US_SUBJECT_LABELS[subject]
    return f"League Analysis {subject_label} #{sequence_number}"


async def send_contact_email(
    *,
    subject: JoinUsSubject,
    sequence_number: int,
    body: str,
    remote_ip: str | None,
) -> str:
    """Deliver a Join Us email and return the final email subject line."""
    if not smtp_configured():
        raise JoinUsEmailNotConfiguredError

    subject_line = build_email_subject(subject, sequence_number=sequence_number)
    subject_label = JOIN_US_SUBJECT_LABELS[subject]
    sequence_label = f"#{sequence_number}"
    message_body = (
        "New Join Us submission\n\n"
        f"Position: {subject_label}\n"
        f"Sequence: {sequence_label}\n"
        f"Submitted At (UTC): {datetime.now(UTC).isoformat()}\n"
        f"Remote IP: {remote_ip or 'unknown'}\n\n"
        "Message:\n"
        f"{body}\n"
    )

    message = EmailMessage()
    message["Subject"] = subject_line
    message["To"] = JOIN_US_CONTACT_RECIPIENT
    message.set_content(message_body)

    try:
        await send_smtp_message(message)
    except (smtplib.SMTPException, OSError) as e:
        logger.error("join_us_email_delivery_failed", error=str(e))
        raise JoinUsEmailDeliveryError from e

    return subject_line
