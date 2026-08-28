"""Authentication router with login, refresh, logout, and user management endpoints."""

from datetime import UTC, datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm

from app.core.http_errors import http_error, log_and_raise_http
from app.core.http_rate_limit import rate_limit
from app.core.schemas import MessageResponse

from .dependencies import AdminUserDep, CurrentUserDep, get_auth_service
from .errors import (
    AccountLockedError,
    CaptchaRequiredError,
    CaptchaVerificationError,
    EmailAlreadyRegisteredError,
    EmailChangeEmailNotConfiguredError,
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
)
from .schemas import (
    EmailChangeCodeResponse,
    EmailChangeRequest,
    EmailChangeVerifyRequest,
    JoinUsContactRequest,
    PasswordChangeRequest,
    RefreshTokenRequest,
    Token,
    UserCreate,
    UserProfileUpdate,
    UserResponse,
)
from .service import AuthService
from .tokens.cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    clear_auth_cookies,
    max_age_seconds,
    set_auth_cookies,
)
from .users.models import User

router = APIRouter(prefix="/auth", tags=["authentication"])

logger = structlog.get_logger(__name__)


def _issue_token_response(
    response: Response,
    *,
    access_token: str,
    refresh_token: str,
    access_expires_at: datetime,
    refresh_expires_at: datetime,
) -> Token:
    """Set the auth cookies and build the matching Token body.

    Login and refresh must hand out cookies and body from the same expiry
    instants; sharing this tail keeps the two from drifting apart.
    """
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
        expires_in_seconds=max_age_seconds(access_expires_at),
        refresh_expires_in_seconds=max_age_seconds(refresh_expires_at),
    )  # nosec B106


@router.post("/login")
@rate_limit("5/minute")
async def login(
    request: Request,
    response: Response,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    captcha_token: Annotated[str | None, Form()] = None,
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
        logger.warning(
            "login_failed",
            reason="account_locked",
            email=form_data.username,
        )
        raise http_error(
            status.HTTP_423_LOCKED,
            "ACCOUNT_LOCKED",
            "Account is temporarily locked after repeated failed sign-in attempts.",
            locked_until=e.locked_until.astimezone(UTC).isoformat(),
        ) from e
    except CaptchaRequiredError as e:
        logger.warning(
            "login_failed",
            reason="captcha_required",
            email=form_data.username,
        )
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "CAPTCHA_REQUIRED",
            "Complete CAPTCHA verification to continue signing in.",
        ) from e
    except CaptchaVerificationError as e:
        logger.warning(
            "login_failed",
            reason="captcha_verification_failed",
            email=form_data.username,
        )
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "CAPTCHA_INVALID",
            "CAPTCHA verification failed. Please try again.",
        ) from e

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning(
            "login_failed",
            reason="inactive_account",
            user_id=user.id,
            email=user.email,
        )
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "ACCOUNT_INACTIVE",
            "This account is inactive. Contact an administrator to restore access.",
        )

    pair = await auth_service.issue_token_pair(
        user=user,
        remote_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )

    await auth_service.update_last_login(user.id)
    await auth_service.cleanup_expired_token_state()
    logger.info(
        "login_succeeded",
        user_id=user.id,
        email=user.email,
    )

    return _issue_token_response(
        response,
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        access_expires_at=pair.access_expires_at,
        refresh_expires_at=pair.refresh_expires_at,
    )


