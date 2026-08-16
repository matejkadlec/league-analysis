"""Email-change verification state model."""

from datetime import datetime
from typing import Final, override

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class EmailChangeRequest(Base):
    """Stores pending email-change verification state per user."""

    __tablename__ = "email_change_requests"
    __table_args__: Final = {"schema": "auth"}

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Reference to auth.users.id",
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
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this request record was created",
    )
    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this request record was last updated",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of email-change request."""
        return (
            f"<EmailChangeRequest(user_id={self.user_id}, pending_email='{self.pending_email}', "
            f"failed_attempts={self.failed_attempts})>"
        )


Index("idx_email_change_requests_pending_email", EmailChangeRequest.pending_email)
