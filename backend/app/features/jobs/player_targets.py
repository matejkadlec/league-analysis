"""Resolution of the players a run should touch.

`PlayerTargetsMixin` composes onto `BaseJob` subclasses that process
players, so the generic job framework never imports the players domain.
"""

from collections.abc import Callable
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.players.models import Player
from app.features.players.service import PlayerService


class _PlayerTargetsHost(Protocol):
    """The `BaseJob` surface the tracked-player resolution leans on.

    Annotated onto `self` rather than inherited: a base class here would put
    unimplemented members in the composing job's MRO.
    """

    target_puuids: set[str] | None
    add_log_entry: Callable[[str, object], None]


class PlayerTargetsMixin:
    """Which players a run processes, for jobs tied to the players domain."""

    async def _load_tracked_puuids(
        self: _PlayerTargetsHost, db: AsyncSession
    ) -> list[str]:
        """Load the global allowlist or the explicit target_puuids set.

        Identifiers, not rows: `handle_player_error` rolls back and expires the
        session's instances, turning the next attribute read into `MissingGreenlet`.
        """
        if self.target_puuids is None:
            players = await PlayerService(db).get_globally_tracked_players()
            return [player.puuid for player in players]

        result = await db.execute(
            select(Player.puuid).where(Player.puuid.in_(self.target_puuids))
        )
        tracked_players = list(result.scalars().all())
        self.add_log_entry("target_puuids", sorted(self.target_puuids))
        return tracked_players
