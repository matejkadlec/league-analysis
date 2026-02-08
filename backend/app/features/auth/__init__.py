"""Authentication feature module."""

from .models import User
from .user_settings import UserSettings, ThemeEnum
from .user_tracked_player import UserTrackedPlayer
from .schemas import UserResponse, UserCreate, Token, TokenData
from .router import router as auth_router
from .service import AuthService
from .dependencies import get_current_user, get_current_active_user

__all__ = [
    "User",
    "UserSettings",
    "UserTrackedPlayer",
    "ThemeEnum",
    "UserResponse",
    "UserCreate",
    "Token",
    "TokenData",
    "auth_router",
    "AuthService",
    "get_current_user",
    "get_current_active_user",
]
