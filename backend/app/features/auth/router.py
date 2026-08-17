"""Authentication router with login, refresh, logout, and user management endpoints."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.core.rate_limiter import rate_limit

from .cookies import (
    REFRESH_TOKEN_COOKIE_NAME,
    clear_auth_cookies,
    set_auth_cookies,
)
from .dependencies import (
    get_current_active_user,
    get_current_admin_user,
    get_request_access_token,
)
from .models import User
from .schemas import (
    EmailChangeCodeResponse,
    EmailChangeRequest,
    EmailChangeVerifyRequest,
    JoinUsContactRequest,
    MessageResponse,
    PasswordChangeRequest,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserProfileUpdate,
    UserResponse,
)
from .service import (
    AccountLockedError,
    AuthService,
    CaptchaRequiredError,
    CaptchaVerificationError,
    EmailAlreadyRegisteredError,
    EmailChangeLockedError,
    EmailUnchangedError,
    EmailVerificationCodeExpiredError,
    EmailVerificationRequestNotFoundError,
    InvalidCurrentPasswordError,
    InvalidEmailVerificationCodeError,
    JoinUsBodyTooShortError,
    JoinUsCaptchaRequiredError,
    JoinUsCaptchaVerificationError,
    JoinUsEmailDeliveryError,
    JoinUsEmailNotConfiguredError,
    JoinUsRateLimitExceededError,
    get_auth_service,
)

router = APIRouter()


@router.post("/login", response_model=Token)
@rate_limit("5/minute")
async def login(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    captcha_token: str | None = Form(default=None),
    auth_service: AuthService = Depends(get_auth_service),
) -> Token:
    """Authenticate user credentials and issue an access token.

    Includes brute-force protections:
    - temporary account lockout after repeated failed attempts
    - adaptive CAPTCHA requirement once failure threshold is reached
    """
    try:
        user = await auth_service.authenticate_user(
            email=form_data.username,
            password=form_data.password,
            captcha_token=captcha_token,
            remote_ip=request.client.host if request.client else None,
        )
    except AccountLockedError as e:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail={
                "code": "ACCOUNT_LOCKED",
                "message": "Account is temporarily locked after repeated failed sign-in attempts.",
                "locked_until": e.locked_until.astimezone(UTC).isoformat(),
            },
        ) from e
    except CaptchaRequiredError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CAPTCHA_REQUIRED",
                "message": "Complete CAPTCHA verification to continue signing in.",
            },
        ) from e
    except CaptchaVerificationError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CAPTCHA_INVALID",
                "message": "CAPTCHA verification failed. Please try again.",
            },
        ) from e

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_INACTIVE",
                "message": "This account is inactive. Contact an administrator to restore access.",
            },
        )

    (
        access_token,
        access_expires_at,
        refresh_token,
        refresh_expires_at,
    ) = await auth_service.issue_token_pair(
        user=user,
        remote_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await auth_service.update_last_login(user.id)
    await auth_service.cleanup_expired_token_state()

    now = datetime.now(UTC)
    set_auth_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        access_expires_at=access_expires_at,
        refresh_expires_at=refresh_expires_at,
    )
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in_seconds=max(0, int((access_expires_at - now).total_seconds())),
        refresh_expires_in_seconds=max(
            0,
            int((refresh_expires_at - now).total_seconds()),
        ),
    )  # nosec B106


@router.post("/refresh", response_model=Token)
@rate_limit("20/minute")
async def refresh_access_token(
    request: Request,
    response: Response,
    refresh_request: RefreshTokenRequest | None = None,
    auth_service: AuthService = Depends(get_auth_service),
) -> Token:
    """Rotate refresh token and issue a new access token pair."""
    raw_refresh_token = (
        refresh_request.refresh_token if refresh_request is not None else None
    ) or request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)
    if not raw_refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_REFRESH_TOKEN",
                "message": "Refresh token is invalid, expired, or already revoked.",
            },
        )
    rotated = await auth_service.rotate_refresh_token(
        raw_refresh_token=raw_refresh_token,
        remote_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    if rotated is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_REFRESH_TOKEN",
                "message": "Refresh token is invalid, expired, or already revoked.",
            },
        )

    user, access_token, access_expires_at, refresh_token, refresh_expires_at = rotated
    if not user.is_active:
        await auth_service.revoke_all_refresh_tokens_for_user(user.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "ACCOUNT_INACTIVE",
                "message": "This account is inactive. Contact an administrator to restore access.",
            },
        )

    await auth_service.cleanup_expired_token_state()

    now = datetime.now(UTC)
    set_auth_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        access_expires_at=access_expires_at,
        refresh_expires_at=refresh_expires_at,
    )
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in_seconds=max(0, int((access_expires_at - now).total_seconds())),
        refresh_expires_in_seconds=max(
            0,
            int((refresh_expires_at - now).total_seconds()),
        ),
    )  # nosec B106


@router.post("/logout")
async def logout(
    response: Response,
    token: str = Depends(get_request_access_token),
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> dict[str, str]:
    """Revoke current access token and all active refresh tokens for the user."""
    await auth_service.revoke_access_token(token, reason="logout")
    await auth_service.revoke_all_refresh_tokens_for_user(current_user.id)
    await auth_service.cleanup_expired_token_state()
    clear_auth_cookies(response)
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
@rate_limit("3/minute")
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


@router.post("/join-us/contact", response_model=MessageResponse)
@rate_limit("5/minute")
async def submit_join_us_contact(
    request: Request,
    payload: JoinUsContactRequest,
    auth_service: AuthService = Depends(get_auth_service),
) -> MessageResponse:
    """Submit Join Us contact form and send a numbered recruitment email."""
    try:
        await auth_service.submit_join_us_contact_request(
            subject=payload.subject,
            body=payload.body,
            captcha_token=payload.captcha_token,
            remote_ip=request.client.host if request.client else None,
        )
    except JoinUsCaptchaRequiredError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CONTACT_CAPTCHA_REQUIRED",
                "message": "Complete CAPTCHA verification before submitting the form.",
            },
        ) from e
    except JoinUsCaptchaVerificationError as e:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "CONTACT_CAPTCHA_INVALID",
                "message": "CAPTCHA verification failed. Please try again.",
            },
        ) from e
    except JoinUsBodyTooShortError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "CONTACT_BODY_TOO_SHORT",
                "message": "Message must contain at least 300 characters unless it ends with #nl.",
            },
        ) from e
    except JoinUsRateLimitExceededError as e:
        retry_minutes = max(1, (e.retry_after_seconds + 59) // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "CONTACT_RATE_LIMITED",
                "message": (
                    "Too many submissions from this source. "
                    f"Please wait about {retry_minutes} minute(s) before trying again."
                ),
                "retry_after_seconds": e.retry_after_seconds,
            },
            headers={"Retry-After": str(e.retry_after_seconds)},
        ) from e
    except JoinUsEmailNotConfiguredError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "CONTACT_EMAIL_NOT_CONFIGURED",
                "message": "Contact form email delivery is not configured yet.",
            },
        ) from e
    except JoinUsEmailDeliveryError as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "CONTACT_EMAIL_DELIVERY_FAILED",
                "message": "Failed to send your message. Please try again later.",
            },
        ) from e

    return MessageResponse(message="Your message has been sent successfully.")


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(get_current_admin_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> list[User]:
    """List all users (admin only)."""
    result = await auth_service.db.execute(select(User))
    return list(result.scalars().all())


@router.patch("/me", response_model=UserResponse)
async def update_current_user_profile(
    update: UserProfileUpdate,
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> User:
    """Update current user's profile fields (display_name, etc.)."""
    from datetime import datetime

    if update.display_name is not None:
        current_user.display_name = update.display_name

    current_user.updated_at = datetime.now(UTC)
    await auth_service.db.commit()
    await auth_service.db.refresh(current_user)

    return current_user


