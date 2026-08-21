"""Service for managing system settings."""

from datetime import UTC, datetime

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.core.riot_api.client import RiotAPIClient
from app.core.riot_api.constants import Platform, Region
from app.core.riot_api.credential_health import (
    RiotAPIKey,
    RiotCredentialStatus,
    mark_database_credential_valid,
    synchronize_riot_credential_health,
)
from app.core.riot_api.errors import RiotAPIError

from .models import UserCardPreference
from .schemas import (
    CardId,
    CardPreferenceResponse,
    CardPreferenceUpdate,
    ServiceStatusResponse,
    SettingResponse,
    SettingTestResponse,
    SettingUpdate,
    SettingValidationResponse,
    UserCookieConsentUpdate,
    normalize_stored_card_preference,
    serialize_card_preference_settings,
    validate_card_preference_update,
)

logger = structlog.get_logger(__name__)


class SettingsService:
    """Service for handling system settings operations."""

    def __init__(self, db: AsyncSession):
        """Initialize settings service."""
        self.db = db

    async def get_setting(self, key: str) -> SettingResponse | None:
        """Get a setting by key."""
        if key == "riot_api_key":
            stmt = select(RiotAPIKey).order_by(RiotAPIKey.added_at.desc()).limit(1)
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

    async def get_service_status(self) -> ServiceStatusResponse:
        """Get the same current health decision for every authenticated user."""
        _credential, health = await synchronize_riot_credential_health(self.db)
        is_under_maintenance = health.status in {
            RiotCredentialStatus.MISSING,
            RiotCredentialStatus.INVALID,
        }
        if health.status is RiotCredentialStatus.MISSING:
            reason = "api_key_missing"
        elif health.status is RiotCredentialStatus.INVALID:
            reason = "api_key_invalid"
        else:
            reason = "ok"
        has_recent_recovery = (
            health.status is RiotCredentialStatus.VALID
            and health.recovery_revision is not None
        )

        return ServiceStatusResponse(
            is_under_maintenance=is_under_maintenance,
            reason=reason,
            credential_status=health.status.value,
            health_revision=health.revision,
            observed_at=health.evidence_at,
            has_recent_recovery=has_recent_recovery,
            recovery_notice_key=(
                f"credential-{health.recovery_revision}"
                if health.recovery_revision is not None
                else None
            ),
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
                status=validation.status,
                message=validation.message,
            )
            if validation.status == "unavailable":
                raise ValueError(validation.message)
            raise ValueError(f"Invalid Riot API key: {validation.message}")

        # Re-saving the key already stored keeps its row: `added_at` tracks
        # Riot's own 24h expiry clock, which a re-save does not reset.
        stmt = select(RiotAPIKey).where(RiotAPIKey.key_value == update.value)
        result = await self.db.execute(stmt)
        target_key = result.scalar_one_or_none()
        if target_key is None:
            target_key = RiotAPIKey(key_value=update.value)
            self.db.add(target_key)
            await self.db.flush()

        # Delete before binding, so this takes its key-row locks before the
        # health-row lock -- the order `synchronize_riot_credential_health`
        # already uses. Binding first would lock health then wait on a key row
        # that a concurrent request holds, and the two would deadlock.
        #
        # `db_key_id` is `ON DELETE SET NULL`, so this may blank the binding on
        # its way past; `mark_database_credential_valid` re-binds it in the
        # same transaction, and reads the NULL as an identity change, which is
        # exactly right for a key that just got replaced.
        await self.db.execute(delete(RiotAPIKey).where(RiotAPIKey.id != target_key.id))
        await mark_database_credential_valid(
            self.db,
            target_key,
            evidence_at=datetime.now(UTC),
        )
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

    def _check_api_key_format(self, api_key: str) -> SettingValidationResponse | None:
        """Check API key format. Returns error response if invalid, None if valid."""
        if not api_key or len(api_key) < 10:
            return SettingValidationResponse(
                valid=False,
                status="invalid",
                message="API key is too short",
                details="Riot API keys should start with 'RGAPI-'",
            )

        if not api_key.startswith("RGAPI-"):
            return SettingValidationResponse(
                valid=False,
                status="invalid",
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

            response = await client.probe_credentials(test_url)

            logger.info(
                "riot_api_key_validated",
                status="success",
                response_type=type(response).__name__,
            )
            return SettingValidationResponse(
                valid=True,
                status="valid",
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
                    status="invalid",
                    message="API key is invalid",
                    details="Received 401 Unauthorized from Riot API. The API key format is correct but the key itself is not recognized.",
                )
            elif e.status_code == 403:
                logger.warning(
                    "riot_api_key_validation_failed", error="403", details=str(e)
                )
                return SettingValidationResponse(
                    valid=False,
                    status="invalid",
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
                    status="valid",
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
                "riot_api_key_validation_unavailable",
                error_type=type(e).__name__,
            )
            return SettingValidationResponse(
                valid=False,
                status="unavailable",
                message="Riot API validation is temporarily unavailable",
                details="The credential was not changed. Try again when Riot is reachable.",
            )

    async def test_riot_api_key(self, api_key: str) -> SettingTestResponse:
        """Test a Riot API key without saving it."""
        validation = await self.validate_riot_api_key(api_key)

        return SettingTestResponse(
            success=validation.valid,
            status=validation.status,
            message=validation.message,
            details=(
                {"validation_details": validation.details}
                if validation.details
                else None
            ),
        )

    # ===== CARD PREFERENCE METHODS =====

    async def get_card_preferences(self, user_id: int) -> list[CardPreferenceResponse]:
        """Return every approved card's effective v1 settings for one viewer."""
        result = await self.db.execute(
            select(UserCardPreference).where(UserCardPreference.user_id == user_id)
        )
        stored_preferences = result.scalars().all()
        current_preferences: dict[CardId, UserCardPreference] = {}
        future_versions: set[CardId] = set()

        for preference in stored_preferences:
            try:
                card_id = CardId(preference.card_id)
            except ValueError:
                logger.warning(
                    "card_preference_unknown_card_ignored",
                    user_id=user_id,
                    card_id=preference.card_id,
                    version=preference.version,
                )
                continue

            if preference.version == 1:
                current_preferences[card_id] = preference
            else:
                future_versions.add(card_id)

        responses: list[CardPreferenceResponse] = []
        for card_id in CardId:
            preference = current_preferences.get(card_id)
            if card_id in future_versions:
                logger.warning(
                    "card_preference_future_version_ignored",
                    user_id=user_id,
                    card_id=card_id.value,
                )
            if preference is None:
                settings, _warnings = normalize_stored_card_preference(card_id, {})
                responses.append(
                    CardPreferenceResponse(
                        card_id=card_id,
                        settings=serialize_card_preference_settings(settings),
                        is_default=True,
                    )
                )
                continue

            settings, ignored_fields = normalize_stored_card_preference(
                card_id, preference.settings
            )
            if ignored_fields:
                logger.warning(
                    "card_preference_legacy_fields_ignored",
                    user_id=user_id,
                    card_id=card_id.value,
                    ignored_fields=list(ignored_fields),
                )
            responses.append(
                CardPreferenceResponse(
                    card_id=card_id,
                    settings=serialize_card_preference_settings(settings),
                    is_default=False,
                    requires_recovery=bool(ignored_fields),
                    updated_at=preference.updated_at,
                )
            )
        return responses

    async def update_card_preference(
        self,
        user_id: int,
        card_id: CardId,
        update: CardPreferenceUpdate,
    ) -> CardPreferenceResponse:
        """Atomically replace the authenticated viewer's validated v1 override."""
        mutable_settings = validate_card_preference_update(card_id, update.settings)
        statement = (
            insert(UserCardPreference)
            .values(
                user_id=user_id,
                card_id=card_id.value,
                version=update.version,
                settings=mutable_settings,
            )
            .on_conflict_do_update(
                index_elements=[
                    UserCardPreference.user_id,
                    UserCardPreference.card_id,
                    UserCardPreference.version,
                ],
                set_={
                    "settings": mutable_settings,
                    "updated_at": func.now(),
                },
            )
            .returning(UserCardPreference)
        )
        result = await self.db.execute(statement)
        preference = result.scalar_one()
        await self.db.commit()

        settings, _warnings = normalize_stored_card_preference(
            card_id, preference.settings
        )
        logger.info(
            "card_preference_updated",
            user_id=user_id,
            card_id=card_id.value,
            version=update.version,
        )
        return CardPreferenceResponse(
            card_id=card_id,
            settings=serialize_card_preference_settings(settings),
            is_default=False,
            updated_at=preference.updated_at,
        )

    async def reset_card_preference(
        self, user_id: int, card_id: CardId
    ) -> CardPreferenceResponse:
        """Remove only the current v1 row, preserving any future-version row."""
        await self.db.execute(
            delete(UserCardPreference).where(
                UserCardPreference.user_id == user_id,
                UserCardPreference.card_id == card_id.value,
                UserCardPreference.version == 1,
            )
        )
        await self.db.commit()
        settings, _warnings = normalize_stored_card_preference(card_id, {})
        logger.info(
            "card_preference_reset",
            user_id=user_id,
            card_id=card_id.value,
            version=1,
        )
        return CardPreferenceResponse(
            card_id=card_id,
            settings=serialize_card_preference_settings(settings),
            is_default=True,
        )

    async def reset_all_card_preferences(
        self, user_id: int
    ) -> list[CardPreferenceResponse]:
        """Reset the current catalog while preserving unsupported card/version rows."""
        await self.db.execute(
            delete(UserCardPreference).where(
                UserCardPreference.user_id == user_id,
                UserCardPreference.version == 1,
                UserCardPreference.card_id.in_([card_id.value for card_id in CardId]),
            )
        )
        await self.db.commit()
        logger.info("all_card_preferences_reset", user_id=user_id, version=1)
        return [
            CardPreferenceResponse(
                card_id=card_id,
                settings=serialize_card_preference_settings(
                    normalize_stored_card_preference(card_id, {})[0]
                ),
                is_default=True,
            )
            for card_id in CardId
        ]

    # ===== USER SETTINGS METHODS =====

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
            CookieConsentLevel,
            UserCookieConsent,
        )

        consent_level = CookieConsentLevel(update.consent_level.value)

        # Selecting and then branching on the result raced: two concurrent PUTs
        # both saw no row, both inserted, and the loser got a 500 from
        # `user_cookie_consents_pkey`. One statement cannot lose that race.
        statement = (
            insert(UserCookieConsent)
            .values(
                user_id=user_id,
                consent_level=consent_level,
                consent_version=update.consent_version,
                consent_source=update.consent_source,
            )
            .on_conflict_do_update(
                index_elements=[UserCookieConsent.user_id],
                set_={
                    "consent_level": consent_level,
                    "consent_version": update.consent_version,
                    "consent_source": update.consent_source,
                    # `consented_at` records an explicit choice, so a repeat
                    # consent moves it, matching the previous update branch.
                    # `updated_at` is set here because its `onupdate` is an
                    # ORM-level hook that a Core ON CONFLICT never fires.
                    "consented_at": func.now(),
                    "updated_at": func.now(),
                },
            )
            .returning(UserCookieConsent)
        )
        result = await self.db.execute(statement)
        consent = result.scalar_one()
        await self.db.commit()

        logger.info(
            "updated_user_cookie_consent",
            user_id=user_id,
            consent_level=consent.consent_level.value,
            consent_version=consent.consent_version,
            consent_source=consent.consent_source,
        )

        return consent
