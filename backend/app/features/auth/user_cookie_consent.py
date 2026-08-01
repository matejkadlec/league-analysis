"""User cookie-consent model for storing authenticated consent records."""

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    BigInteger,
    Enum,
    ForeignKey,
    String,
)
from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base


class CookieConsentLevel(PyEnum):
    """Supported cookie consent levels."""

    NECESSARY = "necessary"
    ALL = "all"


class UserCookieConsent(Base):
    """Authenticated user cookie-consent record."""

    __tablename__ = "user_cookie_consents"
    __table_args__ = {"schema": "auth"}

    user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
        comment="Reference to the user who submitted cookie consent",
    )

    consent_level: Mapped[CookieConsentLevel] = mapped_column(
        Enum(
            CookieConsentLevel,
            schema="auth",
            name="cookie_consent_level_enum",
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        nullable=False,
        comment="Consent level chosen by the user on this browser",
    )

    consent_version: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="v1",
        comment="Cookie policy/version identifier used when consent was captured",
    )

    consent_source: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="banner",
        comment="Source of consent capture (banner, settings, etc.)",
    )

    consented_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When cookie consent was last explicitly set",
    )

    updated_at: Mapped[datetime] = mapped_column(
        SQLDateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
        comment="When this consent record was last updated",
    )

    user = relationship("User", back_populates="cookie_consent")

    def __repr__(self) -> str:
        """Return string representation of cookie consent."""
        return (
            "<UserCookieConsent("
            f"user_id={self.user_id}, "
            f"consent_level='{self.consent_level.value}', "
            f"consent_version='{self.consent_version}'"
            ")>"
        )
