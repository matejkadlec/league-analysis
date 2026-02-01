"""Service for managing system settings."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import structlog

from .models import RiotAPIKey
from .schemas import (
    SettingResponse,
    SettingUpdate,
    SettingValidationResponse,
    SettingTestResponse,
    APIKeyStatusResponse,
)
from app.core.riot_api.client import RiotAPIClient
from app.core.config import settings
from app.core.riot_api.constants import Region, Platform
from app.core.riot_api.errors import RiotAPIError

logger = structlog.get_logger(__name__)


class SettingsService:
    """Service for handling system settings operations."""

    def __init__(self, db: AsyncSession):
        """Initialize settings service."""
        self.db = db

    async def get_setting(self, key: str) -> Optional[SettingResponse]:
        """Get a setting by key."""
        if key == "riot_api_key":
            # Determine most recent added key, regardless of active status? Or just active?
            # Usually we want the active one.
            stmt = (
                select(RiotAPIKey)
                .where(RiotAPIKey.is_active == True)
                .order_by(RiotAPIKey.added_at.desc())
                .limit(1)
            )
            result = await self.db.execute(stmt)
            setting = result.scalar_one_or_none()

            if not setting:
                return None

            # Masking
            val = setting.key_value
            masked = f"{val[:6]}...{val[-4:]}" if len(val) > 10 else "***"

            return SettingResponse(
                key="riot_api_key",
                masked_value=masked,
                category="riot_api",
                is_sensitive=True,
                created_at=setting.added_at,
                updated_at=setting.added_at,  # fallback
            )

        return None

    async def get_api_key_status(self) -> APIKeyStatusResponse:
        """Get the current status of the Riot API key configuration."""
        import os
        import hashlib

        # Check DB
        stmt = (
            select(RiotAPIKey)
            .where(RiotAPIKey.is_active == True)
            .order_by(RiotAPIKey.added_at.desc())
            .limit(1)
        )
        result = await self.db.execute(stmt)
        db_key_exists = result.scalar_one_or_none() is not None

        # Check Env
        env_key = os.getenv("RIOT_API_KEY")
        # In this project context, settings might not load env var directly into 'riot_api_key' field if not in .env?
        # But os.getenv directly checks .env if loaded.
        has_env_key = bool(env_key and env_key.strip())

        # Determine source used by system (mimicking config logic)
        active_source = "none"
        if db_key_exists:
            active_source = "db"
        elif has_env_key:
            active_source = "env"

        # Generate identifier for env key if it exists
        env_key_identifier = None
        if has_env_key and env_key:
            # Create a short hash of the key to use as identifier (last 8 chars of md5)
            # We don't want to expose any part of the actual key that could be guessed
            env_key_identifier = hashlib.md5(env_key.encode()).hexdigest()[-8:]

        return APIKeyStatusResponse(
            has_db_key=db_key_exists,
            has_env_key=has_env_key,
            active_source=active_source,
            env_key_identifier=env_key_identifier,
        )

    async def update_setting(self, key: str, update: SettingUpdate) -> SettingResponse:
        """Update a setting value."""
        if key != "riot_api_key":
            raise ValueError(f"Setting '{key}' not supported")

        # Validate the new value before saving
        validation = await self.validate_riot_api_key(update.value)
        if not validation.valid:
            logger.warning(
                "setting_validation_failed",
                key=key,
                message=validation.message,
            )
            raise ValueError(f"Invalid Riot API key: {validation.message}")

        # Check if this exact key value already exists
        stmt = select(RiotAPIKey).where(RiotAPIKey.key_value == update.value)
        result = await self.db.execute(stmt)
        existing_key_entry = result.scalar_one_or_none()

        if existing_key_entry and existing_key_entry.is_active:
            # No-op: The key is already active and the same
            val = existing_key_entry.key_value
            masked = f"{val[:6]}...{val[-4:]}"
            return SettingResponse(
                key="riot_api_key",
                masked_value=masked,
                category="riot_api",
                is_sensitive=True,
                created_at=existing_key_entry.added_at,
                updated_at=existing_key_entry.added_at,
            )

        # Deactivate all currently active keys
        stmt_active = select(RiotAPIKey).where(RiotAPIKey.is_active == True)
        result_active = await self.db.execute(stmt_active)
        active_keys = result_active.scalars().all()
        for k in active_keys:
            k.is_active = False

        if existing_key_entry:
            # Reactivate existing key
            existing_key_entry.is_active = True
            target_key = existing_key_entry
        else:
            # Create new key
            new_key = RiotAPIKey(
                key_value=update.value,
                is_active=True,
            )
            self.db.add(new_key)
            target_key = new_key

        await self.db.commit()
        await self.db.refresh(target_key)

        val = target_key.key_value
        masked = f"{val[:6]}...{val[-4:]}"

        return SettingResponse(
            key="riot_api_key",
            masked_value=masked,
            category="riot_api",
            is_sensitive=True,
            created_at=target_key.added_at,
            updated_at=target_key.added_at,
        )

    async def create_or_update_setting(
        self, key: str, value: str, category: str, is_sensitive: bool = False
    ) -> SettingResponse:
        """Create or update a setting.

        Wrapper around update_setting for compatibility with older interface.
        """
        # Create a SettingUpdate object
        update_obj = SettingUpdate(value=value)
        return await self.update_setting(key, update_obj)

    def _check_api_key_format(self, api_key: str) -> SettingValidationResponse | None:
        """Check API key format. Returns error response if invalid, None if valid."""
        if not api_key or len(api_key) < 10:
            return SettingValidationResponse(
                valid=False,
                message="API key is too short",
                details="Riot API keys should start with 'RGAPI-'",
            )

        if not api_key.startswith("RGAPI-"):
            return SettingValidationResponse(
                valid=False,
                message="Invalid API key format",
                details="Riot API keys must start with 'RGAPI-'",
            )

        return None

    async def _test_api_key_with_client(
        self, client: RiotAPIClient
    ) -> SettingValidationResponse:
        """Test API key by making request to Riot API."""
        try:
            test_url = client.endpoints.account_by_riot_id("Jim Morioriarty", "EUN1")
            logger.info("riot_api_key_validation_attempt", test_url=test_url)

            response = await client._make_request(
                test_url, method="GET", retry_on_failure=False
            )

            logger.info(
                "riot_api_key_validated",
                status="success",
                response_type=type(response).__name__,
            )
            return SettingValidationResponse(
                valid=True,
                message="API key is valid",
                details="Successfully validated with Riot API",
            )

        except RiotAPIError as e:
            # Handle different status codes - all these exceptions are aliases to RiotAPIError
            if e.status_code == 401:
                logger.warning(
                    "riot_api_key_validation_failed", error="401", details=str(e)
                )
                return SettingValidationResponse(
                    valid=False,
                    message="API key is invalid",
                    details="Received 401 Unauthorized from Riot API. The API key format is correct but the key itself is not recognized.",
                )
            elif e.status_code == 403:
                logger.warning(
                    "riot_api_key_validation_failed", error="403", details=str(e)
                )
                return SettingValidationResponse(
                    valid=False,
                    message="API key has expired",
                    details="Received 403 Forbidden from Riot API. Development keys expire every 24 hours - please generate a new key at developer.riotgames.com",
                )
            elif e.status_code == 404:
                logger.info(
                    "riot_api_key_validated",
                    status="success",
                    note="404_account_not_found",
                )
                return SettingValidationResponse(
                    valid=True,
                    message="API key is valid",
                    details="Successfully validated with Riot API (test account not found, but authentication succeeded)",
                )
            else:
                # Re-raise for other status codes
                raise

    async def validate_riot_api_key(self, api_key: str) -> SettingValidationResponse:
        """Validate a Riot API key by making a test API call."""
        # Check format first
        format_error = self._check_api_key_format(api_key)
        if format_error:
            return format_error

        # Test the API key with a simple request
        try:
            client = RiotAPIClient(
                api_key=api_key, region=Region.EUROPE, platform=Platform.EUN1
            )
            await client.start_session()

            try:
                return await self._test_api_key_with_client(client)
            finally:
                await client.close()

        except Exception as e:
            logger.error(
                "riot_api_key_validation_error",
                error=str(e),
                error_type=type(e).__name__,
            )
            return SettingValidationResponse(
                valid=False,
                message="Failed to validate API key",
                details=f"Unexpected error during validation: {str(e)}",
            )

    async def test_riot_api_key(self, api_key: str) -> SettingTestResponse:
        """Test a Riot API key without saving it."""
        validation = await self.validate_riot_api_key(api_key)

        return SettingTestResponse(
            success=validation.valid,
            message=validation.message,
            details=(
                {"validation_details": validation.details}
                if validation.details
                else None
            ),
        )
