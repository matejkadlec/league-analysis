"""Authentication feature module."""

from .models import User
from .email_change_request import EmailChangeRequest
from .join_us_contact_submission import JoinUsContactSubmission
from .refresh_token import RefreshToken
from .revoked_access_token import RevokedAccessToken
from .subject_counts import SubjectCounts
from .user_settings import UserSettings, ThemeEnum
from .user_tracked_player import UserTrackedPlayer
from .schemas import (
    UserResponse,
    UserCreate,
    Token,
    TokenData,
    RefreshTokenRequest,
    EmailChangeRequest as EmailChangeRequestSchema,
    EmailChangeVerifyRequest,
    EmailChangeCodeResponse,
    PasswordChangeRequest,
    MessageResponse,
    JoinUsSubject,
    JoinUsContactRequest,
)
from .router import router as auth_router
from .service import AuthService
from .dependencies import get_current_user, get_current_active_user

__all__ = [
    "User",
    "EmailChangeRequest",
    "JoinUsContactSubmission",
    "RefreshToken",
    "RevokedAccessToken",
    "SubjectCounts",
    "UserSettings",
    "UserTrackedPlayer",
    "ThemeEnum",
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
