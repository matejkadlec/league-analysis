"""Strip the obsolete per-queue selection from Match Fetcher config.

Revision ID: 20260824_0031
Revises: 20260822_0030
Create Date: 2026-08-24
"""

from __future__ import annotations

from alembic import op

revision = "20260824_0031"
down_revision = "20260822_0030"
branch_labels = None
depends_on = None

# `enabled_queue_ids` stopped meaning anything when the Match Fetcher moved to
# one canonical supported queue set. Nothing has read it since, but the initial
# schema still seeds it (20260803_0001), and production row 1 still carried it
# -- read through the mirror on 2026-08-24, where it was the row's only key.
#
# It survived this long behind `normalize_match_fetcher_config`, a module whose
# entire job was popping the key out of every response and every update so a
# stale value could not restrict the queue set or leak back through the API.
# That module is deleted with this revision: once no row holds the key, there
# is nothing left for it to pop, and a normalizer kept "just in case" is a
# layer every future reader has to rule out before trusting what a config says.
#
# The seed in 20260803_0001 is left alone on purpose. Rewriting an applied
# migration to tidy a value this revision removes two lines later buys nothing:
# a fresh database writes the key at 0001 and loses it here, an existing one
# loses it here, and both end identical. The validator exercises exactly that
# path, which it could not do if the seed stopped writing the key.


def upgrade() -> None:
    op.execute(
        """
        UPDATE jobs.job_configurations
        SET config_json = config_json - 'enabled_queue_ids',
            updated_at = NOW()
        WHERE config_json ? 'enabled_queue_ids'
        """
    )


def downgrade() -> None:
    # Deliberately empty. The queue ids this dropped were already ignored by
    # every reader, so there is no behaviour to restore -- and the specific
    # values a row happened to hold are gone. Re-seeding the canonical four
    # would invent configuration that no account chose.
    pass
