"""Configuration settings for the Riot API application."""

from __future__ import annotations

import os
from pathlib import Path
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# Load environment variables from .env file in project root
# Get the project root (4 levels up from this file: backend/app/core/config.py -> root)
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
load_dotenv(dotenv_path=ENV_FILE)


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
    def environment(self) -> str:  # noqa: vulture
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
        default=10080,  # 7 days
        description="JWT access token expiration time in minutes",
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

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),  # Use absolute path to .env file
        case_sensitive=False,
        env_prefix="",  # No prefix for environment variables
        extra="ignore",  # Ignore extra fields (like frontend env vars in shared .env)
    )


def get_settings() -> Settings:
    """Get application settings instance."""
    # Pydantic v2 will automatically load from environment variables
    # This allows lazy loading when the module is imported
    return Settings()


# Create a global settings instance lazily
settings: Settings | None = None


def get_global_settings() -> Settings:
    """Get or create the global settings instance."""
    global settings
    if settings is None:
        settings = get_settings()
    return settings


async def get_riot_api_key(db: AsyncSession) -> str:
    """Get an active Riot API key from database or fallback to env.

    Logic:
    1. Search for active key in `core.riot_api_keys`.
    2. detailed expiration check (24h for dev keys).
    3. If invalid/expired, mark as inactive and loop.
    4. If no active key found, fallback to .env (with warning).

    :param db: Database session
    :returns: Active Riot API key
    :raises ValueError: If no active API key found in DB or .env
    """
    from sqlalchemy import select
    from datetime import datetime, timezone
    from app.features.settings.models import RiotAPIKey
    import structlog

    logger = structlog.get_logger(__name__)

    # Fallback function
    def get_env_key(warning_msg: str) -> str:
        key = os.getenv("RIOT_API_KEY")
        if not key:
            raise ValueError(f"{warning_msg} AND no RIOT_API_KEY found in .env!")

        logger.warning(f"⚠️  {warning_msg}. Using key from .env.")
        return key

    while True:
        # Get the latest active key
        stmt = (
            select(RiotAPIKey)
            .where(RiotAPIKey.is_active == True)
            .order_by(RiotAPIKey.added_at.desc())
            .limit(1)
        )
        result = await db.execute(stmt)
        key_record = result.scalar_one_or_none()

        if not key_record:
            return get_env_key("No active Riot API key found in database")

        # Check expiration (24 hours)
        # added_at is timezone-aware (UTC) per model definition
        now = datetime.now(timezone.utc)

        # If key is older than 24h (86400 seconds)
        if (now - key_record.added_at).total_seconds() > 86400:
            logger.warning(
                f"Riot API key {key_record.id} expired (older than 24h). Disabling..."
            )

            key_record.is_active = False
            db.add(key_record)
            await db.commit()

            # Loop again to find next candidate
            continue

        return key_record.key_value
