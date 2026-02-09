"""User model for authentication and authorization."""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime as SQLDateTime,
    String,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base

if TYPE_CHECKING:
    from .user_settings import UserSettings
    from .user_tracked_player import UserTrackedPlayer


class User(Base):
    """User model for authentication and authorization."""

    __tablename__ = "users"
    __table_args__ = {"schema": "auth"}

    # Primary key
    id: Mapped[int] = mapped_column(
        BigInteger,
        primary_key=True,
        autoincrement=True,
        comment="Auto-incrementing primary key",
    )

    # Authentication fields
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
        comment="User email address (unique)",
    )

    password_hash: Mapped[str] = mapped_column(
        String,  # Text type in database, no length limit
        nullable=False,
        comment="Hashed password using Argon2id",
    )

    # Profile information
    display_name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        comment="Display name shown in UI",
    )

    # Account status flags
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
        comment="Whether the account is active (not disabled)",
    )

    is_admin: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        index=True,
        comment="Whether the user has admin privileges",
    )

    # Email verification
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether the email has been verified",
    )

    email_verified_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When the email was verified",
    )

    # Activity tracking
    last_login: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="When the user last logged in",
    )

    failed_login_attempts: Mapped[int] = mapped_column(
        default=0,
        nullable=False,
        comment="Consecutive failed login attempts since last successful login",
    )

    last_failed_login: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When the most recent failed login happened",
    )

    locked_until: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Account lock expiration timestamp after too many failed logins",
    )

    # Riot Account Connection
    riot_account_connected: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether a Riot account has been linked to this user",
    )

    puuid: Mapped[Optional[str]] = mapped_column(
        String(78),
        nullable=True,
        index=True,
        comment="Linked Riot account PUUID (references core.players)",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this user account was created",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this user account was last updated",
    )

    # Relationships
    settings: Mapped[Optional["UserSettings"]] = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    tracked_players: Mapped[list["UserTrackedPlayer"]] = relationship(
        "UserTrackedPlayer",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        """Return string representation of the user."""
        return f"<User(id={self.id}, email='{self.email}', display_name='{self.display_name}', is_admin={self.is_admin})>"


# Create composite indexes for common queries
Index("idx_users_is_active_is_admin", User.is_active, User.is_admin)
Index("idx_users_email_is_active", User.email, User.is_active)
Index("idx_users_last_login", User.last_login)
Index("idx_users_locked_until", User.locked_until)
Index("idx_users_created_at", User.created_at)
Index("ix_users_puuid", User.puuid)
