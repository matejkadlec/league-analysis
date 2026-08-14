"""Shared player identity fallbacks used by match upserts."""

from typing import Any

from app.features.players.models import Player


def first_present(*values: Any, default: Any) -> Any:
    """Return the first truthy value, otherwise ``default``."""
    for value in values:
        if value:
            return value
    return default


def existing_player_attr(existing_player: Player | None, attr: str) -> Any:
    """Read one stored player field, or None when the row is missing."""
    if existing_player is None:
        return None
    return getattr(existing_player, attr)


def resolve_player_display_fields(
    participant: Any,
    existing_player: Player | None,
    platform_id: str,
) -> dict[str, Any]:
    """Preserve known identity fields when a Riot participant payload is incomplete."""
    fallback_tag = platform_id.replace("1", "") if platform_id else "RIOT"
    return {
        "game_name": first_present(
            participant.game_name,
            existing_player_attr(existing_player, "game_name"),
            participant.summoner_name,
            default="Unknown",
        ),
        "tag_line": first_present(
            participant.tag_line,
            existing_player_attr(existing_player, "tag_line"),
            default=fallback_tag,
        ),
        "profile_icon_id": first_present(
            participant.profile_icon,
            existing_player_attr(existing_player, "profile_icon_id"),
            default=29,
        ),
        "summoner_level": first_present(
            participant.summoner_level,
            existing_player_attr(existing_player, "summoner_level"),
            default=0,
        ),
        "is_tracked": existing_player.is_tracked if existing_player else False,
    }
