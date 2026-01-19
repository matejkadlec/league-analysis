"""Service layer decorators for error handling and validation."""

import functools
import inspect
import structlog
from typing import Any, Callable, Dict, Optional, Type, ParamSpec, TypeVar

from app.core.exceptions import (
    DatabaseError,
    ExternalServiceError,
    ServiceException,
    ValidationError,
)
from app.core.riot_api.errors import (
    RiotAPIError,
    RateLimitError,
    AuthenticationError,
    ForbiddenError,
)

logger = structlog.get_logger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


def service_error_handler(
    service_name: str,
    reraise: bool = True,
    include_context: bool = True,
    default_error_type: Type[ServiceException] = ServiceException,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator for handling service errors with structured logging."""

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        operation_name = func.__name__

        @functools.wraps(func)
        async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            sig = inspect.signature(func)
            bound_args = sig.bind(*args, **kwargs)
            bound_args.apply_defaults()

            context: Dict[str, Any] = {
                "service": service_name,
                "operation": operation_name,
            }

            if include_context:
                for name, value in bound_args.arguments.items():
                    if name not in ["self", "db", "session"]:
                        if isinstance(value, str) and len(value) > 100:
                            context[name] = value[:100] + "..."
                        else:
                            context[name] = (
                                str(value)[:200] if value is not None else None
                            )

            try:
                logger.debug("Service method called", **context)
                result = await func(*args, **kwargs)  # type: ignore[misc]
                logger.debug("Service method completed", **context)
                return result

            except (
                RateLimitError,
                AuthenticationError,
                ForbiddenError,
                RiotAPIError,
            ) as e:
                logger.warning(
                    "Riot API error - propagating to caller",
                    error_type=e.__class__.__name__,
                    error_message=str(e),
                    status_code=getattr(e, "status_code", None),
                    **context,
                )
                raise

            except ServiceException as e:
                logger.error(
                    "Service operation failed",
                    error_type=e.__class__.__name__,
                    error_message=str(e),
                    error_context=e.context,
                    **context,
                )
                if reraise:
                    raise
                return None  # type: ignore[return-value]

            except ValueError as e:
                validation_error = ValidationError(
                    message=str(e),
                    service=service_name,
                    operation=operation_name,
                    context=context if include_context else {},
                )
                logger.error("Validation error", error_message=str(e), **context)
                if reraise:
                    raise validation_error
                return None  # type: ignore[return-value]

            except (ConnectionError, TimeoutError) as e:
                external_error = ExternalServiceError(
                    message=str(e),
                    service=service_name,
                    operation=operation_name,
                    context=context if include_context else {},
                    original_error=e,
                )
                logger.error(
                    "External service error",
                    error_type=type(e).__name__,
                    error_message=str(e),
                    **context,
                )
                if reraise:
                    raise external_error
                return None  # type: ignore[return-value]

            except Exception as e:
                error_message = (
                    f"Unexpected error in {service_name}.{operation_name}: {str(e)}"
                )

                if any(
                    keyword in str(e).lower()
                    for keyword in ["database", "sql", "connection", "transaction"]
                ):
                    error = DatabaseError(
                        message=str(e),
                        service=service_name,
                        operation=operation_name,
                        context=context if include_context else {},
                        original_error=e,
                    )
                else:
                    error = default_error_type(
                        message=error_message,
                        service=service_name,
                        operation=operation_name,
                        context=context if include_context else {},
                        original_error=e,
                    )

                logger.error(
                    "Unexpected error",
                    error_type=e.__class__.__name__,
                    error_message=str(e),
                    **context,
                )

                if reraise:
                    raise error
                return None  # type: ignore[return-value]

        if inspect.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        else:
            return func  # type: ignore

    return decorator


def input_validation(
    validate_non_empty: Optional[list[str]] = None,
    validate_positive: Optional[list[str]] = None,
    custom_validators: Optional[Dict[str, Callable[[Any], None]]] = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator for input validation in service methods."""

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            sig = inspect.signature(func)
            bound_args = sig.bind(*args, **kwargs)
            bound_args.apply_defaults()

            if validate_non_empty:
                for param_name in validate_non_empty:
                    if param_name in bound_args.arguments:
                        value = bound_args.arguments[param_name]
                        if value is None or (
                            isinstance(value, str) and not value.strip()
                        ):
                            raise ValueError(f"{param_name} cannot be empty")

            if validate_positive:
                for param_name in validate_positive:
                    if param_name in bound_args.arguments:
                        value = bound_args.arguments[param_name]
                        if isinstance(value, (int, float)) and value <= 0:
                            raise ValueError(f"{param_name} must be positive")

            if custom_validators:
                for param_name, validator in custom_validators.items():
                    if param_name in bound_args.arguments:
                        value = bound_args.arguments[param_name]
                        if value is not None:
                            validator(value)

            return await func(*args, **kwargs)  # type: ignore

        if inspect.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        else:
            return func  # type: ignore

    return decorator
