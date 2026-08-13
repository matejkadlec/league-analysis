"""Shared Riot perk-payload flattening for match participant schemas."""

from typing import Any, Dict, List, Optional


def transform_runes_payload(value: Any) -> Optional[Dict[str, Any]]:
    """Transform raw Riot API perks structure to flattened runes data."""
    if not isinstance(value, dict):
        return value
    if "primary_style" in value:
        return value
    if "styles" not in value:
        return None
    return _flatten_riot_runes(value)


def _flatten_riot_runes(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten a Riot `styles` perk payload into schema field names."""
    styles = payload.get("styles", [])
    stat_perks = payload.get("statPerks", {})

    primary_style = None
    sub_style = None
    keystone = None
    primary_perks: List[Any] = []
    sub_perks: List[Any] = []

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


def _primary_style_perks(selections: Any) -> tuple[List[Any], Any]:
    """Return primary perk IDs and the keystone from a primary style block."""
    if not selections:
        return [], None
    return _perk_ids(selections), selections[0].get("perk")


def _perk_ids(selections: Any) -> List[Any]:
    """Collect perk IDs from Riot style selections."""
    return [selection.get("perk") for selection in selections]
