"""Authentication router with login, refresh, logout, and user management endpoints."""

from datetime import UTC, datetime

import structlog
from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.core.http_errors import http_error
from app.core.rate_limiter import rate_limit

from .cookies import (
    ACCESS_TOKEN_COOKIE_NAME,
    AUTH_STATE_COOKIE_NAME,
    REFRESH_TOKEN_COOKIE_NAME,
    clear_auth_cookies,
    set_auth_cookies,
)
from .dependencies import (
    get_current_active_user,
    get_current_admin_user,
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
    logger.info(
        "login_succeeded",
        user_id=user.id,
        email=user.email,
    )

    return _issue_token_response(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        access_expires_at=access_expires_at,
        refresh_expires_at=refresh_expires_at,
    )


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

    user, access_token, access_expires_at, refresh_token, refresh_expires_at = rotated
    if not user.is_active:
        await auth_service.revoke_all_refresh_tokens_for_user(user.id)
        raise http_error(
            status.HTTP_403_FORBIDDEN,
            "ACCOUNT_INACTIVE",
            "This account is inactive. Contact an administrator to restore access.",
        )

    await auth_service.cleanup_expired_token_state()

    return _issue_token_response(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        access_expires_at=access_expires_at,
        refresh_expires_at=refresh_expires_at,
    )


@router.post("/logout")
# Deliberately not rate limited. `get_remote_address` keys on
# `request.client.host`, uvicorn runs with --no-proxy-headers, and browser
# traffic arrives through the Next.js rewrite, so every user shares one
# bucket. A limit here is therefore globally exhaustible, and its failure mode
# is the wrong way round: refusing a logout leaves a usable 30-day refresh
# token in the browser of someone who has been told they are signed out, while
# the cost of an extra logout is one hash lookup.
# No body parameter, deliberately. Declaring one makes FastAPI read and
# validate the body, which turns a malformed or non-JSON body -- a
# `navigator.sendBeacon` logout sends `text/plain` -- into a 422 on a route
# whose entire contract is that it cannot fail, and a 422 here means nothing
# was revoked. `/refresh` accepts a body token and can afford to; this cannot,
# and no client in this repo sends one. If a non-cookie client ever appears,
# read the body by hand and ignore whatever does not parse.
async def logout(
    request: Request,
    response: Response,
    auth_service: AuthService = Depends(get_auth_service),
) -> dict[str, str]:
    """Revoke whatever session the request still carries, and always succeed.

    This deliberately does not depend on a valid access token. It used to, and
    that made it fail exactly when it mattered: the access token expires after
    30 minutes while the refresh token lives 30 days, so logging out after any
    idle period returned 401 and revoked nothing, leaving a usable 30-day
    credential in the browser of someone who had just been told they were
    signed out. The client cannot make up the difference — only the server can
    revoke, and clearing cookies merely hides the credential.

    Identity therefore comes from the refresh cookie, and an unauthenticated
    call is answered rather than rejected: logout is idempotent, and a caller
    can only ever revoke the session their own request already carries.

    "Always succeed" means never refusing a caller for lacking credentials. A
    database fault still propagates as a 500 with the cookies left in place,
    deliberately: answering 200 there would report a revocation that did not
    happen, which is the failure this route exists to stop.
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

    # Only the refresh token names a user, because naming one signs them out
    # everywhere and this route is unauthenticated. A refresh token is checked
    # against the table and is single-purpose; an access token rides on every
    # request and lands in logs and crash dumps, so honouring one here is a
    # replayable "sign this user out of everything" button for whoever finds
    # it. There is no bound that fixes that: short enough to be safe is too
    # short to serve the idle client such a fallback would exist for, and an
    # expired token is never blacklisted, so a replay collides with nothing.
    user_id: int | None = None
    if refresh_token:
        user_id = await auth_service.resolve_user_id_for_refresh_token(refresh_token)

    # Refresh tokens first. Each revocation commits on its own, so a failure
    # between the two leaves whatever the earlier call already did. Losing the
    # 30-day credential and keeping the 30-minute one is survivable — it dies
    # by itself. The other order leaves the live refresh cookie in a browser
    # that has already been told it is signed out, which is the exact state
    # this whole change exists to remove.
    if user_id is not None:
        await auth_service.revoke_all_refresh_tokens_for_user(user_id)
    if access_token:
        await auth_service.revoke_access_token(access_token, reason="logout")

    if user_id is not None:
        # Only for a caller that proved it holds a credential. This issues
        # table-wide DELETEs and a COMMIT, and the endpoint is unauthenticated,
        # so running it unconditionally would let anonymous requests drive
        # write transactions at request rate.
        await auth_service.cleanup_expired_token_state()
    if user_id is not None:
        logger.info("logout_succeeded", user_id=user_id)
    else:
        # Not `info`: this route is unauthenticated and unrate-limited, so an
        # anonymous POST loop would otherwise be a free way to fill the logs.
        logger.debug("logout_succeeded_without_a_session")
    # Only for a request that actually carried something. This route is
    # unauthenticated by design, and a deletion Set-Cookie is applied by the
    # browser whenever the response arrives in a first-party context -- which a
    # top-level form POST from any page on the internet is. SameSite=Lax keeps
    # the cookies off that request, so it revokes nothing; answering it with
    # three deletions anyway would sign the visitor out with their refresh row
    # live and unrevoked for the rest of its 30 days, which is exactly the
    # stranded session this branch exists to remove -- reached, in that case,
    # from someone else's website. A caller holding no cookie has nothing to
    # clear, so nothing is lost by asking.
    if any((access_token, refresh_token, request.cookies.get(AUTH_STATE_COOKIE_NAME))):
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="The verification code could not be sent. Please try again later.",
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
        raise http_error(
            status.HTTP_400_BAD_REQUEST,
            "CURRENT_PASSWORD_INVALID",
            "Current password is invalid.",
        ) from e

    return MessageResponse(message="Password changed successfully.")
