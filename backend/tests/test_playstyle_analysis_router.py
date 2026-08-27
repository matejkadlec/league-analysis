"""What the two playstyle-analysis routes answer, per service outcome.

Both routes are thin: one wraps the service call in the shared failure
answer, the other turns a missing analysis into a 404. Called directly, with
the service doubled, that is all there is to check.
"""

from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core.http_errors import SERVICE_ERROR_DETAIL
from app.features.auth.models import User
from app.features.playstyle_analysis.models import PlaystyleAnalysis
from app.features.playstyle_analysis.router import (
    analyze_playstyle,
    get_playstyle_analysis,
)
from app.features.playstyle_analysis.schemas import PlaystyleAnalysisRequest
from app.features.playstyle_analysis.service import PlaystyleAnalysisService

_PUUID = "p" * 78


def _request() -> Request:
    """Build the minimal request required by rate-limited route wrappers."""
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("127.0.0.1", 12345),
        }
    )


def _current_user() -> User:
    return cast(User, SimpleNamespace(id=7))


def _analysis() -> PlaystyleAnalysis:
    return cast(
        PlaystyleAnalysis,
        SimpleNamespace(puuid=_PUUID, tags={"early-roamer": SimpleNamespace()}),
    )


class _ServiceDouble:
    """Answers both route reads with one scripted outcome each.

    An `Exception` for the analyze answer is raised rather than returned,
    which is how the 500 path is reached without a database.
    """

    def __init__(
        self,
        *,
        analyze: PlaystyleAnalysis | Exception | None = None,
        latest: PlaystyleAnalysis | None = None,
    ) -> None:
        self._analyze = analyze
        self._latest = latest
        self.analyze_calls: list[dict[str, object]] = []
        self.latest_calls: list[str] = []

    async def analyze_playstyle(
        self, puuid: str, force: bool
    ) -> PlaystyleAnalysis | None:
        self.analyze_calls.append({"puuid": puuid, "force": force})
        if isinstance(self._analyze, Exception):
            raise self._analyze
        return self._analyze

    async def get_latest_analysis(self, puuid: str) -> PlaystyleAnalysis | None:
        self.latest_calls.append(puuid)
        return self._latest


async def test_analyze_returns_the_run_and_passes_the_force_flag() -> None:
    expected = _analysis()
    double = _ServiceDouble(analyze=expected)

    result = await analyze_playstyle(
        request=_request(),
        payload=PlaystyleAnalysisRequest(puuid=_PUUID, force_reanalyze=True),
        service=cast(PlaystyleAnalysisService, double),
        current_user=_current_user(),
    )

    assert result is expected
    assert double.analyze_calls == [{"puuid": _PUUID, "force": True}]


async def test_a_failed_analysis_answers_the_service_error_detail() -> None:
    double = _ServiceDouble(analyze=RuntimeError("analysis boom"))

    with pytest.raises(HTTPException) as caught:
        await analyze_playstyle(
            request=_request(),
            payload=PlaystyleAnalysisRequest(puuid=_PUUID),
            service=cast(PlaystyleAnalysisService, double),
            current_user=_current_user(),
        )

    assert caught.value.status_code == 500
    assert caught.value.detail == SERVICE_ERROR_DETAIL


async def test_a_missing_analysis_is_a_404_not_an_empty_payload() -> None:
    double = _ServiceDouble(latest=None)

    with pytest.raises(HTTPException) as caught:
        await get_playstyle_analysis(
            puuid=_PUUID,
            service=cast(PlaystyleAnalysisService, double),
            current_user=_current_user(),
        )

    assert caught.value.status_code == 404
    assert caught.value.detail == "Analysis not found for this player"
    assert double.latest_calls == [_PUUID]


async def test_the_latest_analysis_is_returned_unchanged() -> None:
    expected = _analysis()
    double = _ServiceDouble(latest=expected)

    result = await get_playstyle_analysis(
        puuid=_PUUID,
        service=cast(PlaystyleAnalysisService, double),
        current_user=_current_user(),
    )

    assert result is expected
