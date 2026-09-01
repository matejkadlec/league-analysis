"""Authentication dependencies for protecting routes."""

from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.http_errors import http_error

from .service import AuthService, oauth2_scheme
from .tokens.cookies import ACCESS_TOKEN_COOKIE_NAME
from .users.models import User

logger = structlog.get_logger(__name__)


def get_auth_service(db: Annotated[AsyncSession, Depends(get_db)]) -> AuthService:
    """Get auth service instance."""
    return AuthService(db)


def get_request_access_token(
    request: Request,
    bearer_token: Annotated[str | None, Depends(oauth2_scheme)],
) -> str:
    """Prefer the Authorization header, then the HttpOnly access cookie."""
    if bearer_token:
        return bearer_token
    cookie_token = request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(
    token: Annotated[str, Depends(get_request_access_token)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    """Get the current authenticated user."""
    return await auth_service.get_current_user(token)


async def get_current_active_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Get the current active user (not disabled)."""
    if not current_user.is_active:
        logger.warning(
            "inactive_user_access_denied",
            user_id=current_user.id,
        )
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "ACCOUNT_INACTIVE",
            "This account is inactive. Contact an administrator to restore access.",
        )
    return current_user


async def get_current_admin_user(
    current_user: Annotated[User, Depends(get_current_active_user)],
) -> User:
    """Get the current admin user."""
    if not current_user.is_admin:
        logger.warning(
            "admin_access_denied",
            user_id=current_user.id,
        )
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "ADMIN_REQUIRED",
            "You need administrator access for this action.",
        )
    return current_user


# Spelled once, matching `JobServiceDep`; gate forbid-restated-user-dependency
# keeps routes off the raw `Annotated[User, Depends(...)]` form.
CurrentUserDep = Annotated[User, Depends(get_current_active_user)]
AdminUserDep = Annotated[User, Depends(get_current_admin_user)]

__all__ = [
    "AdminUserDep",
    "CurrentUserDep",
    "get_auth_service",
    "get_current_active_user",
    "get_current_admin_user",
    "get_current_user",
    "get_request_access_token",
]
