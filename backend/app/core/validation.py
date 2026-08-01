"""Validation utilities for reducing complexity in API data validation."""

from typing import Any, Dict, List

import structlog

logger = structlog.get_logger(__name__)


def validate_required_fields(
    data: Dict[str, Any],
    required_fields: List[str],
    context_name: str = "data",
) -> bool:
    """Validate that all required fields are present in dictionary."""
    for field in required_fields:
        if field not in data:
            logger.warning("Missing required field", context=context_name, field=field)
            return False
    return True


def validate_nested_fields(
    data: Dict[str, Any],
    required_structure: Dict[str, List[str]],
) -> bool:
    """Validate nested dictionary structure with required fields."""
    for parent_key, required_fields in required_structure.items():
        nested_data = data.get(parent_key, {})
        if not isinstance(nested_data, dict):
            logger.warning(
                "Missing or invalid nested field",
                parent_key=parent_key,
                got_type=type(nested_data).__name__,
            )
            return False

        if not validate_required_fields(nested_data, required_fields, parent_key):
            return False

    return True


def validate_list_items(
    items: List[Dict[str, Any]],
    required_fields: List[str],
    context_name: str = "item",
    min_items: int = 1,
) -> bool:
    """Validate that list is non-empty and all items have required fields."""
    if not items or len(items) < min_items:
        logger.warning(
            "Insufficient items",
            context=context_name,
            count=len(items) if items else 0,
            min_required=min_items,
        )
        return False

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            logger.warning(
                f"Invalid {context_name} type",
                index=i,
                got_type=type(item).__name__,
            )
            return False

        if not validate_required_fields(item, required_fields, f"{context_name}[{i}]"):
            return False

    return True


def is_empty_or_none(value: Any) -> bool:
    """Check if value is None or empty (empty string, list, dict, etc.)."""
    if value is None:
        return True
    if isinstance(value, (str, list, dict, set, tuple)):
        return len(value) == 0
    return False
