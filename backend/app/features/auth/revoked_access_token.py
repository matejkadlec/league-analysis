"""Revoked access token model for JWT blacklist support."""

from datetime import datetime
from typing import Final, override

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy import DateTime as SQLDateTime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class RevokedAccessToken(Base):
    """Blacklist entry for access token revocation by token ID (jti)."""

    __tablename__ = "revoked_access_tokens"
    __table_args__: Final = {"schema": "auth"}

    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Auto-incrementing primary key",
    )
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="Reference to auth.users.id",
    )
    token_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        unique=True,
        index=True,
        comment="Revoked access token identifier (jti)",
    )
    revoked_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When the token was revoked",
    )
    expires_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        index=True,
        comment="Original token expiration timestamp",
    )
    reason: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="logout",
        comment="Reason for revocation (logout, admin, security, etc.)",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of revoked token."""
        return f"<RevokedAccessToken(id={self.id}, token_id='{self.token_id}', user_id={self.user_id})>"


Index("idx_revoked_access_tokens_expires_at", RevokedAccessToken.expires_at)