@router.post("/change-email/request-code", response_model=EmailChangeCodeResponse)
@rate_limit("10/minute")
async def request_email_change_code(
    request: Request,
    payload: EmailChangeRequest,
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> EmailChangeCodeResponse:
    """Send a 6-digit verification code to a new email address."""
    _ = request
    try:
        expires_at = await auth_service.request_email_change_code(
            current_user=current_user,
            new_email=payload.new_email,
        )
        return EmailChangeCodeResponse(
            message="Verification code sent to your new email.",
            expires_at=expires_at,
        )
    except EmailUnchangedError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_UNCHANGED",
                "message": "New email must be different from your current email.",
            },
        ) from e
    except EmailAlreadyRegisteredError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_ALREADY_REGISTERED",
                "message": "This email is already registered.",
            },
        ) from e
    except EmailChangeLockedError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "EMAIL_CHANGE_LOCKED",
                "message": "Too many failed attempts. Try again in 5 minutes.",
                "locked_until": e.locked_until.astimezone(UTC).isoformat(),
            },
        ) from e
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send verification code: {e!s}",
        ) from e


@router.post("/change-email/verify", response_model=UserResponse)
@rate_limit("15/minute")
async def verify_email_change_code(
    request: Request,
    payload: EmailChangeVerifyRequest,
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> User:
    """Verify submitted email-change code and update current user email."""
    _ = request
    try:
        return await auth_service.verify_email_change_code(
            current_user=current_user,
            code=payload.code,
        )
    except EmailVerificationRequestNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_CHANGE_REQUEST_NOT_FOUND",
                "message": "No pending email change request found.",
            },
        ) from e
    except EmailVerificationCodeExpiredError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_CHANGE_CODE_EXPIRED",
                "message": "Verification code expired. Request a new code.",
            },
        ) from e
    except InvalidEmailVerificationCodeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_CHANGE_INVALID_CODE",
                "message": "This code is incorrect.",
                "attempts_remaining": e.attempts_remaining,
            },
        ) from e
    except EmailChangeLockedError as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "EMAIL_CHANGE_TOO_MANY_ATTEMPTS",
                "message": "Too many failed attempts. Try again in 5 minutes.",
                "locked_until": e.locked_until.astimezone(UTC).isoformat(),
            },
        ) from e
    except EmailAlreadyRegisteredError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "EMAIL_ALREADY_REGISTERED",
                "message": "This email is already registered.",
            },
        ) from e


@router.post("/change-password", response_model=MessageResponse)
@rate_limit("10/minute")
async def change_password(
    request: Request,
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_active_user),
    auth_service: AuthService = Depends(get_auth_service),
) -> MessageResponse:
    """Change password for the current authenticated user."""
    _ = request
    try:
        await auth_service.change_password(
            current_user=current_user,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except InvalidCurrentPasswordError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "CURRENT_PASSWORD_INVALID",
                "message": "Current password is invalid.",
            },
        ) from e

    return MessageResponse(message="Password changed successfully.")
