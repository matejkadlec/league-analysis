"""Authentication feature module."""

from .dependencies import get_current_active_user, get_current_user
from .email_change_request import EmailChangeRequest
from .join_us_contact_submission import JoinUsContactSubmission
from .models import User
from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken
from .router import router as auth_router
from .schemas import (
    EmailChangeCodeResponse,
    EmailChangeVerifyRequest,
    JoinUsContactRequest,
    JoinUsSubject,
    MessageResponse,
    PasswordChangeRequest,
    RefreshTokenRequest,
    Token,
    TokenData,
    UserCreate,
    UserResponse,
)
from .schemas import (
    EmailChangeRequest as EmailChangeRequestSchema,
)
from .service import AuthService
from .subject_counts import SubjectCounts
from .user_cookie_consent import CookieConsentLevel, UserCookieConsent
from .user_settings import UserSettings
from .user_tracked_player import UserTrackedPlayer

__all__ = [
    "User",
    "EmailChangeRequest",
    "JoinUsContactSubmission",
    "RefreshToken",
    "RevokedAccessToken",
    "SubjectCounts",
    "UserCookieConsent",
    "UserSettings",
    "UserTrackedPlayer",
    "CookieConsentLevel",
    "UserResponse",
    "UserCreate",
    "Token",
    "TokenData",
    "RefreshTokenRequest",
    "EmailChangeRequestSchema",
    "EmailChangeVerifyRequest",
    "EmailChangeCodeResponse",
    "PasswordChangeRequest",
    "MessageResponse",
    "JoinUsSubject",
    "JoinUsContactRequest",
    "auth_router",
    "AuthService",
    "get_current_user",
    "get_current_active_user",
]
