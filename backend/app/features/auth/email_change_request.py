"""Email-change verification state model."""

from datetime import datetime
from typing import Final

from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column, updated_at_column

from .user_reference import user_id_column


class EmailChangeRequest(Base):
    """Stores pending email-change verification state per user."""

    __tablename__ = "email_change_requests"
    __table_args__: Final = {"schema": "auth"}

    user_id: Mapped[int] = user_id_column(
        "Reference to auth.users.id", primary_key=True
    )
    pending_email: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Unverified target email awaiting code confirmation",
    )
    verification_code_hash: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        comment="SHA-256 hash of the 6-digit verification code",
    )
    code_expires_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Verification code expiration timestamp",
    )
    failed_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Consecutive failed verification attempts for current code",
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Email-change lock expiration after too many failed attempts",
    )
    created_at: Mapped[datetime] = created_at_column(
        "When this request record was created"
    )
    updated_at: Mapped[datetime] = updated_at_column(
        "When this request record was last updated"
    )


Index("idx_email_change_requests_pending_email", EmailChangeRequest.pending_email)