@router.post("/refresh")
@rate_limit("20/minute")
async def refresh_access_token(
    request: Request,
    response: Response,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
    refresh_request: RefreshTokenRequest | None = None,
) -> Token:
    """Rotate refresh token and issue a new access token pair."""
    raw_refresh_token = (
        refresh_request.refresh_token if refresh_request is not None else None
    ) or request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)
    if not raw_refresh_token:
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_REFRESH_TOKEN",
            "Refresh token is invalid, expired, or already revoked.",
        )
    rotated = await auth_service.rotate_refresh_token(
        raw_refresh_token=raw_refresh_token,
        remote_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    if rotated is None:
        raise http_error(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_REFRESH_TOKEN",
            "Refresh token is invalid, expired, or already revoked.",
        )

    if not rotated.user.is_active:
        await auth_service.revoke_all_refresh_tokens_for_user(rotated.user.id)
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "ACCOUNT_INACTIVE",
            "This account is inactive. Contact an administrator to restore access.",
        )

    await auth_service.cleanup_expired_token_state()

    return _issue_token_response(
        response,
        access_token=rotated.pair.access_token,
        refresh_token=rotated.pair.refresh_token,
        access_expires_at=rotated.pair.access_expires_at,
        refresh_expires_at=rotated.pair.refresh_expires_at,
    )


# Deliberately not rate limited: `get_remote_address` keys on
# `request.client.host` and browser traffic arrives through the Next.js
# rewrite, so one shared bucket would strand live 30-day tokens.
@router.post("/logout")
# No body parameter: declaring one makes FastAPI validate the body, so a
# `navigator.sendBeacon` logout (`text/plain`) becomes a 422 on a route
# whose contract is that it cannot fail.
async def logout(
    request: Request,
    response: Response,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> MessageResponse:
    """Revoke whatever session the request still carries, and always succeed.

    Identity comes from the refresh cookie, never a valid access token, which
    expires 30 minutes into a 30-day session; an unauthenticated call is
    answered, not rejected. A database fault still propagates as a 500.
    """
    # The Authorization header first, matching `get_request_access_token`, so
    # a non-browser client holding only the pair `/login` returned still gets
    # that token blacklisted. It is spent on itself and nothing more.
    authorization = request.headers.get("authorization", "")
    bearer_token = (
        authorization[7:].strip() if authorization[:7].lower() == "bearer " else None
    )
    access_token = bearer_token or request.cookies.get(ACCESS_TOKEN_COOKIE_NAME)
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE_NAME)

    # Only the refresh token names a user: naming one signs them out everywhere
    # and this route is unauthenticated, so honouring an access token here --
    # which lands in logs -- would be a replayable sign-out-everywhere button.
    user_id: int | None = None
    if refresh_token:
        user_id = await auth_service.resolve_user_id_for_refresh_token(refresh_token)

    # Refresh tokens first. Each revocation commits on its own, so a failure
    # between the two leaves the earlier one done: losing the 30-day credential
    # and keeping the 30-minute one is the survivable half of that.
    if user_id is not None:
        await auth_service.revoke_all_refresh_tokens_for_user(user_id)
    if access_token:
        await auth_service.revoke_access_token(access_token, reason="logout")

    if user_id is not None:
        # Only for a caller that proved it holds a credential. This issues
        # table-wide DELETEs and a COMMIT on an unauthenticated endpoint, so
        # running it unconditionally hands anonymous requests a write loop.
        await auth_service.cleanup_expired_token_state()
    if user_id is not None:
        logger.info("logout_succeeded", user_id=user_id)
    else:
        # Not `info`: this route is unauthenticated and unrate-limited, so an
        # anonymous POST loop would otherwise be a free way to fill the logs.
        logger.debug("logout_succeeded_without_a_session")
    # Only for a request that actually carried something. A deletion Set-Cookie
    # applies in first-party contexts where SameSite=Lax withheld the cookies,
    # so it would revoke nothing while stranding the live refresh row.
    if any((access_token, refresh_token, request.cookies.get(AUTH_STATE_COOKIE_NAME))):
        clear_auth_cookies(response)
    return MessageResponse(message="Successfully logged out")


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: CurrentUserDep,
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
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    """Register a new user account.

    Passwords need 8+ characters with lower, upper, digit and special.
    """
    try:
        return await auth_service.create_user(user_create)
    except EmailAlreadyRegisteredError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
        ) from e


