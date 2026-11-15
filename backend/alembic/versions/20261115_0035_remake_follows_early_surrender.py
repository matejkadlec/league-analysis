"""Derive a participant's remake flag from the match, not from the player.

Revision ID: 20261115_0035
Revises: 20260829_0034
Create Date: 2026-11-15
"""

from __future__ import annotations

import sqlalchemy as sa
import structlog
from alembic import op

revision = "20261115_0035"
down_revision = "20260829_0034"
branch_labels = None
depends_on = None

logger = structlog.get_logger(__name__)

OLD_COMMENT = "Inverted eligibleForProgression"
NEW_COMMENT = "Mirrors matches.early_surrender; a remake is a match-level fact"

# The two LP statements select on the flag the two mirror statements are
# about to correct, so they have to run before them.

# A completed ranked game stored as a remake was also handed a certain zero LP
# (`initialize_participant_lp`). That zero was never observed, so it goes back
# to unavailable under a reason of its own instead of posing as a pending one.
RESET_FALSE_REMAKE_LP = """
    UPDATE core.match_participants AS participant
    SET lp_change = NULL,
        lp_change_source = 'unavailable',
        lp_change_reason = 'remake_flag_corrected'
    FROM core.matches AS match
    WHERE match.match_id = participant.match_id
      AND match.early_surrender IS FALSE
      AND participant.remake IS TRUE
      AND participant.lp_change_source = 'riot_match_remake'
"""

# The other direction: a ranked row of a real remake that was not flagged gets
# the zero the writer now stores for it, unless a value was observed.
ZERO_UNFLAGGED_REMAKE_LP = """
    UPDATE core.match_participants AS participant
    SET lp_change = 0,
        lp_change_source = 'riot_match_remake',
        lp_change_reason = 'riot_early_surrender'
    FROM core.matches AS match
    WHERE match.match_id = participant.match_id
      AND match.early_surrender IS TRUE
      AND match.queue_id = 420
      AND participant.remake IS FALSE
      AND participant.lp_change_source = 'unavailable'
"""

CLEAR_FALSE_REMAKES = """
    UPDATE core.match_participants AS participant
    SET remake = FALSE
    FROM core.matches AS match
    WHERE match.match_id = participant.match_id
      AND match.early_surrender IS FALSE
      AND participant.remake IS TRUE
"""

FLAG_UNFLAGGED_REMAKES = """
    UPDATE core.match_participants AS participant
    SET remake = TRUE
    FROM core.matches AS match
    WHERE match.match_id = participant.match_id
      AND match.early_surrender IS TRUE
      AND participant.remake IS FALSE
"""

RENAME_REMAKE_LP_REASON = """
    UPDATE core.match_participants
    SET lp_change_reason = 'riot_early_surrender'
    WHERE lp_change_reason = 'riot_eligible_for_progression_false'
"""


def upgrade() -> None:
    """Make every stored remake flag agree with its match's early surrender.

    `remake` was `NOT eligibleForProgression`, a per-player marker Riot also
    clears for individual players in completed games, so full-length games were
    labelled Remake and left out of analyses. Idempotent: a second run matches
    no row.
    """
    connection = op.get_bind()

    def rows(statement: str) -> int:
        return connection.execute(sa.text(statement)).rowcount

    logger.info(
        "remake_flags_mirrored_from_early_surrender",
        false_remake_lp_rows_reset=rows(RESET_FALSE_REMAKE_LP),
        unflagged_remake_lp_rows_zeroed=rows(ZERO_UNFLAGGED_REMAKE_LP),
        completed_games_no_longer_remakes=rows(CLEAR_FALSE_REMAKES),
        remake_rows_newly_flagged=rows(FLAG_UNFLAGGED_REMAKES),
        remake_lp_reasons_renamed=rows(RENAME_REMAKE_LP_REASON),
    )
    op.alter_column(
        "match_participants",
        "remake",
        schema="core",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        comment=NEW_COMMENT,
        existing_comment=OLD_COMMENT,
    )


def downgrade() -> None:
    """Restore the column comment and nothing else.

    `eligibleForProgression` was never stored, so the flags this revision
    corrected cannot be put back without fetching every match again, and the
    values it wrote are the ones the older code already read correctly.
    """
    op.alter_column(
        "match_participants",
        "remake",
        schema="core",
        existing_type=sa.Boolean(),
        existing_nullable=False,
        comment=OLD_COMMENT,
        existing_comment=NEW_COMMENT,
    )
