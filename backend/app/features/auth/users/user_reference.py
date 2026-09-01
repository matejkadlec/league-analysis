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

    The part to remember is `ondelete="CASCADE"`: omit it and nothing fails until
    someone deletes an account. `comment=None` matches an omitted comment.
    """
    return mapped_column(
        BigInteger,
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=primary_key,
        nullable=False,
        index=index,
        comment=comment,
    )
