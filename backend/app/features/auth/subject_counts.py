"""Singleton counters for Join Us contact subject sequencing."""

from typing import Final, override

from sqlalchemy import Integer, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base


class SubjectCounts(Base):
    """Stores per-subject counters for Join Us contact emails."""

    __tablename__ = "subject_counts"
    __table_args__: Final = {"schema": "auth"}

    id: Mapped[int] = mapped_column(
        SmallInteger,
        primary_key=True,
        default=1,
        comment="Singleton row identifier (always 1)",
    )
    beta_tester: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="How many Beta Tester contact emails have been submitted",
    )
    full_stack_developer: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="How many Full-Stack Developer contact emails have been submitted",
    )
    other: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="How many Other contact emails have been submitted",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of subject counters."""
        return (
            "<SubjectCounts("
            f"id={self.id}, beta_tester={self.beta_tester}, "
            f"full_stack_developer={self.full_stack_developer}, other={self.other})>"
        )
