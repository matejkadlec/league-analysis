"""Service layer custom exceptions."""

from typing import override


class ServiceException(Exception):
    """Base exception for service layer errors."""

    def __init__(
        self,
        message: str,
        service: str | None = None,
        operation: str | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.service = service
        self.operation = operation

    @override
    def __str__(self) -> str:
        if self.service and self.operation:
            return f"[{self.service}.{self.operation}] {self.message}"
        return self.message
