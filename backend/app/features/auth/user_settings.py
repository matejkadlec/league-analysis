"""User settings model for per-user preferences."""

from datetime import datetime
from typing import Optional
from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime as SQLDateTime,
    ForeignKey,
    String,
    Enum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class ThemeEnum(PyEnum):
    """Theme preference enum."""

    LIGHT = "LIGHT"
    DARK = "DARK"


class UserSettings(Base):
    """User settings model for storing per-user preferences."""

    __tablename__ = "user_settings"
    __table_args__ = {"schema": "auth"}

    # Primary key (also FK to users)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Reference to the user",
    )

    # Theme preference
    theme: Mapped[ThemeEnum] = mapped_column(
        Enum(ThemeEnum, schema="auth", name="theme_enum"),
        nullable=False,
        default=ThemeEnum.DARK,
        comment="User's preferred theme (LIGHT or DARK)",
    )

    # URL persistence settings
    save_playstyle_url: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether to remember the player PUUID in playstyle analysis URL",
    )

    saved_playstyle_puuid: Mapped[Optional[str]] = mapped_column(
        String(78),
        nullable=True,
        comment="Saved PUUID for playstyle analysis URL persistence",
    )

    save_matchmaking_url: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Whether to remember the player PUUID in matchmaking analysis URL",
    )

    saved_matchmaking_puuid: Mapped[Optional[str]] = mapped_column(
        String(78),
        nullable=True,
        comment="Saved PUUID for matchmaking analysis URL persistence",
    )

    # Default platform preference
    default_platform: Mapped[Optional[str]] = mapped_column(
        String(4),
        nullable=True,
        default="eun1",
        comment="Default server/platform for player searches",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When these settings were created",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When these settings were last updated",
    )

    # Relationships
    user = relationship("User", back_populates="settings")

    def __repr__(self) -> str:
        """Return string representation of the user settings."""
        return f"<UserSettings(user_id={self.user_id}, theme='{self.theme.value}')>"
