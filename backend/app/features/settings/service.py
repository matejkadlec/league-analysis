"""Service for managing system settings."""

from datetime import datetime, timezone
from sqlalchemy import and_, or_, select
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
    UserCookieConsentUpdate,
    ServiceStatusResponse,
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

    async def get_service_status(self) -> ServiceStatusResponse:
        """Get user-facing maintenance status based on API key health signals."""
        from app.features.jobs.models import JobExecution, JobStatus

        api_key_status = await self.get_api_key_status()
        no_active_key_configured = api_key_status.active_source == "none"
        latest_active_db_key = None
        key_resolved_at = None
        if api_key_status.active_source == "db":
            latest_active_db_key_result = await self.db.execute(
                select(RiotAPIKey)
                .where(RiotAPIKey.is_active == True)
                .order_by(RiotAPIKey.added_at.desc())
                .limit(1)
            )
            latest_active_db_key = latest_active_db_key_result.scalar_one_or_none()
            if latest_active_db_key is not None:
                key_resolved_at = (
                    latest_active_db_key.last_used_at or latest_active_db_key.added_at
                )

        latest_api_health_signal_result = await self.db.execute(
            select(
                JobExecution.status,
                JobExecution.has_api_key_error,
                JobExecution.started_at,
            )
            .where(
                or_(
                    and_(
                        JobExecution.status == JobStatus.FAILED,
                        JobExecution.has_api_key_error.is_(True),
                    ),
                    JobExecution.status == JobStatus.SUCCESS,
                )
            )
            .order_by(JobExecution.started_at.desc())
            .limit(1)
        )
        latest_api_health_signal = latest_api_health_signal_result.first()

        has_unresolved_api_key_failure = False
        if latest_api_health_signal is not None:
            latest_status, has_api_key_error, latest_signal_started_at = (
                latest_api_health_signal
            )
            has_unresolved_api_key_failure = (
                latest_status == JobStatus.FAILED and bool(has_api_key_error)
            )
            # Treat stale failures as resolved when a key was validated successfully after that failure.
            if has_unresolved_api_key_failure and latest_active_db_key is not None:
                if (
                    key_resolved_at is not None
                    and latest_signal_started_at is not None
                    and key_resolved_at > latest_signal_started_at
                ):
                    has_unresolved_api_key_failure = False

        is_under_maintenance = (
            no_active_key_configured or has_unresolved_api_key_failure
        )

        latest_api_key_failure_result = await self.db.execute(
            select(JobExecution.started_at)
            .where(
                and_(
                    JobExecution.status == JobStatus.FAILED,
                    JobExecution.has_api_key_error.is_(True),
                )
            )
            .order_by(JobExecution.started_at.desc())
            .limit(1)
        )
        latest_api_key_failure_at = latest_api_key_failure_result.scalar_one_or_none()

        latest_success_result = await self.db.execute(
            select(JobExecution.started_at)
            .where(JobExecution.status == JobStatus.SUCCESS)
            .order_by(JobExecution.started_at.desc())
            .limit(1)
        )
        latest_success_at = latest_success_result.scalar_one_or_none()

        recovery_reference_at = None
        if latest_api_key_failure_at is not None:
            if latest_success_at is not None and latest_success_at > latest_api_key_failure_at:
                recovery_reference_at = latest_success_at
            if key_resolved_at is not None and key_resolved_at > latest_api_key_failure_at:
                if recovery_reference_at is None or key_resolved_at > recovery_reference_at:
                    recovery_reference_at = key_resolved_at

        has_recent_recovery = (
            recovery_reference_at is not None and not is_under_maintenance
        )
        recovery_notice_key = (
            recovery_reference_at.isoformat() if recovery_reference_at else None
        )

        return ServiceStatusResponse(
            is_under_maintenance=is_under_maintenance,
            reason="api_key_issue" if is_under_maintenance else "ok",
            no_active_key_configured=no_active_key_configured,
            latest_job_has_api_key_failure=has_unresolved_api_key_failure,
            has_recent_recovery=has_recent_recovery,
            recovery_notice_key=recovery_notice_key,
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
            existing_key_entry.last_used_at = datetime.now(timezone.utc)
            val = existing_key_entry.key_value
            masked = f"{val[:6]}...{val[-4:]}"
            await self.db.commit()
            await self.db.refresh(existing_key_entry)
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

        target_key.last_used_at = datetime.now(timezone.utc)
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

    # ===== USER SETTINGS METHODS =====

    async def get_or_create_user_settings(self, user_id: int):
        """Get user settings, creating default settings if they don't exist."""
        from app.features.auth.user_settings import UserSettings

        stmt = select(UserSettings).where(UserSettings.user_id == user_id)
        result = await self.db.execute(stmt)
        settings = result.scalar_one_or_none()

        if not settings:
            # Create default settings
            settings = UserSettings(user_id=user_id)
            self.db.add(settings)
            await self.db.commit()
            await self.db.refresh(settings)
            logger.info("Created default user settings", user_id=user_id)

        return settings

    async def update_user_settings(self, user_id: int, update):
        """Update user settings with provided values."""
        from app.features.auth.user_settings import UserSettings, ThemeEnum

        # Get or create settings first
        settings = await self.get_or_create_user_settings(user_id)

        # Update only provided fields
        update_data = update.model_dump(exclude_unset=True)

        for field, value in update_data.items():
            if field == "theme" and value is not None:
                # Convert string to enum
                settings.theme = ThemeEnum(value) if isinstance(value, str) else value
            elif hasattr(settings, field):
                setattr(settings, field, value)

        await self.db.commit()
        await self.db.refresh(settings)

        logger.info(
            "Updated user settings",
            user_id=user_id,
            updated_fields=list(update_data.keys()),
        )

        return settings

    async def get_user_cookie_consent(self, user_id: int):
        """Get authenticated user's stored cookie-consent record."""
        from app.features.auth.user_cookie_consent import UserCookieConsent

        stmt = select(UserCookieConsent).where(UserCookieConsent.user_id == user_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert_user_cookie_consent(
        self, user_id: int, update: UserCookieConsentUpdate
    ):
        """Create or update authenticated user's cookie-consent record."""
        from app.features.auth.user_cookie_consent import (
            UserCookieConsent,
            CookieConsentLevel,
        )

        stmt = select(UserCookieConsent).where(UserCookieConsent.user_id == user_id)
        result = await self.db.execute(stmt)
        consent = result.scalar_one_or_none()

        consent_level = CookieConsentLevel(update.consent_level.value)

        if consent is None:
            consent = UserCookieConsent(
                user_id=user_id,
                consent_level=consent_level,
                consent_version=update.consent_version,
                consent_source=update.consent_source,
            )
            self.db.add(consent)
        else:
            consent.consent_level = consent_level
            consent.consent_version = update.consent_version
            consent.consent_source = update.consent_source
            consent.consented_at = datetime.now(timezone.utc)

        await self.db.commit()
        await self.db.refresh(consent)

        logger.info(
            "updated_user_cookie_consent",
            user_id=user_id,
            consent_level=consent.consent_level.value,
            consent_version=consent.consent_version,
            consent_source=consent.consent_source,
        )

        return consent
