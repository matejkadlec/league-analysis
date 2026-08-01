"""Core infrastructure module.

This module exports core utilities used across features.
Never imports from features - only from external libraries.
"""

from .config import Settings, get_global_settings, get_riot_api_key, get_settings
from .database import db_manager, get_db, get_session
from .enums import Tier
from .exceptions import (
    DatabaseError,
    ExternalServiceError,
    PlayerServiceError,
    ServiceException,
    ValidationError,
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
    # Config
    "Settings",
    "get_settings",
    "get_global_settings",
    "get_riot_api_key",
    # Database
    "get_db",
    "get_session",
    "db_manager",
    # Exceptions
    "ServiceException",
    "PlayerServiceError",
    "DatabaseError",
    "ValidationError",
    "ExternalServiceError",
    # Enums
    "Tier",
    # Validation
    "validate_required_fields",
    "validate_nested_fields",
    "validate_list_items",
    "is_empty_or_none",
    # Models
    "Base",
    "AutoIncrementPK",
    "PrimaryKeyStr",
    "PrimaryKeyInt",
    "RequiredString",
    "OptionalString",
    "RequiredInt",
    "OptionalInt",
    "RequiredBool",
    "OptionalBool",
    "RequiredDecimal",
    "OptionalDecimal",
    "RequiredBigInt",
    "OptionalBigInt",
    "RequiredDateTime",
    "OptionalDateTime",
    "PUUIDField",
    "PUUIDForeignKey",
    "MatchIDField",
    "MatchIDForeignKey",
]
