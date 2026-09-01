"""Smurf and boost detection persistence and orchestration.

The computation reads only rows the ingestion jobs already stored, so it makes
no Riot API call, joins no rate limiter, and writes no Riot-owned table.
"""

from __future__ import annotations

import math
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast

import structlog
from sqlalchemy import ColumnElement, and_, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db_session import rollback_quietly
from app.core.riot_api.constants import RANKED_SOLO_QUEUE_ID, RANKED_SOLO_QUEUE_TYPE
from app.core.runs import active_run_filter, commit_new_run, guarded_run_update
from app.features.auth.users.user_card_preference import UserCardPreference
from app.features.matches.models import Match
from app.features.matches.participants import MatchParticipant
from app.features.players.leagues import PlayerLeague
from app.features.players.models import Player
from app.features.settings.schemas import CardId, normalize_stored_card_preference

from .composite import EligibleMatch
from .config import (
    COMPOSITE_WEIGHTS,
    DEFAULT_PRESET,
    MINIMUM_GAME_DURATION_SECONDS,
    MODEL_VERSION,
    PRESETS,
    RECOGNIZED_POSITIONS,
)
from .engine import AnalysisRequest, DetectionResult, analyze
from .models import SmurfBoostAnalysis
from .schemas import (
    ACTIVE_STATUSES,
    FamilyPayload,
    SignalPayload,
    SmurfBoostAnalysisResponse,
    SmurfBoostResults,
)

logger = structlog.get_logger(__name__)

RANKED_SOLO_QUEUE = RANKED_SOLO_QUEUE_TYPE

# The engine never needs more than the largest configurable windows combined.
MAX_WINDOW_MATCHES = 250

# An active row older than this belongs to a dead worker; without an expiry the
# partial unique index blocks every later run for that player forever.
ABANDONED_RUN_SECONDS = 600


def _to_float(value: Decimal | None) -> float:
    """Coerce a nullable numeric column into a plain float."""
    return float(value) if value is not None else 0.0


def _is_scorable(match: EligibleMatch) -> bool:
    """True when every metric this match contributes is a real number.

    A stored `NaN` would survive standardization and clamp to the positive bound,
    reading as maximum performance and pushing a band upward.
    """
    return all(math.isfinite(match.metric(name)) for name in sorted(COMPOSITE_WEIGHTS))


