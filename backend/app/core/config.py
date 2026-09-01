"""Configuration settings for the Riot API application."""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Annotated, Literal

from dotenv import load_dotenv
from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Get the project root (4 levels up from this file: backend/app/core/config.py -> root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_FILE)


# A present-but-blank variable is a missing one: `env_ignore_empty` covers `""`
# model-wide, and `pattern` (which searches, not fullmatch) covers whitespace-only.
RequiredEnvStr = Annotated[str, Field(pattern=r"\S")]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    postgres_db: RequiredEnvStr
    postgres_user: RequiredEnvStr
    postgres_password: RequiredEnvStr
    postgres_host: RequiredEnvStr
    postgres_port: int

    @property
    def database_url(self) -> str:
        """Construct async database URL from components."""
        return f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    debug: bool = Field(default=False)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO"
    )

    cors_origins: str = Field(default="http://localhost:3000,http://127.0.0.1:3000")

    @property
    def cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list."""
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    # Must precede `jwt_secret_key`: pydantic validates in declaration order and
    # `validate_jwt_secret` reads it from `info.data`. Defaulting would hide absence.
    environment: Literal["dev", "test", "production"]

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

        Enforces a 32-character minimum (256 bits for HS256 per RFC 7518) and
        rejects default/placeholder values in production.

        Raises:
            ValueError: If secret is weak and environment is production
        """
        # `.get`, not `[...]`: pydantic omits fields that failed to validate, so an
        # invalid ENVIRONMENT must stay its own error, not a KeyError from here.
        is_production = info.data.get("environment") == "production"

        weak_indicators = ["dev_secret", "please_change", "changeme", "secret_key"]
        is_weak = any(indicator in v.lower() for indicator in weak_indicators)

        if is_weak:
            if is_production:
                raise ValueError(
                    "Production deployment detected with default/weak JWT secret! "
                    "Generate a strong secret using: python -c 'import secrets; print(secrets.token_hex(32))' "
                    "and set it via JWT_SECRET_KEY environment variable."
                )
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

    Postgres fields have no defaults, so pydantic-settings reports all missing ones.
    """
    # The five postgres fields arrive via env/env_file; pyright only sees the
    # generated __init__ signature.
    return Settings()  # pyright: ignore[reportCallIssue]
