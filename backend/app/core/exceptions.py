"""Service layer custom exceptions."""

from typing import Any, override

import structlog

logger = structlog.get_logger(__name__)


class ServiceException(Exception):
    """Base exception for service layer errors."""

    def __init__(
        self,
        message: str,
        service: str | None = None,
        operation: str | None = None,
        context: dict[str, Any] | None = None,
        original_error: Exception | None = None,
    ):
        super().__init__(message)
        self.message = message
        self.service = service
        self.operation = operation
        self.context = context or {}
        self.original_error = original_error

    @override
    def __str__(self) -> str:
        if self.service and self.operation:
            return f"[{self.service}.{self.operation}] {self.message}"
        return self.message


class PlayerServiceError(ServiceException):
    """Exception for player operations."""

    def __init__(
        self,
        message: str,
        operation: str | None = None,
        context: dict[str, Any] | None = None,
        original_error: Exception | None = None,
    ):
        super().__init__(
            message=message,
            service="PlayerService",
            operation=operation,
            context=context,
            original_error=original_error,
        )


class DatabaseError(ServiceException):
    """Exception for database errors."""

    def __init__(
        self,
        message: str,
        service: str | None = None,
        operation: str | None = None,
        context: dict[str, Any] | None = None,
        original_error: Exception | None = None,
    ):
        super().__init__(
            message=f"Database error: {message}",
            service=service,
            operation=operation,
            context=context,
            original_error=original_error,
        )
