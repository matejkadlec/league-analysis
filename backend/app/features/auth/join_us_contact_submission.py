"""Join Us contact submission log for anti-spam throttling."""

from datetime import datetime
from typing import Final, override

from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Index,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.models import Base, id_column


class JoinUsContactSubmission(Base):
    """Stores Join Us submission metadata used for anti-spam checks."""

    __tablename__ = "join_us_contact_submissions"
    __table_args__: Final = {"schema": "auth"}

    id: Mapped[int] = id_column()
    remote_ip: Mapped[str] = mapped_column(
        String(45),
        nullable=False,
        index=True,
        comment="Request source IP address",
    )
    subject: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        comment="Submitted subject value",
    )
    submitted_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
        comment="When the submission was accepted",
    )

    @override
    def __repr__(self) -> str:
        """Return string representation of join-us submission row."""
        return (
            "<JoinUsContactSubmission("
            f"id={self.id}, remote_ip='{self.remote_ip}', "
            f"subject='{self.subject}')>"
        )


Index(
    "idx_join_us_contact_submissions_ip_time",
    JoinUsContactSubmission.remote_ip,
    JoinUsContactSubmission.submitted_at,
)
