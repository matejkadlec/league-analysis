"""Configuration settings for the Riot API application."""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv
from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables from .env file in project root
# Get the project root (4 levels up from this file: backend/app/core/config.py -> root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_FILE)

# Fallback PUUID used by test job runs when no tracked players exist
TEST_PUUID = (
    "PNm-92VrUvdu-cj0KFhqs0_8dNV2g9DsQ2pObEKsJZum-3uISPmVr2xn2eI1ztzq10TJb9M-ZpdbdQ"
)


# A present-but-blank variable is a missing one, not an empty value: a blank
# POSTGRES_HOST failing at startup beats it failing as a connection error at
# first query. `env_ignore_empty` covers `""` for the whole model -- including
# `postgres_port`, which a hand-written validator over the four `str` fields
# could not reach -- and `pattern` covers the whitespace-only case it does not,
# since pydantic's `pattern` searches rather than matches in full.
RequiredEnvStr = Annotated[str, Field(pattern=r"\S")]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database Configuration (loaded from POSTGRES_* env vars in .env)
    postgres_db: RequiredEnvStr
    postgres_user: RequiredEnvStr
    postgres_password: RequiredEnvStr
    postgres_host: RequiredEnvStr
    postgres_port: int

    @property
    def database_url(self) -> str:
        """Construct async database URL from components."""
        return f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    # Application Configuration
    debug: bool = Field(default=False)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO"
    )

    # CORS Configuration
    cors_origins: str = Field(default="http://localhost:3000,http://127.0.0.1:3000")

    @property
    def cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list."""
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    # Declared above `jwt_secret_key` on purpose: pydantic validates fields in
    # declaration order, and `validate_jwt_secret` reads this one out of
    # `info.data`. No default -- an absent ENVIRONMENT used to read as "dev",
    # which made every `settings.environment != "dev"` guard decorative
    # against the one case that matters, a missing configuration.
    environment: Literal["dev", "test", "production"]

    # JWT Authentication Configuration
    jwt_secret_key: str = Field(
        default="dev_secret_key_please_change_in_production",
        description="Secret key for JWT token signing - MUST be changed in production",
    )
    jwt_algorithm: str = Field(default="HS256", description="JWT signing algorithm")
    jwt_access_token_expire_minutes: int = Field(
        default=30,
        ge=1,
        description="JWT access token expiration time in minutes",
    )
    jwt_refresh_token_expire_days: int = Field(
        default=30,
        ge=1,
        description="Refresh token expiration time in days",
    )

    auth_lockout_max_attempts: int = Field(
        default=5,
        ge=1,
        description="Maximum consecutive failed login attempts before temporary lockout",
    )
    auth_lockout_minutes: int = Field(
        default=15,
        ge=1,
        description="Duration of temporary account lockout after max failed logins",
    )
    auth_captcha_after_failures: int = Field(
        default=2,
        ge=1,
        description="Failed-login threshold after which CAPTCHA is required",
    )
    turnstile_secret_key: str = Field(
        default="",
        description="Cloudflare Turnstile secret key for server-side token verification",
    )
    turnstile_siteverify_url: str = Field(
        default="https://challenges.cloudflare.com/turnstile/v0/siteverify",
        description="Cloudflare Turnstile verification endpoint",
    )

    smtp_host: str = Field(
        default="",
        description="SMTP host used for transactional emails (email change verification)",
    )
    smtp_port: int = Field(default=587, description="SMTP port")
    smtp_username: str = Field(
        default="",
        description="SMTP username (optional for local/dev mail relays)",
    )
    smtp_password: str = Field(
        default="",
        description="SMTP password (optional for local/dev mail relays)",
    )
    smtp_from_email: str = Field(
        default="",
        description="Sender email address used for transactional emails",
    )
    smtp_use_tls: bool = Field(
        default=True,
        description="Whether SMTP client should call STARTTLS before sending",
    )
    smtp_use_ssl: bool = Field(
        default=False,
        description="Whether SMTP client should use implicit TLS via SMTP_SSL",
    )

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret(cls, v: str, info: ValidationInfo) -> str:
        """Validate JWT secret key meets security requirements.

        Enforces:
        - Minimum length of 32 characters (256 bits for HS256 per RFC 7518)
        - No default/placeholder values in production
        - Fails fast on startup with clear error messages

        Raises:
            ValueError: If secret is weak and environment is production
        """
        # `.get`, not `[...]`: pydantic only publishes fields that validated,
        # so an ENVIRONMENT of "staging" must stay its own error rather than
        # becoming a KeyError raised from inside this validator.
        is_production = info.data.get("environment") == "production"

        # Check for default/placeholder secrets
        weak_indicators = ["dev_secret", "please_change", "changeme", "secret_key"]
        is_weak = any(indicator in v.lower() for indicator in weak_indicators)

        if is_weak:
            if is_production:
                raise ValueError(
                    "Production deployment detected with default/weak JWT secret! "
                    "Generate a strong secret using: python -c 'import secrets; print(secrets.token_hex(32))' "
                    "and set it via JWT_SECRET_KEY environment variable."
                )
            # Warn in development but allow
            import sys

            print(
                "⚠️  WARNING: Using default JWT secret in development. "
                "Generate a production secret before deployment!",
                file=sys.stderr,
            )

        # Enforce minimum length (32 chars = 256 bits)
        if len(v) < 32:
            if is_production:
                raise ValueError(
                    f"JWT secret must be at least 32 characters (256 bits). "
                    f"Current length: {len(v)} characters. "
                    f"Generate a strong secret using: python -c 'import secrets; print(secrets.token_hex(32))'"
                )
            # Warn in development but allow
            import sys

            print(
                f"⚠️  WARNING: JWT secret is too short ({len(v)} chars). "
                f"Minimum recommended: 32 characters. Generate with: python -c 'import secrets; print(secrets.token_hex(32))'",
                file=sys.stderr,
            )

        return v

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),  # Use absolute path to .env file
        case_sensitive=False,
        env_prefix="",  # No prefix for environment variables
        extra="ignore",  # Ignore extra fields (like frontend env vars in shared .env)
        env_ignore_empty=True,  # `FOO=` is unset, not the empty string
    )


@cache
def get_global_settings() -> Settings:
    """Get the process-wide settings instance, built on first use.

    The five postgres fields have no defaults, so pydantic-settings itself
    raises on any missing one — and reports all of them at once, where the
    old per-field helper stopped at the first.
    """
    # The five postgres fields arrive via env/env_file; pyright only sees the
    # generated __init__ signature.
    return Settings()  # pyright: ignore[reportCallIssue]
