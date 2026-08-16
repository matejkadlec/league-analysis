"""Shared Riot perk-payload flattening for match participant schemas."""

from typing import Any, TypeIs


def _is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow an unvalidated Riot payload to a string-keyed object.

    The perk payload arrives straight off the wire, so its declared type is a
    claim about the format rather than a guarantee; the runtime check stays and
    narrowing through it keeps the value typed for the callers below.
    """
    return isinstance(value, dict)


def transform_runes_payload(value: Any) -> dict[str, Any] | None:
    """Transform raw Riot API perks structure to flattened runes data."""
    if not _is_json_object(value):
        return value
    if "primary_style" in value:
        return value
    if "styles" not in value:
        return None
    return _flatten_riot_runes(value)


def _flatten_riot_runes(payload: dict[str, Any]) -> dict[str, Any]:
    """Flatten a Riot `styles` perk payload into schema field names."""
    styles = payload.get("styles", [])
    stat_perks = payload.get("statPerks", {})

    primary_style = None
    sub_style = None
    keystone = None
    primary_perks: list[Any] = []
    sub_perks: list[Any] = []

    for style in styles:
        description = style.get("description")
        selections = style.get("selections", [])
        if description == "primaryStyle":
            primary_style = style.get("style")
            primary_perks, keystone = _primary_style_perks(selections)
        elif description == "subStyle":
            sub_style = style.get("style")
            sub_perks = _perk_ids(selections)

    return {
        "primary_style": primary_style,
        "sub_style": sub_style,
        "keystone": keystone,
        "primary_perks": primary_perks,
        "sub_perks": sub_perks,
        "stat_perks": stat_perks,
    }


def _primary_style_perks(selections: Any) -> tuple[list[Any], Any]:
    """Return primary perk IDs and the keystone from a primary style block."""
    if not selections:
        return [], None
    return _perk_ids(selections), selections[0].get("perk")


def _perk_ids(selections: Any) -> list[Any]:
    """Collect perk IDs from Riot style selections."""
    return [selection.get("perk") for selection in selections]
