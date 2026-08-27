"""The consent enum the database stores, and the API enum it must meet.

The settings bridge converts by value and the column persists member values
rather than names; both fail silently at runtime when they break.
"""

from sqlalchemy import Enum

from app.features.auth.user_cookie_consent import (
    CookieConsentLevel as StoredLevel,
)
from app.features.auth.user_cookie_consent import (
    UserCookieConsent,
)
from app.features.settings.schemas import CookieConsentLevel as ApiLevel


def test_the_column_persists_the_lowercase_labels_the_schema_declares() -> None:
    """The database enum is `('necessary', 'all')`; member names would not fit.

    Without `values_callable`, SQLAlchemy persists the member *names*
    (`NECESSARY`, `ALL`) as the enum labels, and every consent write is
    rejected by the type declared in the initial revision.
    """
    column = UserCookieConsent.__table__.c.consent_level
    assert isinstance(column.type, Enum)
    assert column.type.enums == ["necessary", "all"]


def test_every_api_level_resolves_to_its_model_member() -> None:
    """The by-value bridge the upsert performs must not be able to miss."""
    assert [level.value for level in ApiLevel] == ["necessary", "all"]
    for api_level in ApiLevel:
        stored = StoredLevel(api_level.value)
        assert stored.name == api_level.name
        assert stored.value == api_level.value
