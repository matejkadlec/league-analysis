"""Configuration settings for the Riot API application."""

from __future__ import annotations

import os
from pathlib import Path
from typing import TYPE_CHECKING, List

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Load environment variables from .env file in project root
# Get the project root (4 levels up from this file: backend/app/core/config.py -> root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_FILE)

# Fallback PUUID used by test job runs when no tracked players exist
TEST_PUUID = (
    "PNm-92VrUvdu-cj0KFhqs0_8dNV2g9DsQ2pObEKsJZum-3uISPmVr2xn2eI1ztzq10TJb9M-ZpdbdQ"
)


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database Configuration (loaded from POSTGRES_* env vars in .env)
    postgres_db: str
    postgres_user: str
    postgres_password: str
    postgres_host: str
    postgres_port: int

    @property
    def database_url(self) -> str:
        """Construct async database URL from components."""
        return f"postgresql+asyncpg://{self.postgres_user}:{self.postgres_password}@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"

    # Application Configuration
    debug: bool = Field(default=False)
    log_level: str = Field(default="INFO")

    # CORS Configuration
    cors_origins: str = Field(default="http://localhost:3000,http://127.0.0.1:3000")

    @property
    def cors_origins_list(self) -> List[str]:
        """Get CORS origins as a list."""
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @property
    def environment(self) -> str:
        """Get current environment from ENVIRONMENT variable."""
        env = os.getenv("ENVIRONMENT", "").lower()
        return env if env in ["dev", "production"] else "dev"  # Safe default

    # JWT Authentication Configuration
    jwt_secret_key: str = Field(
        default="dev_secret_key_please_change_in_production",
        description="Secret key for JWT token signing - MUST be changed in production",
    )
    jwt_algorithm: str = Field(default="HS256", description="JWT signing algorithm")
    jwt_access_token_expire_minutes: int = Field(
        default=30,
        description="JWT access token expiration time in minutes",
    )
    jwt_refresh_token_expire_days: int = Field(
        default=30,
        description="Refresh token expiration time in days",
    )

    auth_lockout_max_attempts: int = Field(
        default=5,
        description="Maximum consecutive failed login attempts before temporary lockout",
    )
    auth_lockout_minutes: int = Field(
        default=15,
        description="Duration of temporary account lockout after max failed logins",
    )
    auth_captcha_after_failures: int = Field(
        default=2,
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
    def validate_jwt_secret(cls, v: str) -> str:
        """Validate JWT secret key meets security requirements.

        Enforces:
        - Minimum length of 32 characters (256 bits for HS256 per RFC 7518)
        - No default/placeholder values in production
        - Fails fast on startup with clear error messages

        Raises:
            ValueError: If secret is weak and environment is production
        """
        # Check if running in production
        env = os.getenv("ENVIRONMENT", "").lower()
        is_production = env == "production"

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

    @field_validator(
        "auth_lockout_max_attempts",
        "auth_lockout_minutes",
        "auth_captcha_after_failures",
        "jwt_access_token_expire_minutes",
        "jwt_refresh_token_expire_days",
    )
    @classmethod
    def validate_auth_security_thresholds(cls, v: int) -> int:
        """Ensure login security thresholds use sane positive values."""
        if v < 1:
            raise ValueError("Security threshold values must be at least 1")
        return v

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),  # Use absolute path to .env file
        case_sensitive=False,
        env_prefix="",  # No prefix for environment variables
        extra="ignore",  # Ignore extra fields (like frontend env vars in shared .env)
    )


def get_settings() -> Settings:
    """Get application settings instance."""

    def require_env(name: str) -> str:
        value = os.getenv(name)
        if value is None or value.strip() == "":
            raise ValueError(f"Missing required environment variable: {name}")
        return value

    return Settings(
        postgres_db=require_env("POSTGRES_DB"),
        postgres_user=require_env("POSTGRES_USER"),
        postgres_password=require_env("POSTGRES_PASSWORD"),
        postgres_host=require_env("POSTGRES_HOST"),
        postgres_port=int(require_env("POSTGRES_PORT")),
    )


# Create a global settings instance lazily
settings: Settings | None = None


def get_global_settings() -> Settings:
    """Get or create the global settings instance."""
    global settings
    if settings is None:
        settings = get_settings()
    return settings


async def get_riot_api_key(db: AsyncSession) -> str:
    """Return the database-first effective key and synchronize its health identity."""
    from app.core.riot_api.credential_health import (
        synchronize_riot_credential_health,
    )

    credential, _health = await synchronize_riot_credential_health(db)
    if credential is None:
        raise ValueError("No active Riot API key configured")
    return credential.value
