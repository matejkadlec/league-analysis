"""The email-change request/verify/apply flow, asserted by running it.

Real statements run against in-memory SQLite with `auth` attached as a schema,
so the lockout and expiry predicates are exercised; only SMTP is replaced.
"""

import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import Engine, Table, create_engine, event
from sqlalchemy.orm import Session

from app.features.auth import mailer as mailer_module
from app.features.auth.email_change import email_change_service as email_change_module
from app.features.auth.email_change.email_change_request import EmailChangeRequest
from app.features.auth.email_change.email_change_service import (
    EMAIL_CHANGE_CODE_EXPIRY_MINUTES,
    EMAIL_CHANGE_LOCK_MINUTES,
    EMAIL_CHANGE_MAX_FAILED_ATTEMPTS,
    EmailChangeMixin,
)
from app.features.auth.errors import (
    EmailAlreadyRegisteredError,
    EmailChangeLockedError,
    EmailUnchangedError,
    EmailVerificationCodeExpiredError,
    EmailVerificationRequestNotFoundError,
    InvalidEmailVerificationCodeError,
)
from app.features.auth.service import AuthService
from app.features.auth.users.models import User

_CODE_IN_BODY = re.compile(r"code is: (\d{6})")


class _SyncSessionShim:
    """The async surface the email-change flow uses, over a sync session."""

    def __init__(self, session: Session) -> None:
        self._session = session

    async def execute(self, statement: Any) -> Any:
        return self._session.execute(statement)

    def add(self, instance: Any) -> None:
        # `AsyncSession.add` is synchronous, and so is the mixin's call to it.
        self._session.add(instance)

    async def flush(self) -> None:
        self._session.flush()

    async def commit(self) -> None:
        self._session.commit()

    async def refresh(self, instance: Any) -> None:
        self._session.refresh(instance)


@pytest.fixture
def session() -> Iterator[Session]:
    engine: Engine = create_engine("sqlite://")

    def _attach_auth_schema(dbapi_connection: Any, _record: Any) -> None:
        # Both models live in the `auth` schema; SQLite reaches one by name
        # only if a database is attached under it.
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS auth")

    def _as_utc(target: EmailChangeRequest, _context: Any) -> None:
        # The flow compares `locked_until` and `code_expires_at` against an
        # aware `now()`; SQLite hands back what it stored, without the offset.
        for field in ("code_expires_at", "locked_until"):
            stored = getattr(target, field)
            if stored is not None and stored.tzinfo is None:
                setattr(target, field, stored.replace(tzinfo=UTC))

    def _as_utc_on_refresh(
        target: EmailChangeRequest, context: Any, _attrs: Any
    ) -> None:
        # `load` fires once per instance; the request row is created and
        # re-read within one session, so its later reads go through `refresh`.
        _as_utc(target, context)

    event.listen(engine, "connect", _attach_auth_schema)
    event.listen(EmailChangeRequest, "load", _as_utc)
    event.listen(EmailChangeRequest, "refresh", _as_utc_on_refresh)
    cast(Table, User.__table__).create(engine)
    cast(Table, EmailChangeRequest.__table__).create(engine)
    with Session(engine) as open_session:
        yield open_session
    event.remove(EmailChangeRequest, "load", _as_utc)
    event.remove(EmailChangeRequest, "refresh", _as_utc_on_refresh)
    engine.dispose()


@pytest.fixture
def sent_messages(
    monkeypatch: pytest.MonkeyPatch,
) -> list[EmailMessage]:
    """Configure SMTP at the settings reader and record each sent message.

    `get_global_settings` is substituted in the mailer module, and the blocking
    send where the email-change service imported it.
    """
    monkeypatch.setattr(
        mailer_module,
        "get_global_settings",
        lambda: SimpleNamespace(smtp_host="smtp.test", smtp_from_email="noreply@test"),
    )
    messages: list[EmailMessage] = []

    async def _record(message: EmailMessage) -> None:
        messages.append(message)

    monkeypatch.setattr(email_change_module, "send_smtp_message", _record)
    return messages


def _store_user(
    session: Session,
    *,
    user_id: int = 1,
    email: str = "player@example.com",
) -> User:
    # SQLite does not autoincrement a BIGINT primary key.
    user = User(
        id=user_id,
        email=email,
        password_hash="not-a-real-hash",
        display_name="Player",
        email_verified=False,
    )
    session.add(user)
    session.commit()
    return cast(User, session.get(User, user_id))


