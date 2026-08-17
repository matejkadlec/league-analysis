"""Authentication dependencies for protecting routes."""

import structlog
from fastapi import Depends, HTTPException, Request, status

from .cookies import ACCESS_TOKEN_COOKIE_NAME
from .models import User
from .service import AuthService, get_auth_service, oauth2_scheme

logger = structlog.get_logger(__name__)


def get_request_access_token(
    request: Request,
    bearer_token: str | None = Depends(oauth2_scheme),
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
    token: str = Depends(get_request_access_token),
    auth_service: AuthService = Depends(get_auth_service),
) -> User:
    """Get the current authenticated user."""
    return await auth_service.get_current_user(token)


async def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get the current active user (not disabled)."""
    if not current_user.is_active:
        logger.warning(
            "inactive_user_access_denied",
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_INACTIVE",
                "message": "This account is inactive. Contact an administrator to restore access.",
            },
        )
    return current_user


async def get_current_admin_user(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Get the current admin user."""
    if not current_user.is_admin:
        logger.warning(
            "admin_access_denied",
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ADMIN_REQUIRED",
                "message": "You need administrator access for this action.",
            },
        )
    return current_user
