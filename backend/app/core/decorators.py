"""Service layer decorators for error handling and validation."""

import annotationlib
import functools
import inspect
from collections.abc import Awaitable, Callable
from typing import Any, ParamSpec, TypeVar, cast

import structlog

from app.core.exceptions import (
    DatabaseError,
    ExternalServiceError,
    ServiceException,
    ValidationError,
)
from app.core.riot_api.errors import (
    AuthenticationError,
    ForbiddenError,
    RateLimitError,
    RiotAPIError,
)

logger = structlog.get_logger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


def _binding_signature(func: Callable[..., Any]) -> inspect.Signature:
    """Return a signature usable for binding arguments, without resolving annotations.

    These decorators only ever read parameter *names* and the values bound to
    them. Resolving annotations is therefore pure overhead — and worse, it is a
    trap: under PEP 649 a plain `inspect.signature()` evaluates each annotation,
    so decorating any method that annotates a `TYPE_CHECKING`-only import raises
    `NameError` at call time. Nothing static catches that; the failure only
    appears when the decorated method actually runs.

    `Format.STRING` keeps every annotation as text, so binding can never depend
    on a name being importable at runtime.
    """
    return inspect.signature(func, annotation_format=annotationlib.Format.STRING)


def service_error_handler(
    service_name: str,
    reraise: bool = True,
    include_context: bool = True,
    default_error_type: type[ServiceException] = ServiceException,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator for handling service errors with structured logging."""

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        operation_name = func.__name__
        signature = _binding_signature(func)
        # `async_wrapper` is only ever returned when `func` is a coroutine
        # function (see the `iscoroutinefunction` check below), so inside the
        # wrapper `func` really is awaitable.
        awaitable_func = cast("Callable[P, Awaitable[R]]", func)

        @functools.wraps(func)
        async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            bound_args = signature.bind(*args, **kwargs)
            bound_args.apply_defaults()

            context: dict[str, Any] = {
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
                result = await awaitable_func(*args, **kwargs)
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
                    raise validation_error from e
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
                    raise external_error from e
                return None  # type: ignore[return-value]

            except Exception as e:
                error_message = (
                    f"Unexpected error in {service_name}.{operation_name}: {e!s}"
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
                    raise error from e
                return None  # type: ignore[return-value]

        if inspect.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        else:
            return func

    return decorator


def input_validation(
    validate_non_empty: list[str] | None = None,
    validate_positive: list[str] | None = None,
    custom_validators: dict[str, Callable[[Any], None]] | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator for input validation in service methods."""

    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        signature = _binding_signature(func)
        # Only returned for coroutine functions, exactly as in
        # `service_error_handler`, so `func` is awaitable inside the wrapper.
        awaitable_func = cast("Callable[P, Awaitable[R]]", func)

        @functools.wraps(func)
        async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            bound_args = signature.bind(*args, **kwargs)
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

            return await awaitable_func(*args, **kwargs)

        if inspect.iscoroutinefunction(func):
            return async_wrapper  # type: ignore
        else:
            return func

    return decorator
