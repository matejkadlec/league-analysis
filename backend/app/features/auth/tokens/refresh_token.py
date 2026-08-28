"""Refresh token model for rotating long-lived sessions."""

from datetime import datetime
from typing import Final

from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Index,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base, id_column
from app.features.auth.users.user_reference import user_id_column


class RefreshToken(Base):
    """Refresh token storage for session rotation and revocation."""

    __tablename__ = "refresh_tokens"
    __table_args__: Final = {"schema": "auth"}

    id: Mapped[int] = id_column()
    user_id: Mapped[int] = user_id_column("Reference to auth.users.id")
    token_id: Mapped[str] = mapped_column(
        String(36),
        nullable=False,
        unique=True,
        index=True,
        comment="Public token identifier (JWT-style jti equivalent)",
    )
    token_hash: Mapped[str] = mapped_column(
        Text,
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
    revoked_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="When token was revoked (NULL means active)",
    )
    replaced_by_token_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
        comment="Token ID that replaced this token during rotation",
    )
    created_from_ip: Mapped[str | None] = mapped_column(
        String(45),
        nullable=True,
        comment="Source IP address when token was created",
    )
    user_agent: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Request user-agent when token was created",
    )


# `user_id` carries no `index=True`: this index leads with it, so it already
# serves a lookup by user alone.
Index("idx_refresh_tokens_user_active", RefreshToken.user_id, RefreshToken.revoked_at)
