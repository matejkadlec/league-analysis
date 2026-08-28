"""Singleton counters for Join Us contact subject sequencing."""

from typing import Final

from sqlalchemy import CheckConstraint, Integer, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column

from app.core.models import Base


class SubjectCounts(Base):
    """Stores per-subject counters for Join Us contact emails."""

    __tablename__ = "subject_counts"
    # Bare names; the `ck` convention prefixes them with `ck_subject_counts_`.
    __table_args__: Final = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint(
            "beta_tester >= 0 AND full_stack_developer >= 0 AND other >= 0",
            name="non_negative",
        ),
        {"schema": "auth"},
    )

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
