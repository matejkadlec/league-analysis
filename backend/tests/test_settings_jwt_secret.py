"""A production deployment must refuse a weak or too-short JWT secret.

`validate_jwt_secret` reads `environment` from `info.data`, which pydantic only
fills for fields declared earlier: reorder the two and every refusal below dies.
"""

from __future__ import annotations

from typing import Literal

import pytest
from pydantic import ValidationError

from app.core.config import Settings

WEAK_SECRET = "dev_secret_key_please_change_in_production"
SHORT_SECRET = "x" * 31
# Long enough for HS256 yet plainly not a credential, so gitleaks stays quiet.
STRONG_SECRET = "unit-test-only-signing-material-" * 2


def _settings(
    environment: Literal["dev", "test", "production"], jwt_secret_key: str
) -> Settings:
    """Build settings from explicit values, so no `.env` can decide the outcome."""
    return Settings(
        postgres_db="league_analysis",
        postgres_user="user",
        postgres_password="password",
        postgres_host="localhost",
        postgres_port=5432,
        environment=environment,
        jwt_secret_key=jwt_secret_key,
    )


@pytest.mark.parametrize("secret", [WEAK_SECRET, SHORT_SECRET])
def test_production_refuses_a_weak_or_short_jwt_secret(secret: str) -> None:
    """Both refusals depend on `environment` being validated first.

    Declared after `jwt_secret_key`, it is absent from `info.data`, the
    environment reads as non-production, and the shipped secret is a warning.
    """
    with pytest.raises(ValidationError, match="JWT secret"):
        _settings("production", secret)


def test_production_accepts_a_long_non_placeholder_secret() -> None:
    """The refusal is aimed at weak secrets, not at production itself."""
    assert _settings("production", STRONG_SECRET).jwt_secret_key == STRONG_SECRET


@pytest.mark.parametrize("secret", [WEAK_SECRET, SHORT_SECRET])
def test_development_accepts_the_secrets_production_refuses(secret: str) -> None:
    """Outside production the same two secrets only warn: local work keeps running."""
    assert _settings("dev", secret).jwt_secret_key == secret
