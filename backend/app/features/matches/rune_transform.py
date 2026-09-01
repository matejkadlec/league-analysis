"""Shared Riot perk-payload flattening for match participant schemas."""

from typing import Any

from app.core.schemas import is_json_object


def transform_runes_payload(value: object) -> object:
    """Transform raw Riot API perks structure to flattened runes data.

    Anything that is not a Riot `styles` payload is handed back untouched for
    Pydantic to validate (hence `object`); widen `RunesData` alongside this.
    """
    if not is_json_object(value):
        return value
    if "primary_style" in value:
        return value
    if "styles" not in value:
        return None
    return _flatten_riot_runes(value)


def _flatten_riot_runes(payload: dict[str, Any]) -> dict[str, Any]:
    """Flatten a Riot `styles` perk payload into schema field names."""
    primary_style: int | None = None
    sub_style: int | None = None
    keystone: int | None = None

    for style in payload.get("styles", []):
        description = style.get("description")
        if description == "primaryStyle":
            primary_style = style.get("style")
            selections = style.get("selections", [])
            keystone = selections[0].get("perk") if selections else None
        elif description == "subStyle":
            sub_style = style.get("style")

    return {
        "primary_style": primary_style,
        "sub_style": sub_style,
        "keystone": keystone,
    }
