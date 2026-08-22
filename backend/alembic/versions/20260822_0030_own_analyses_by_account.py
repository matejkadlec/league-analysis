"""Give both analysis tables an owning account.

Revision ID: 20260822_0030
Revises: 20260821_0029
Create Date: 2026-08-22
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260822_0030"
down_revision = "20260821_0029"
branch_labels = None
depends_on = None

# Both analysis tables were keyed by `(puuid, created_at)` and nothing else,
# so a stored run belonged to the Riot player rather than to the account that
# asked for it. Two consequences, neither of them theoretical:
#
#   * `smurf_boost_analyses` rows carry the *viewer's* thresholds, resolved
#     per account from `auth.user_card_preferences`. The newest-run lookup
#     ignored thresholds entirely, so whichever account ran last decided what
#     every other account saw -- scored against settings they never chose, and
#     shown beside a settings card telling them those settings are theirs
#     alone.
#   * Every `matchmaking_analyses` endpoint identified a run by
#     `(puuid, created_at)`, and `created_at` is returned by the list and
#     status endpoints. Cancel and delete were therefore reachable across
#     accounts: any signed-in user could kill another's running analysis or
#     permanently delete their completed record.
#
# The column is NOT NULL because a run with no owner is exactly the state that
# caused this, and a nullable column would let one back in the first time a
# writer forgot. That means existing rows need an owner or need to go.
#
# Production, read 2026-08-22 before writing this: 5 `smurf_boost_analyses`
# rows and 8 `matchmaking_analyses` rows, over 2 PUUIDs, against 4 active
# accounts. There is no way to recover who ran them -- the tables carry no
# field that could say -- and at that volume a re-run costs a button press:
# Rank Manipulation recomputes from stored matches inside the request, and a
# matchmaking re-run re-reads matches that are already stored. So they are
# deleted rather than guessed at. Backfilling them to an arbitrary account
# would be inventing the very attribution this revision exists to make real.
#
# The active-run partial unique indexes move to `(user_id, puuid)`. They exist
# so one viewer cannot stack two runs on the same player; puuid-wide, they
# also let either account lock the other out.


def upgrade() -> None:
    for table in ("smurf_boost_analyses", "matchmaking_analyses"):
        op.execute(sa.text(f"DELETE FROM core.{table}"))
        op.add_column(
            table,
            sa.Column(
                "user_id",
                sa.BigInteger(),
                nullable=False,
                comment=(
                    "Account that ran this analysis and is the only one shown it"
                    if table == "smurf_boost_analyses"
                    else "Account that started this analysis and is the only one "
                    "it answers to"
                ),
            ),
            schema="core",
        )
        op.create_foreign_key(
            f"fk_{table}_user_id_users",
            table,
            "users",
            ["user_id"],
            ["id"],
            source_schema="core",
            referent_schema="auth",
            ondelete="CASCADE",
        )
        op.create_index(f"ix_{table}_user_id", table, ["user_id"], schema="core")

    op.drop_index(
        "uq_smurf_boost_analyses_active_puuid",
        table_name="smurf_boost_analyses",
        schema="core",
    )
    op.create_index(
        "uq_smurf_boost_analyses_active_puuid",
        "smurf_boost_analyses",
        ["user_id", "puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("status IN ('pending', 'in_progress')"),
    )

    op.drop_index(
        "uq_matchmaking_analyses_active_puuid",
        table_name="matchmaking_analyses",
        schema="core",
    )
    op.create_index(
        "uq_matchmaking_analyses_active_puuid",
        "matchmaking_analyses",
        ["user_id", "puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text(
            "status IN ('pending', 'in_progress', 'waiting_rate_limit')"
        ),
    )


def downgrade() -> None:
    # Rows written while ownership existed cannot be un-owned into a shared
    # table without handing every account everyone else's runs, which is the
    # defect this revision closes. Emptying both tables is the honest reverse
    # of a migration that emptied them going forward.
    op.drop_index(
        "uq_matchmaking_analyses_active_puuid",
        table_name="matchmaking_analyses",
        schema="core",
    )
    op.create_index(
        "uq_matchmaking_analyses_active_puuid",
        "matchmaking_analyses",
        ["puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text(
            "status IN ('pending', 'in_progress', 'waiting_rate_limit')"
        ),
    )

    op.drop_index(
        "uq_smurf_boost_analyses_active_puuid",
        table_name="smurf_boost_analyses",
        schema="core",
    )
    op.create_index(
        "uq_smurf_boost_analyses_active_puuid",
        "smurf_boost_analyses",
        ["puuid"],
        unique=True,
        schema="core",
        postgresql_where=sa.text("status IN ('pending', 'in_progress')"),
    )

    for table in ("smurf_boost_analyses", "matchmaking_analyses"):
        op.execute(sa.text(f"DELETE FROM core.{table}"))
        op.drop_index(f"ix_{table}_user_id", table_name=table, schema="core")
        op.drop_constraint(
            f"fk_{table}_user_id_users", table, schema="core", type_="foreignkey"
        )
        op.drop_column(table, "user_id", schema="core")
