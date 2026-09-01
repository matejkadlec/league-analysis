"""The matchmaking analysis failure type.

Orchestration, the statistics, and the retry policy all raise it, so it lives
beside them rather than in `service.py`, which siblings would then import.
"""

from .schemas import MatchmakingErrorCode


class MatchmakingAnalysisRuntimeError(Exception):
    """Internal failure carrying only reviewed client-safe diagnostics."""

    code: MatchmakingErrorCode
    client_message: str

    def __init__(self, code: MatchmakingErrorCode, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.client_message = message
