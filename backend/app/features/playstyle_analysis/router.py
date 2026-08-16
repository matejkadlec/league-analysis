"""Playstyle analysis API endpoints."""

import structlog
from fastapi import APIRouter, HTTPException

from .dependencies import PlaystyleAnalysisServiceDep
from .schemas import (
    PlaystyleAnalysisRequest,
    PlaystyleAnalysisResponse,
)

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/playstyle-analysis", tags=["playstyle-analysis"])


@router.post("/analyze", response_model=PlaystyleAnalysisResponse)
async def analyze_playstyle(
    request: PlaystyleAnalysisRequest, service: PlaystyleAnalysisServiceDep
):
    """
    Analyze player playstyle based on recent matches.
    Identifies playstyle tags and calculates summary statistics.
    """
    try:
        logger.info("starting_playstyle_analysis", puuid=request.puuid)

        result = await service.analyze_playstyle(
            puuid=request.puuid,
            force=request.force_reanalyze,
        )

        logger.info(
            "playstyle_analysis_completed",
            puuid=request.puuid,
            tags_count=len(result.tags),
        )

        return result

    except Exception as e:
        logger.error(
            "playstyle_analysis_failed",
            puuid=request.puuid,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail="Playstyle analysis failed") from e


@router.get("/player/{puuid}", response_model=PlaystyleAnalysisResponse)
async def get_playstyle_analysis(
    puuid: str,
    service: PlaystyleAnalysisServiceDep,
):
    """
    Get latest playstyle analysis for a player.
    """
    result = await service.get_latest_analysis(puuid)

    if not result:
        raise HTTPException(
            status_code=404, detail="Analysis not found for this player"
        )

    return result
