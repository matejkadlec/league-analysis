"""Validation utilities for reducing complexity in API data validation."""

from collections.abc import Sized
from typing import Any, TypeIs

import structlog

logger = structlog.get_logger(__name__)


def _is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow a decoded-JSON value to a string-keyed object.

    These helpers validate payloads straight off the wire, so a value annotated
    as a dict is a claim about the format rather than a guarantee. The runtime
    check therefore stays, and narrowing through it keeps the value typed for
    the callers below.
    """
    return isinstance(value, dict)


def _is_sized_value(value: object) -> TypeIs[Sized]:
    """Narrow to the container types `is_empty_or_none` treats as emptiable.

    Deliberately not an `isinstance(value, Sized)` test: any other object with
    a `__len__` must keep answering "not empty".
    """
    return isinstance(value, (str, list, dict, set, tuple))


def validate_required_fields(
    data: dict[str, Any],
    required_fields: list[str],
    context_name: str = "data",
) -> bool:
    """Validate that all required fields are present in dictionary."""
    for field in required_fields:
        if field not in data:
            logger.warning("Missing required field", context=context_name, field=field)
            return False
    return True


def validate_nested_fields(
    data: dict[str, Any],
    required_structure: dict[str, list[str]],
) -> bool:
    """Validate nested dictionary structure with required fields."""
    for parent_key, required_fields in required_structure.items():
        nested_data = data.get(parent_key, {})
        if not _is_json_object(nested_data):
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
    items: list[dict[str, Any]],
    required_fields: list[str],
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
        if not _is_json_object(item):
            logger.warning(
                f"Invalid {context_name} type",
                index=i,
                got_type=type(item).__name__,
            )
            return False

        if not validate_required_fields(item, required_fields, f"{context_name}[{i}]"):
            return False

    return True


def is_empty_or_none(value: object) -> bool:
    """Check if value is None or empty (empty string, list, dict, etc.)."""
    if value is None:
        return True
    if _is_sized_value(value):
        return len(value) == 0
    return False
