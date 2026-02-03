"""Authentication router with login, logout, and user management endpoints."""

from datetime import timedelta
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.core.rate_limiter import limiter
from app.core.dependencies import get_riot_client
from .dependencies import get_current_active_user, get_current_admin_user
from .models import User
from .schemas import Token, UserCreate, UserResponse, LinkRiotAccountRequest
from .service import AuthService, get_auth_service

if TYPE_CHECKING:
    from app.core.riot_api.client import RiotAPIClient

router = APIRouter()


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service),
) -> Token:
    """Login endpoint using OAuth2 password flow.

    Authenticates user with email and password, returns JWT access token.
    Updates last_login timestamp on successful authentication.
    """
    # Authenticate user
    user = await auth_service.authenticate_user(form_data.username, form_data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user account",
        )

    # Create access token
    access_token_expires = timedelta(
        minutes=auth_service.settings.jwt_access_token_expire_minutes
    )
    access_token = auth_service.create_access_token(
        data={"sub": user.email, "user_id": user.id},
        expires_delta=access_token_expires,
    )

    # Update last login timestamp
    await auth_service.update_last_login(user.id)

    return Token(access_token=access_token, token_type="bearer")  # nosec B106


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_active_user),
) -> dict[str, str]:
    """Logout endpoint (placeholder).

    NOTE: This is a placeholder endpoint. Since we're using stateless JWT tokens,
    logout is currently handled client-side by deleting the token.

    For proper logout functionality, implement token revocation/blacklisting.
    See docs/tasks/improve-auth.md for implementation details.

    TODO:
    - Implement JWT token blacklist (Redis cache recommended)
    - Store revoked tokens with expiration timestamps
    - Check blacklist in authentication middleware
    - Revoke tokens on password change and admin actions
    """
    # This endpoint exists to:
    # 1. Verify the user is authenticated
    # 2. Provide a standardized API for future token revocation
    # 3. Track last activity (could update last_login timestamp here)
    return {"message": "Successfully logged out"}


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_active_user),
) -> User:
    """Get current authenticated user information."""
    return current_user


@router.post(
    "/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
@limiter.limit("3/minute")
async def register_user(
    request: Request,
    user_create: UserCreate,
    auth_service: AuthService = Depends(get_auth_service),
) -> User:
    """Register a new user account.

    Password requirements:
    - At least 8 characters
    - At least one lowercase letter
    - At least one uppercase letter
    - At least one digit
    - At least one special character
    """
    return await auth_service.create_user(user_create)


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(get_current_admin_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> list[User]:
    """List all users (admin only)."""
    result = await auth_service.db.execute(select(User))
    return list(result.scalars().all())


@router.post("/connect-riot-account", response_model=UserResponse)
async def connect_riot_account(
    request: Request,
    link_request: LinkRiotAccountRequest,
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
    riot_client: Annotated["RiotAPIClient", Depends(get_riot_client)] = None,
) -> User:
    """Link a Riot account to the current user.

    Validates the player exists via Riot API and links the PUUID to the user.
    """
    from app.features.players.service import PlayerService

    player_service = PlayerService(auth_service.db)

    try:
        # Look up player from Riot API to get PUUID
        player = await player_service.add_and_track_player(
            riot_client=riot_client,
            game_name=link_request.game_name,
            tag_line=link_request.tag_line,
            platform=link_request.platform,
        )
    except Exception as e:
        error_msg = str(e)
        if "not found" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Player {link_request.game_name}#{link_request.tag_line} was not found on the selected server.",
            )
        # Check for API key errors - return 503 with specific code
        if (
            "401" in error_msg
            or "api key" in error_msg.lower()
            or "unauthorized" in error_msg.lower()
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="RIOT_API_KEY_INVALID",
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to verify player: {error_msg}",
        )

    # Update user with riot account info
    current_user.riot_account_connected = True
    current_user.puuid = player.puuid
    await auth_service.db.commit()
    await auth_service.db.refresh(current_user)

    return current_user
