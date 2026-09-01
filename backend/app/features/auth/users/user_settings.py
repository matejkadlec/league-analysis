"""User settings model for per-user preferences."""

from datetime import datetime
from typing import Final

from sqlalchemy import ForeignKey, String, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base, created_at_column, updated_at_column

from .user_reference import user_id_column


class UserSettings(Base):
    """User settings model for storing per-user preferences."""

    __tablename__ = "user_settings"
    __table_args__: Final = {"schema": "auth"}

    user_id: Mapped[int] = user_id_column("Reference to the user", primary_key=True)

    current_player_puuid: Mapped[str | None] = mapped_column(
        String(78),
        ForeignKey("core.players.puuid", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Last player selected by this application user",
    )

    created_at: Mapped[datetime] = created_at_column("When these settings were created")

    updated_at: Mapped[datetime] = updated_at_column(
        "When these settings were last updated"
    )


async def ensure_user_settings(db: AsyncSession, user_id: int) -> UserSettings:
    """Return this user's settings row, inserting it when the read misses.

    The insert is `ON CONFLICT DO NOTHING` because two requests for one new
    account race here, and select-then-`add` raises IntegrityError from a GET.
    """
    settings = await db.scalar(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    if settings is not None:
        return settings

    await db.execute(
        insert(UserSettings)
        .values(user_id=user_id)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    inserted = await db.scalar(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    if inserted is None:  # pragma: no cover - the row was just written
        raise RuntimeError(f"user_settings row for {user_id} vanished after insert")
    return inserted
