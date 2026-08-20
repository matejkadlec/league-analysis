"""The column every table that belongs to a user declares."""

from sqlalchemy import BigInteger, ForeignKey
from sqlalchemy.orm import MappedColumn, mapped_column


def user_id_column(
    comment: str | None = None,
    *,
    primary_key: bool = False,
    index: bool = False,
) -> MappedColumn[int]:
    """A reference to `auth.users.id` that goes away with the user.

    Eight tables across three features declared this, and the part that
    matters is the part they all had to remember: `ondelete="CASCADE"`. A
    ninth table that omitted it would not fail at import or in a migration --
    it would fail the first time someone deleted an account, in production,
    with a foreign-key violation. Saying it once is the point; the ~30 lines
    are incidental.

    `primary_key` covers the five tables keyed by their user, `index` the one
    that looks rows up by user without being keyed on it, and `comment` is the
    only other thing any of them varied. `None` is what SQLAlchemy already
    emits for an omitted comment, so the two tables that never had one stay
    byte-identical in the DDL.
    """
    return mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=primary_key,
        nullable=False,
        index=index,
        comment=comment,
    )
