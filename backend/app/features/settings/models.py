"""Riot API Key model for storing credentials."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Integer,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base


class RiotAPIKey(Base):
    """Riot API Key for accessing valid credentials."""

    __tablename__ = "riot_api_keys"
    __table_args__ = {"schema": "core"}

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Key Value (The 'RGAPI-...' string)
    key_value: Mapped[str] = mapped_column(
        String(42),
        unique=True,
        nullable=False,
        comment="The actual Riot API key (RGAPI-...) which must be 42 chars",
    )

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="Whether this key is currently active and usable",
    )

    # Usage Stats
    added_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        comment="When this key was added to the system",
    )

    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=True,
        comment="Last time this key was successfully used",
    )

    times_used: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
        comment="Total number of requests made with this key",
    )