class SmurfBoostDetectionError(Exception):
    """Internal failure carrying only reviewed client-safe diagnostics."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.client_message = message


class SmurfBoostDetectionService:
    """Loads stored history, runs the model, and persists explained results."""

    def __init__(self, db: AsyncSession, user_id: int) -> None:
        self.db = db
        # The account every query here answers for; the service is built per
        # request, so one value serves its whole lifetime.
        self.user_id = user_id

    async def viewer_thresholds(self) -> dict[str, float]:
        """Resolve the signed-in viewer's stored thresholds over the defaults.

        Here rather than in the router, so no route reaches cross-feature into
        `auth.user_card_preference` for a second `Depends(get_db)`.
        """
        result = await self.db.execute(
            select(UserCardPreference.settings).where(
                UserCardPreference.user_id == self.user_id,
                UserCardPreference.card_id == CardId.SMURF_BOOST_DETECTION.value,
                UserCardPreference.version == 1,
            )
        )
        return resolve_thresholds(result.scalar_one_or_none())

    async def _load_eligible(self, puuid: str) -> list[EligibleMatch]:
        """The newest eligible ranked games for one player, newest first.

        The cap is applied in SQL: the engine never consumes more than the largest
        configurable windows combined, and stored accounts run far deeper.
        """
        result = await self.db.execute(
            select(MatchParticipant, Match)
            .join(Match, Match.match_id == MatchParticipant.match_id)
            .where(*self._eligibility_filter(puuid))
            .order_by(Match.game_start_timestamp.desc(), Match.match_id.desc())
            .limit(MAX_WINDOW_MATCHES)
        )
        loaded = [
            EligibleMatch(
                match_id=match.match_id,
                game_start_timestamp=match.game_start_timestamp,
                game_version=match.game_version,
                timestamp_source=match.game_start_timestamp_source,
                team_position=participant.team_position or "",
                champion_id=participant.champion_id,
                win=participant.win,
                kda=_to_float(participant.kda),
                gold_per_minute=_to_float(participant.gold_per_minute),
                kill_participation=_to_float(participant.kill_participation),
                team_damage_percentage=_to_float(participant.team_damage_percentage),
                vision_score_per_minute=_to_float(participant.vision_score_per_minute),
                total_minions_killed=participant.total_minions_killed or 0,
                neutral_minions_killed=participant.neutral_minions_killed or 0,
                time_played=participant.time_played or 0,
                game_duration=match.game_duration,
            )
            for participant, match in result.all()
        ]
        scorable = [match for match in loaded if _is_scorable(match)]
        if len(scorable) != len(loaded):
            logger.warning(
                "smurf_boost_unscorable_matches_dropped",
                puuid=puuid,
                dropped=len(loaded) - len(scorable),
            )
        return scorable

    def _eligibility_filter(self, puuid: str) -> list[ColumnElement[bool]]:
        """The one eligibility predicate every query in this feature shares."""
        return [
            MatchParticipant.puuid == puuid,
            MatchParticipant.remake.is_(False),
            MatchParticipant.team_position.in_(sorted(RECOGNIZED_POSITIONS)),
            Match.queue_id == RANKED_SOLO_QUEUE_ID,
            Match.game_duration >= MINIMUM_GAME_DURATION_SECONDS,
        ]

    async def _count_eligible(self, puuid: str) -> int:
        """Every eligible ranked game the player has, ignoring the load cap."""
        result = await self.db.execute(
            select(func.count())
            .select_from(MatchParticipant)
            .join(Match, Match.match_id == MatchParticipant.match_id)
            .where(*self._eligibility_filter(puuid))
        )
        return result.scalar_one() or 0

    async def _newest_eligible_match_id(self, puuid: str) -> str | None:
        """Identifier of the player's newest eligible game."""
        result = await self.db.execute(
            select(Match.match_id)
            .join(MatchParticipant, Match.match_id == MatchParticipant.match_id)
            .where(*self._eligibility_filter(puuid))
            .order_by(Match.game_start_timestamp.desc(), Match.match_id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _load_summoner_level(self, puuid: str) -> int | None:
        """Stored account level, which is only a weak account-age proxy."""
        result = await self.db.execute(
            select(Player.summoner_level).where(Player.puuid == puuid)
        )
        return result.scalar_one_or_none()

    async def _load_rank_span_days(self, puuid: str) -> float | None:
        """Span of stored ranked solo snapshots, in days."""
        result = await self.db.execute(
            select(
                func.count(PlayerLeague.created_at),
                func.min(PlayerLeague.created_at),
                func.max(PlayerLeague.created_at),
            ).where(
                PlayerLeague.puuid == puuid,
                PlayerLeague.queue_type == RANKED_SOLO_QUEUE,
            )
        )
        count, earliest, latest = result.one()
        if count < 2 or earliest is None or latest is None:
            return None
        return (latest - earliest).total_seconds() / 86400.0

    async def _prior_champion_games(
        self, puuid: str, recent_match_ids: list[str]
    ) -> dict[int, int]:
        """Champion counts over every eligible game outside the recent window.

        Reads the whole eligible history, not the capped window the engine scores:
        a champion is novel only when almost nothing of it is stored.
        """
        result = await self.db.execute(
            select(MatchParticipant.champion_id, func.count())
            .join(Match, Match.match_id == MatchParticipant.match_id)
            .where(
                *self._eligibility_filter(puuid),
                MatchParticipant.match_id.notin_(recent_match_ids),
            )
            .group_by(MatchParticipant.champion_id)
        )
        return {row[0]: row[1] for row in result.all()}

    async def _build_request(
        self, puuid: str, thresholds: dict[str, float]
    ) -> AnalysisRequest:
        """Assemble every input the pure engine needs."""
        eligible = await self._load_eligible(puuid)
        recent_size = int(thresholds["recent_window_size"])
        recent_match_ids = [match.match_id for match in eligible[:recent_size]]
        return AnalysisRequest(
            eligible=eligible,
            summoner_level=await self._load_summoner_level(puuid),
            rank_span_days=await self._load_rank_span_days(puuid),
            thresholds=thresholds,
            prior_champion_games=await self._prior_champion_games(
                puuid, recent_match_ids
            ),
            total_eligible_games=await self._count_eligible(puuid),
        )

    async def _newest_run(self, puuid: str) -> SmurfBoostAnalysis | None:
        """The most recently created run for a player, whatever its status."""
        result = await self.db.execute(
            select(SmurfBoostAnalysis)
            .where(
                SmurfBoostAnalysis.user_id == self.user_id,
                SmurfBoostAnalysis.puuid == puuid,
            )
            .order_by(SmurfBoostAnalysis.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _active_run(self, puuid: str) -> SmurfBoostAnalysis | None:
        """The one active run for a player, if any."""
        result = await self.db.execute(
            select(SmurfBoostAnalysis)
            .where(
                active_run_filter(
                    SmurfBoostAnalysis, ACTIVE_STATUSES, self.user_id, puuid
                )
            )
            .order_by(SmurfBoostAnalysis.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def _expire_abandoned(self, puuid: str) -> None:
        """Terminalize an active run whose worker is gone.

        The run executes inside its request, so a row older than the lease cannot
        still be computing; leaving it blocks the feature for that player.
        """
        cutoff = datetime.now(UTC) - timedelta(seconds=ABANDONED_RUN_SECONDS)
        result = await self.db.execute(
            update(SmurfBoostAnalysis)
            .where(
                and_(
                    active_run_filter(
                        SmurfBoostAnalysis, ACTIVE_STATUSES, self.user_id, puuid
                    ),
                    SmurfBoostAnalysis.created_at < cutoff,
                )
            )
            .values(
                status="failed",
                error_code="analysis_abandoned",
                error_message="The analysis did not finish. Please try again.",
                completed_at=datetime.now(UTC),
            )
        )
        expired = cast(CursorResult[Any], result).rowcount
        if expired:
            await self.db.commit()
            logger.warning(
                "smurf_boost_abandoned_run_expired", puuid=puuid, expired=expired
            )

    @staticmethod
    def _matches_configuration(
        run: SmurfBoostAnalysis, thresholds: dict[str, float]
    ) -> bool:
        """True when an existing run was computed the way this caller asked for.

        Thresholds can change between two in-flight requests, so the comparison
        is exact on the model version and every threshold value.
        """
        if run.model_version != MODEL_VERSION:
            return False
        stored = run.thresholds or {}
        if set(stored) != set(thresholds):
            return False
        return all(float(stored[key]) == value for key, value in thresholds.items())

    async def _claim_run(
        self, puuid: str, thresholds: dict[str, float]
    ) -> tuple[datetime | None, SmurfBoostAnalysis | None]:
        """Insert an active run, or return the concurrent one already present."""
        await self._expire_abandoned(puuid)
        existing = await self._active_run(puuid)
        if existing:
            if not self._matches_configuration(existing, thresholds):
                raise SmurfBoostDetectionError(
                    "analysis_in_progress",
                    "An analysis is already running for this player with "
                    "different settings. Please try again shortly.",
                )
            return None, existing

        now = datetime.now(UTC)
        run = SmurfBoostAnalysis(
            user_id=self.user_id,
            puuid=puuid,
            created_at=now,
            status="in_progress",
            model_version=MODEL_VERSION,
            thresholds=dict(thresholds),
        )
        conflict = await commit_new_run(self.db, run)
        if conflict is not None:
            # The race winner may already have finished, leaving no active row to
            # attach to; its completed result answers this identical request.
            concurrent = await self._active_run(puuid) or await self._newest_run(puuid)
            if not concurrent:
                logger.error(
                    "smurf_boost_detection_integrity_conflict",
                    puuid=puuid,
                    error_type=type(conflict).__name__,
                )
                raise conflict
            if not self._matches_configuration(concurrent, thresholds):
                raise SmurfBoostDetectionError(
                    "analysis_in_progress",
                    "An analysis is already running for this player with "
                    "different settings. Please try again shortly.",
                ) from None
            return None, concurrent
        return now, None

    async def _terminal(self, puuid: str, created_at: datetime, **values: Any) -> None:
        """Write one run's terminal state, guarded so it is never revived."""
        await guarded_run_update(
            self.db,
            SmurfBoostAnalysis,
            ACTIVE_STATUSES,
            self.user_id,
            puuid,
            created_at,
            completed_at=datetime.now(UTC),
            **values,
        )

    async def _finalize(
        self,
        puuid: str,
        created_at: datetime,
        result: DetectionResult,
        latest_match_id: str | None,
    ) -> None:
        """Write the completed run."""
        await self._terminal(
            puuid,
            created_at,
            status="completed",
            # The one boundary where the validated result model becomes the
            # JSONB document the column stores.
            results=_serialize(result).model_dump(mode="json"),
            eligible_games=result.eligible_games,
            latest_match_id=latest_match_id,
            error_code=None,
            error_message=None,
        )

    async def _fail(
        self, puuid: str, created_at: datetime, code: str, message: str
    ) -> None:
        """Record a terminal failure without leaking internal detail."""
        await self._terminal(
            puuid,
            created_at,
            status="failed",
            error_code=code,
            error_message=message,
        )

    async def _reload(
        self, puuid: str, created_at: datetime
    ) -> SmurfBoostAnalysis | None:
        """Re-read one run by its exact identity."""
        result = await self.db.execute(
            select(SmurfBoostAnalysis).where(
                and_(
                    SmurfBoostAnalysis.user_id == self.user_id,
                    SmurfBoostAnalysis.puuid == puuid,
                    SmurfBoostAnalysis.created_at == created_at,
                )
            )
        )
        return result.scalar_one_or_none()

    async def run_analysis(
        self, puuid: str, thresholds: dict[str, float]
    ) -> SmurfBoostAnalysisResponse:
        """Create or attach to one run and return its persisted state."""
        created_at, concurrent = await self._claim_run(puuid, thresholds)
        if concurrent is not None:
            logger.info("smurf_boost_attached_to_active_run", puuid=puuid)
            return self._to_response(
                concurrent, is_stale=await self._is_stale(concurrent)
            )

        assert created_at is not None
        try:
            request = await self._build_request(puuid, thresholds)
            result = analyze(request)
            latest = request.eligible[0].match_id if request.eligible else None
            await self._finalize(puuid, created_at, result, latest)
        except SmurfBoostDetectionError as error:
            logger.warning(
                "smurf_boost_detection_failed",
                puuid=puuid,
                created_at=created_at,
                error_code=error.code,
                error_type=type(error).__name__,
            )
            await rollback_quietly(self.db)
            await self._fail(puuid, created_at, error.code, error.client_message)
        except Exception as error:
            logger.error(
                "smurf_boost_analysis_failed",
                puuid=puuid,
                error_type=type(error).__name__,
                exc_info=True,
            )
            # The failure may have come from the session itself, which cannot
            # accept the terminal write until the broken transaction is gone.
            await rollback_quietly(self.db)
            await self._fail(
                puuid,
                created_at,
                "analysis_failed",
                "The analysis did not finish. Please try again.",
            )

        run = await self._reload(puuid, created_at)
        if run is None:
            raise SmurfBoostDetectionError(
                "analysis_missing",
                "The analysis could not be read back. Please try again.",
            )
        return self._to_response(run, is_stale=False)

    async def get_latest(self, puuid: str) -> SmurfBoostAnalysisResponse | None:
        """The newest run for a player, with a computed staleness flag.

        Expires abandoned runs first: the page offers no way to start a new run
        while one looks active, so a client would poll forever.
        """
        await self._expire_abandoned(puuid)
        run = await self._newest_run(puuid)
        if run is None:
            return None
        return self._to_response(run, is_stale=await self._is_stale(run))

    async def _is_stale(self, run: SmurfBoostAnalysis) -> bool:
        """True when a newer eligible game exists than the run considered.

        Compares match identifiers rather than counts, which stays correct when
        the loaded history is capped.
        """
        if run.status != "completed":
            return False
        return await self._newest_eligible_match_id(run.puuid) != run.latest_match_id

    @staticmethod
    def _to_response(
        run: SmurfBoostAnalysis, is_stale: bool
    ) -> SmurfBoostAnalysisResponse:
        """Build the API response for one persisted run."""
        response = SmurfBoostAnalysisResponse.model_validate(run)
        return response.model_copy(update={"is_stale": is_stale})


def _serialize(result: DetectionResult) -> SmurfBoostResults:
    """Convert the engine result into the stored and wire-validated model.

    Goes through `SmurfBoostResults` rather than `asdict`, so stored document and
    HTTP response share one validated shape that drops the internal family score.
    """
    return SmurfBoostResults(
        model_version=result.model_version,
        families=[
            FamilyPayload(
                family=family.family,
                band=family.band,
                distinct_evidence=family.distinct_evidence,
                signals=[
                    SignalPayload(
                        id=signal.signal_id,
                        family=family.family,
                        **{
                            key: value
                            for key, value in asdict(signal).items()
                            if key != "signal_id"
                        },
                    )
                    for signal in family.signals
                ],
            )
            for family in result.families
        ],
        confidence=result.confidence,
        confidence_band=result.confidence_band,
        recent_games=result.recent_games,
        baseline_games=result.baseline_games,
        eligible_games=result.eligible_games,
        notes=list(result.notes),
    )


def resolve_thresholds(settings: dict[str, Any] | None) -> dict[str, float]:
    """Recover a valid threshold set from whatever the viewer has stored.

    Delegates to the card catalog, the one authority for ranges, so no stored row
    can hand the model a value its magnitude ramp cannot divide by.
    """
    normalized, _ignored = normalize_stored_card_preference(
        CardId.SMURF_BOOST_DETECTION, settings if isinstance(settings, dict) else {}
    )
    return {
        key: float(normalized[key])
        for key in PRESETS[DEFAULT_PRESET]
        if key in normalized
    }
