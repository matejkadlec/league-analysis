"""User model for authentication and authorization."""

from datetime import datetime
from typing import TYPE_CHECKING, Final, override

from sqlalchemy import (
    BigInteger,
    Boolean,
    Index,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base

if TYPE_CHECKING:
    from .email_change_request import EmailChangeRequest
    from .user_cookie_consent import UserCookieConsent
    from .user_settings import UserSettings
    from .user_tracked_player import UserTrackedPlayer


class User(Base):
    """User model for authentication and authorization."""

    __tablename__ = "users"
    __table_args__: Final = {"schema": "auth"}

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

    email_verified_at: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When the email was verified",
    )

    # Activity tracking
    last_login: Mapped[datetime | None] = mapped_column(
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

    last_failed_login: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="When the most recent failed login happened",
    )

    locked_until: Mapped[datetime | None] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Account lock expiration timestamp after too many failed logins",
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
    settings: Mapped[UserSettings | None] = relationship(
        "UserSettings",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    cookie_consent: Mapped[UserCookieConsent | None] = relationship(
        "UserCookieConsent",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    tracked_players: Mapped[list[UserTrackedPlayer]] = relationship(
        "UserTrackedPlayer",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    email_change_request: Mapped[EmailChangeRequest | None] = relationship(
        "EmailChangeRequest",
        uselist=False,
        cascade="all, delete-orphan",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of the user."""
        return f"<User(id={self.id}, email='{self.email}', display_name='{self.display_name}', is_admin={self.is_admin})>"


# Create composite indexes for common queries
Index("idx_users_is_active_is_admin", User.is_active, User.is_admin)
Index("idx_users_email_is_active", User.email, User.is_active)
Index("idx_users_last_login", User.last_login)
Index("idx_users_locked_until", User.locked_until)
Index("idx_users_created_at", User.created_at)

# Ensure consent mapper is registered even when this module is imported directly.

from .user_cookie_consent import UserCookieConsent  # noqa: E402
