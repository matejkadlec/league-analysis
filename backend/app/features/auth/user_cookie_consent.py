"""User cookie-consent model for storing authenticated consent records."""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Final

from sqlalchemy import (
    DateTime as SQLDateTime,
)
from sqlalchemy import (
    Enum,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.models import Base, updated_at_column

from .user_reference import user_id_column


class CookieConsentLevel(PyEnum):
    """Supported cookie consent levels."""

    NECESSARY = "necessary"
    ALL = "all"


def _cookie_consent_enum_values(enum_cls: type[CookieConsentLevel]) -> list[str]:
    """Return the database labels SQLAlchemy should persist for the enum.

    Without this the column would store the member *names* (``NECESSARY``)
    rather than the lower-case values the schema declares.
    """
    return [member.value for member in enum_cls]


class UserCookieConsent(Base):
    """Authenticated user cookie-consent record."""

    __tablename__ = "user_cookie_consents"
    __table_args__: Final = {"schema": "auth"}

    user_id: Mapped[int] = user_id_column(
        "Reference to the user who submitted cookie consent", primary_key=True
    )

    consent_level: Mapped[CookieConsentLevel] = mapped_column(
        Enum(
            CookieConsentLevel,
            schema="auth",
            name="cookie_consent_level_enum",
            values_callable=_cookie_consent_enum_values,
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

    updated_at: Mapped[datetime] = updated_at_column(
        "When this consent record was last updated"
    )

    user = relationship("User", back_populates="cookie_consent")
