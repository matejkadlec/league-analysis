"""Response shapes, and the guards for payloads that arrive unvalidated."""

from typing import Any, TypeIs

from pydantic import BaseModel, ConfigDict, Field, computed_field


def is_json_object(value: object) -> TypeIs[dict[str, Any]]:
    """Narrow a blob whose declared type is a claim rather than a guarantee.

    Riot payloads off the wire and JSONB columns written by an older
    contract both reach Python as `object`. The runtime check is
    load-bearing at each of those boundaries, and narrowing through it is
    what keeps the read typed afterwards.
    """
    return isinstance(value, dict)


class MessageResponse(BaseModel):
    """One sentence, for a mutation whose only answer is that it worked.

    The alternative every route reached for otherwise was a bare `dict`, which
    FastAPI documents as an untyped object and no client can validate.
    """

    message: str


class PaginatedResponse(BaseModel):
    """The page envelope every list endpoint answers with.

    Spelled once so a page cannot mean `size` items on one endpoint and
    `page_size` on another, and so a client can read the four counters the same
    way everywhere. Subclasses add the list itself and anything specific to it.
    """

    total: int = Field(..., description="Total items available")
    page: int = Field(..., description="Current page number")
    size: int = Field(..., description="Number of items per page")

    model_config = ConfigDict(from_attributes=True)

    @computed_field(description="Total number of pages")
    @property
    def pages(self) -> int:
        """Derived, not supplied.

        Three call sites each computed this from `total` and `size`, in three
        spellings, and any one of them could have disagreed with the other two
        while every test stayed green. A caller cannot pass a wrong value for
        it any more, because there is nowhere to pass one.
        """
        return -(-self.total // self.size) if self.size > 0 else 0
