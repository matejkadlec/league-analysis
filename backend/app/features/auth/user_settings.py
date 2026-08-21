"""User settings model for per-user preferences."""

from datetime import datetime
from typing import Final

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column, updated_at_column

from .user_reference import user_id_column


class UserSettings(Base):
    """User settings model for storing per-user preferences."""

    __tablename__ = "user_settings"
    __table_args__: Final = {"schema": "auth"}

    # Primary key (also FK to users)
    user_id: Mapped[int] = user_id_column("Reference to the user", primary_key=True)

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
