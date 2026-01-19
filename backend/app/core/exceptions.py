"""Service layer custom exceptions."""

from typing import Any, Dict, Optional
import structlog

logger = structlog.get_logger(__name__)


class ServiceException(Exception):
    """Base exception for service layer errors."""

    def __init__(
        self,
        message: str,
        service: Optional[str] = None,
        operation: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(message)
        self.message = message
        self.service = service
        self.operation = operation
        self.context = context or {}
        self.original_error = original_error

    def __str__(self) -> str:
        if self.service and self.operation:
            return f"[{self.service}.{self.operation}] {self.message}"
        return self.message


class PlayerServiceError(ServiceException):
    """Exception for player operations."""

    def __init__(
        self,
        message: str,
        operation: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        original_error: Optional[Exception] = None,
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
        service: Optional[str] = None,
        operation: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
        original_error: Optional[Exception] = None,
    ):
        super().__init__(
            message=f"Database error: {message}",
            service=service,
            operation=operation,
            context=context,
            original_error=original_error,
        )


class ValidationError(ServiceException):
    """Exception for input validation errors."""

    def __init__(
        self,
        message: str,
        service: Optional[str] = None,
        operation: Optional[str] = None,
        field: Optional[str] = None,
        value: Optional[Any] = None,
        context: Optional[Dict[str, Any]] = None,
    ):
        validation_context = context or {}
        if field:
            validation_context["field"] = field
        if value is not None:
            validation_context["value"] = str(value)

        super().__init__(
            message=f"Validation error: {message}",
            service=service,
            operation=operation,
            context=validation_context,
        )


class ExternalServiceError(ServiceException):
    """Exception for external API errors (e.g., Riot API)."""

    def __init__(
        self,
        message: str,
        service: Optional[str] = None,
        operation: Optional[str] = None,
        external_service: Optional[str] = None,
        status_code: Optional[int] = None,
        context: Optional[Dict[str, Any]] = None,
        original_error: Optional[Exception] = None,
    ):
        external_context = context or {}
        if external_service:
            external_context["external_service"] = external_service
        if status_code:
            external_context["status_code"] = status_code

        super().__init__(
            message=f"External service error: {message}",
            service=service,
            operation=operation,
            context=external_context,
            original_error=original_error,
        )
