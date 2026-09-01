"""Error-chain walking and classification shared across features.

Jobs and the matches sync pipeline both classify failures through these
predicates.
"""

from collections.abc import Iterator

from sqlalchemy.exc import SQLAlchemyError

from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    PuuidDecryptionError,
)


def iter_error_chain(error: Exception) -> Iterator[Exception]:
    """Yield a wrapped exception and its reviewed causes without looping forever."""
    current: Exception | None = error
    seen: set[int] = set()

    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current

        # `__cause__` only, never `__context__` or a hand-rolled chain: every
        # predicate below is calibrated against `raise ... from`.
        current = (
            current.__cause__ if isinstance(current.__cause__, Exception) else None
        )


def diagnostic_error(error: Exception) -> Exception:
    """Return the most specific reviewed exception available for diagnostics."""
    chain = list(iter_error_chain(error))
    return chain[-1] if chain else error


def is_riot_api_key_error(error: Exception) -> bool:
    """Return whether Riot rejected or cannot obtain the configured API key."""
    return any(
        isinstance(item, (AuthenticationError, ForbiddenError))
        or getattr(item, "status_code", None) in (401, 403)
        for item in iter_error_chain(error)
    )


def is_riot_puuid_binding_error(error: Exception) -> bool:
    """Return whether Riot rejected a PUUID issued to another developer account."""
    return any(
        isinstance(item, PuuidDecryptionError) for item in iter_error_chain(error)
    )


def is_database_error(error: Exception) -> bool:
    """Return whether continuing would reuse a failed or unavailable DB session."""
    return any(isinstance(item, SQLAlchemyError) for item in iter_error_chain(error))
