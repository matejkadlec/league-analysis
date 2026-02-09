"""Refresh token model for rotating long-lived sessions."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime as SQLDateTime,
    ForeignKey,
    Index,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class RefreshToken(Base):
    """Refresh token storage for session rotation and revocation."""

    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": "auth"}

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
        comment="Public token identifier (JWT-style jti equivalent)",
    )
    token_hash: Mapped[str] = mapped_column(
        String,
        nullable=False,
        unique=True,
        comment="SHA-256 hash of the raw refresh token",
    )
    issued_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When the refresh token was issued",
    )
    expires_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        index=True,
        comment="Refresh token expiration timestamp",
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="When token was revoked (NULL means active)",
    )
    replaced_by_token_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        nullable=True,
        comment="Token ID that replaced this token during rotation",
    )
    created_from_ip: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
        comment="Source IP address when token was created",
    )
    user_agent: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Request user-agent when token was created",
    )

    def __repr__(self) -> str:
        """Return string representation of refresh token."""
        return f"<RefreshToken(id={self.id}, user_id={self.user_id}, token_id='{self.token_id}')>"


Index("idx_refresh_tokens_user_active", RefreshToken.user_id, RefreshToken.revoked_at)
