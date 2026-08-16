"""Shared Riot perk-payload flattening for match participant schemas."""

from typing import Any, TypeIs


def _is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow an unvalidated Riot payload to a string-keyed object.

    The perk payload arrives straight off the wire, so its declared type is a
    claim about the format rather than a guarantee; the runtime check stays and
    narrowing through it keeps the value typed for the callers below.
    """
    return isinstance(value, dict)


def transform_runes_payload(value: object) -> object:
    """Transform raw Riot API perks structure to flattened runes data.

    Anything that is not a Riot `styles` payload is handed back untouched for
    Pydantic to validate — `None`, an already-flattened mapping, or a
    `RunesData` instance read off the ORM. That pass-through is why the return
    type is `object` and not `dict[str, Any] | None`: the declared dict was
    only ever true for the one branch that flattens.
    """
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

    primary_style: int | None = None
    sub_style: int | None = None
    keystone: int | None = None
    primary_perks: list[int | None] = []
    sub_perks: list[int | None] = []

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


def _primary_style_perks(
    selections: list[dict[str, Any]],
) -> tuple[list[int | None], int | None]:
    """Return primary perk IDs and the keystone from a primary style block."""
    if not selections:
        return [], None
    return _perk_ids(selections), selections[0].get("perk")


def _perk_ids(selections: list[dict[str, Any]]) -> list[int | None]:
    """Collect perk IDs from Riot style selections.

    `None` is reachable: a selection without a `perk` key yields one, and
    `RunesData.primary_perks` is `list[int]`, so Pydantic rejects the payload
    rather than storing a hole. The optional element type records that.
    """
    return [selection.get("perk") for selection in selections]
