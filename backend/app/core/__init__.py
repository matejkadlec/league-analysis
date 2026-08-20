"""Core infrastructure module.

This module exports core utilities used across features.
Never imports from features - only from external libraries.
"""

from .config import Settings, get_global_settings, get_riot_api_key, get_settings
from .database import db_manager, get_db
from .enums import Tier
from .exceptions import (
    DatabaseError,
    PlayerServiceError,
    ServiceException,
)
from .models import (
    Base,
)

__all__ = [
    "Base",
    "DatabaseError",
    "PlayerServiceError",
    "ServiceException",
    "Settings",
    "Tier",
    "db_manager",
    "get_db",
    "get_global_settings",
    "get_riot_api_key",
    "get_settings",
]
