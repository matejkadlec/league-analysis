"""User-specific tracked player mappings."""

from datetime import datetime

from sqlalchemy import DateTime as SQLDateTime
from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base

from .user_reference import user_id_column


class UserTrackedPlayer(Base):
    """Junction table mapping users to tracked players."""

    __tablename__ = "user_tracked_players"
    __table_args__ = (
        Index("ix_user_tracked_players_recent", "user_id", "last_selected_at"),
        # Present in the database since the baseline; declared here so the
        # models stop proposing its removal.
        Index("idx_user_tracked_players_puuid", "puuid"),
        {"schema": "auth"},
    )

    user_id: Mapped[int] = user_id_column(
        "User who tracks the player", primary_key=True
    )
    puuid: Mapped[str] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="CASCADE"),
        primary_key=True,
        comment="Tracked player PUUID",
    )
    tracked_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this player was added to the user's tracked list",
    )
    last_selected_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When this tracked player was most recently selected",
    )
