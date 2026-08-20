"""Response shapes shared across features."""

from pydantic import BaseModel, ConfigDict, Field


class PaginatedResponse(BaseModel):
    """The page envelope every list endpoint answers with.

    Spelled once so a page cannot mean `size` items on one endpoint and
    `page_size` on another, and so a client can read the four counters the same
    way everywhere. Subclasses add the list itself and anything specific to it.
    """

    total: int = Field(..., description="Total items available")
    page: int = Field(..., description="Current page number")
    size: int = Field(..., description="Number of items per page")
    pages: int = Field(..., description="Total number of pages")

    model_config = ConfigDict(from_attributes=True)
