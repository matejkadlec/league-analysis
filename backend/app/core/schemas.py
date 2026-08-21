"""Response shapes shared across features."""

from pydantic import BaseModel, ConfigDict, Field, computed_field


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
