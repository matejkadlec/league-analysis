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
    AutoIncrementPK,
    Base,
    MatchIDField,
    MatchIDForeignKey,
    OptionalBigInt,
    OptionalBool,
    OptionalDateTime,
    OptionalDecimal,
    OptionalInt,
    OptionalString,
    PrimaryKeyInt,
    PrimaryKeyStr,
    PUUIDField,
    PUUIDForeignKey,
    RequiredBigInt,
    RequiredBool,
    RequiredDateTime,
    RequiredDecimal,
    RequiredInt,
    RequiredString,
)
from .validation import (
    is_empty_or_none,
    validate_list_items,
    validate_nested_fields,
    validate_required_fields,
)

__all__ = [
    "AutoIncrementPK",
    "Base",
    "DatabaseError",
    "MatchIDField",
    "MatchIDForeignKey",
    "OptionalBigInt",
    "OptionalBool",
    "OptionalDateTime",
    "OptionalDecimal",
    "OptionalInt",
    "OptionalString",
    "PUUIDField",
    "PUUIDForeignKey",
    "PlayerServiceError",
    "PrimaryKeyInt",
    "PrimaryKeyStr",
    "RequiredBigInt",
    "RequiredBool",
    "RequiredDateTime",
    "RequiredDecimal",
    "RequiredInt",
    "RequiredString",
    "ServiceException",
    "Settings",
    "Tier",
    "db_manager",
    "get_db",
    "get_global_settings",
    "get_riot_api_key",
    "get_settings",
    "is_empty_or_none",
    "validate_list_items",
    "validate_nested_fields",
    "validate_required_fields",
]