@router.post("/join-us/contact")
@rate_limit("5/minute")
async def submit_join_us_contact(
    request: Request,
    payload: JoinUsContactRequest,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
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
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "CONTACT_CAPTCHA_REQUIRED",
            "Complete CAPTCHA verification before submitting the form.",
        ) from e
    except JoinUsCaptchaVerificationError as e:
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "CONTACT_CAPTCHA_INVALID",
            "CAPTCHA verification failed. Please try again.",
        ) from e
    except JoinUsBodyTooShortError as e:
        raise http_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "CONTACT_BODY_TOO_SHORT",
            "Message must contain at least 300 characters.",
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
        raise http_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "CONTACT_EMAIL_NOT_CONFIGURED",
            "Contact form email delivery is not configured yet.",
        ) from e
    except JoinUsEmailDeliveryError as e:
        raise http_error(
            status.HTTP_502_BAD_GATEWAY,
            "CONTACT_EMAIL_DELIVERY_FAILED",
            "Your message could not be sent. Please try again later.",
        ) from e

    return MessageResponse(message="Your message has been sent successfully.")


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: AdminUserDep,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> list[User]:
    """List all users (admin only)."""
    return await auth_service.list_users()


@router.patch("/me", response_model=UserResponse)
async def update_current_user_profile(
    update: UserProfileUpdate,
    current_user: CurrentUserDep,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    """Update current user's profile fields (display_name, etc.)."""
    return await auth_service.update_profile(current_user, update)


@router.post("/change-email/request-code")
@rate_limit("10/minute")
async def request_email_change_code(
    request: Request,
    payload: EmailChangeRequest,
    current_user: CurrentUserDep,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
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
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_UNCHANGED",
            "New email must be different from your current email.",
        ) from e
    except EmailAlreadyRegisteredError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
        ) from e
    except EmailChangeLockedError as e:
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "EMAIL_CHANGE_LOCKED",
            "Too many failed attempts. Try again in 5 minutes.",
            locked_until=e.locked_until.astimezone(UTC).isoformat(),
        ) from e
    except EmailChangeEmailNotConfiguredError as e:
        # Before the blanket handler below, which would answer an uncoded 500.
        raise http_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "EMAIL_CHANGE_EMAIL_NOT_CONFIGURED",
            "Email delivery is not configured.",
        ) from e
    except Exception as e:
        log_and_raise_http(
            logger,
            e,
            "email_change_code_request_failed",
            detail="The verification code could not be sent. Please try again later.",
            new_email=payload.new_email,
        )


@router.post("/change-email/verify", response_model=UserResponse)
@rate_limit("15/minute")
async def verify_email_change_code(
    request: Request,
    payload: EmailChangeVerifyRequest,
    current_user: CurrentUserDep,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> User:
    """Verify submitted email-change code and update current user email."""
    _ = request
    try:
        return await auth_service.verify_email_change_code(
            current_user=current_user,
            code=payload.code,
        )
    except EmailVerificationRequestNotFoundError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_CHANGE_REQUEST_NOT_FOUND",
            "No pending email change request found.",
        ) from e
    except EmailVerificationCodeExpiredError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_CHANGE_CODE_EXPIRED",
            "Verification code expired. Request a new code.",
        ) from e
    except InvalidEmailVerificationCodeError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_CHANGE_INVALID_CODE",
            "This code is incorrect.",
            attempts_remaining=e.attempts_remaining,
        ) from e
    except EmailChangeLockedError as e:
        raise http_error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "EMAIL_CHANGE_TOO_MANY_ATTEMPTS",
            "Too many failed attempts. Try again in 5 minutes.",
            locked_until=e.locked_until.astimezone(UTC).isoformat(),
        ) from e
    except EmailAlreadyRegisteredError as e:
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "EMAIL_ALREADY_REGISTERED",
            "This email is already registered.",
        ) from e


@router.post("/change-password")
@rate_limit("10/minute")
async def change_password(
    request: Request,
    payload: PasswordChangeRequest,
    current_user: CurrentUserDep,
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
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
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "CURRENT_PASSWORD_INVALID",
            "Current password is invalid.",
        ) from e

    return MessageResponse(message="Password changed successfully.")
