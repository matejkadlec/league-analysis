"""User settings model for per-user preferences."""

from datetime import datetime
from typing import Final, override

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.models import Base, created_at_column, updated_at_column


class UserSettings(Base):
    """User settings model for storing per-user preferences."""

    __tablename__ = "user_settings"
    __table_args__: Final = {"schema": "auth"}

    # Primary key (also FK to users)
    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Reference to the user",
    )

    current_player_puuid: Mapped[str | None] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Last player selected by this application user",
    )

    # Timestamps
    created_at: Mapped[datetime] = created_at_column("When these settings were created")

    updated_at: Mapped[datetime] = updated_at_column(
        "When these settings were last updated"
    )

    # Relationships
    user = relationship("User", back_populates="settings")

    @override
    def __repr__(self) -> str:
        """Return string representation of the user settings."""
        return f"<UserSettings(user_id={self.user_id})>"
