"""User-specific tracked player mappings."""

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy import DateTime as SQLDateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class UserTrackedPlayer(Base):
    """Junction table mapping users to tracked players."""

    __tablename__ = "user_tracked_players"
    __table_args__ = (
        Index("ix_user_tracked_players_recent", "user_id", "last_selected_at"),
        {"schema": "auth"},
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="User who tracks the player",
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

    user = relationship("User", back_populates="tracked_players")