def _service(session: Session) -> EmailChangeMixin:
    return AuthService(cast(Any, _SyncSessionShim(session)))


def _request(session: Session) -> EmailChangeRequest:
    """The pending-request row, whatever state it is in now."""
    row = session.query(EmailChangeRequest).one()
    return row


def _code_from(message: EmailMessage) -> str:
    """The one-time code exactly as the recipient would read it."""
    match = _CODE_IN_BODY.search(message.get_content())
    assert match is not None, message.get_content()
    return match.group(1)


def _wrong_code_for(code: str) -> str:
    """A syntactically valid code guaranteed different from the real one."""
    return "000000" if code != "000000" else "111111"


def _backdate(session: Session, field: str, moment: datetime) -> None:
    row = _request(session)
    setattr(row, field, moment)
    session.commit()


async def test_a_request_stores_one_hashed_code_per_user_and_emails_it(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """One row per user, replaced on re-request; the email carries the code."""
    user = _store_user(session)
    service = _service(session)
    now = datetime.now(UTC)

    expires_at = await service.request_email_change_code(
        current_user=user, new_email="  New@Example.COM "
    )

    assert (
        timedelta(minutes=EMAIL_CHANGE_CODE_EXPIRY_MINUTES, seconds=-1)
        <= expires_at - now
        <= timedelta(minutes=EMAIL_CHANGE_CODE_EXPIRY_MINUTES, seconds=1)
    )
    assert len(sent_messages) == 1
    message = sent_messages[0]
    assert message["To"] == "new@example.com"
    assert message["Subject"] == "League Analysis - Verify Your New Email"
    code = _code_from(message)

    row = _request(session)
    assert row.pending_email == "new@example.com"
    assert row.verification_code_hash == service._hash_email_verification_code(code)
    assert row.code_expires_at == expires_at
    assert row.failed_attempts == 0
    assert row.locked_until is None

    await service.request_email_change_code(
        current_user=user, new_email="newer@example.com"
    )

    assert len(sent_messages) == 2
    assert session.query(EmailChangeRequest).count() == 1
    row = _request(session)
    assert row.pending_email == "newer@example.com"
    assert row.verification_code_hash == service._hash_email_verification_code(
        _code_from(sent_messages[1])
    )


async def test_a_request_refuses_the_current_and_an_occupied_email(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """Both refusals happen before a code is sent or a row is created."""
    user = _store_user(session)
    _store_user(session, user_id=2, email="taken@example.com")
    service = _service(session)

    with pytest.raises(EmailUnchangedError):
        await service.request_email_change_code(
            current_user=user, new_email="PLAYER@example.com"
        )
    with pytest.raises(EmailAlreadyRegisteredError):
        await service.request_email_change_code(
            current_user=user, new_email="Taken@Example.com"
        )

    assert sent_messages == []
    assert session.query(EmailChangeRequest).count() == 0


async def test_the_emailed_code_applies_the_change_and_consumes_the_request(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """The code from the mail is the one that verifies; it works exactly once."""
    user = _store_user(session)
    service = _service(session)
    await service.request_email_change_code(
        current_user=user, new_email="new@example.com"
    )
    code = _code_from(sent_messages[0])

    updated = await service.verify_email_change_code(current_user=user, code=code)

    assert updated.email == "new@example.com"
    assert updated.email_verified is True
    assert updated.email_verified_at is not None
    row = _request(session)
    assert row.pending_email is None
    assert row.verification_code_hash is None
    assert row.code_expires_at is None
    assert row.failed_attempts == 0
    assert row.locked_until is None

    with pytest.raises(EmailVerificationRequestNotFoundError):
        await service.verify_email_change_code(current_user=updated, code=code)


async def test_verifying_without_any_pending_request_is_refused(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    user = _store_user(session)

    with pytest.raises(EmailVerificationRequestNotFoundError):
        await _service(session).verify_email_change_code(
            current_user=user, code="123456"
        )


async def test_each_wrong_code_counts_and_still_leaves_the_real_one_usable(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """Two failures are survivable: the counter climbs, the code does not die."""
    user = _store_user(session)
    service = _service(session)
    await service.request_email_change_code(
        current_user=user, new_email="new@example.com"
    )
    wrong = _wrong_code_for(_code_from(sent_messages[0]))

    with pytest.raises(InvalidEmailVerificationCodeError) as first:
        await service.verify_email_change_code(current_user=user, code=wrong)
    assert first.value.attempts_remaining == 2
    assert _request(session).failed_attempts == 1

    with pytest.raises(InvalidEmailVerificationCodeError) as second:
        await service.verify_email_change_code(current_user=user, code=wrong)
    assert second.value.attempts_remaining == 1
    assert _request(session).failed_attempts == 2

    updated = await service.verify_email_change_code(
        current_user=user, code=_code_from(sent_messages[0])
    )
    assert updated.email == "new@example.com"
    assert _request(session).failed_attempts == 0


async def test_the_configured_third_wrong_code_locks_and_clears_the_request(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """Reaching the ceiling wipes the pending code and starts the lock clock."""
    assert EMAIL_CHANGE_MAX_FAILED_ATTEMPTS == 3

    user = _store_user(session)
    service = _service(session)
    await service.request_email_change_code(
        current_user=user, new_email="new@example.com"
    )
    wrong = _wrong_code_for(_code_from(sent_messages[0]))
    now = datetime.now(UTC)

    for _ in range(EMAIL_CHANGE_MAX_FAILED_ATTEMPTS - 1):
        with pytest.raises(InvalidEmailVerificationCodeError):
            await service.verify_email_change_code(current_user=user, code=wrong)

    with pytest.raises(EmailChangeLockedError) as caught:
        await service.verify_email_change_code(current_user=user, code=wrong)

    assert (
        timedelta(minutes=EMAIL_CHANGE_LOCK_MINUTES, seconds=-1)
        <= caught.value.locked_until - now
        <= timedelta(minutes=EMAIL_CHANGE_LOCK_MINUTES, seconds=1)
    )
    row = _request(session)
    assert row.pending_email is None
    assert row.verification_code_hash is None
    assert row.code_expires_at is None
    assert row.failed_attempts == 0
    assert row.locked_until is not None


async def test_a_locked_user_cannot_request_or_verify_until_the_lock_expires(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """Both actions are refused while the lock holds, and neither outlives it."""
    user = _store_user(session)
    service = _service(session)
    await service.request_email_change_code(
        current_user=user, new_email="new@example.com"
    )
    wrong = _wrong_code_for(_code_from(sent_messages[0]))
    for remaining in range(EMAIL_CHANGE_MAX_FAILED_ATTEMPTS - 1, 0, -1):
        with pytest.raises(InvalidEmailVerificationCodeError) as failure:
            await service.verify_email_change_code(current_user=user, code=wrong)
        assert failure.value.attempts_remaining == remaining
    with pytest.raises(EmailChangeLockedError):
        await service.verify_email_change_code(current_user=user, code=wrong)

    with pytest.raises(EmailChangeLockedError):
        await service.request_email_change_code(
            current_user=user, new_email="another@example.com"
        )
    with pytest.raises(EmailChangeLockedError):
        await service.verify_email_change_code(current_user=user, code="123456")
    assert len(sent_messages) == 1

    _backdate(session, "locked_until", datetime.now(UTC) - timedelta(seconds=1))

    await service.request_email_change_code(
        current_user=user, new_email="another@example.com"
    )
    assert len(sent_messages) == 2
    assert _request(session).locked_until is None

    updated = await service.verify_email_change_code(
        current_user=user, code=_code_from(sent_messages[1])
    )
    assert updated.email == "another@example.com"


async def test_an_expired_code_is_refused_and_cleared(
    session: Session, sent_messages: list[EmailMessage]
) -> None:
    """Past its expiry the right code no longer verifies; the row is emptied."""
    user = _store_user(session)
    service = _service(session)
    await service.request_email_change_code(
        current_user=user, new_email="new@example.com"
    )
    code = _code_from(sent_messages[0])

    _backdate(session, "code_expires_at", datetime.now(UTC) - timedelta(seconds=1))

    with pytest.raises(EmailVerificationCodeExpiredError):
        await service.verify_email_change_code(current_user=user, code=code)

    row = _request(session)
    assert row.verification_code_hash is None
    assert row.code_expires_at is None
    assert row.failed_attempts == 0

    with pytest.raises(EmailVerificationRequestNotFoundError):
        await service.verify_email_change_code(current_user=user, code=code)
