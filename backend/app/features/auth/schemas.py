"""Pydantic schemas for authentication."""

import re
from datetime import datetime
from enum import Enum
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

SPECIAL_CHARACTER_PATTERN = r"[!@#$%^&*(),.?\":{}|<>\-_+=\[\]\\/;'`~]"

EMAIL_CHANGE_CODE_LENGTH = 6
"""Digits in an email-change verification code.

Lives here rather than beside the generator in `service.py` because the
request pattern below is built from it and `service.py` imports this module,
not the other way round. Three copies of `6` used to exist -- this pattern,
the generator's zero-padding, and the range it drew from -- and the range was
the one that did not move with the constant.
"""

DISPLAY_NAME_MIN_LENGTH = 3
DISPLAY_NAME_MAX_LENGTH = 128
DISPLAY_NAME_PATTERN = r"^[\p{L}](?:[\p{L}\p{M}_ ]*[\p{L}])?$"

DisplayName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=DISPLAY_NAME_MIN_LENGTH,
        max_length=DISPLAY_NAME_MAX_LENGTH,
        pattern=DISPLAY_NAME_PATTERN,
    ),
]
"""Letters, marks, underscores and spaces, starting and ending on a letter.

The settings form has always enforced exactly this, and the API enforced none
of it, so `PATCH /auth/me` accepted any 1-128 character string from anything
that was not the form. Pydantic renders all three constraints into the OpenAPI
document, which is what `display-name-alignment.test.ts` reads back to hold the
two copies of the rule equal. `strip_whitespace` is the one part that does not
appear there -- it is a transform, not a constraint -- so a client that does
not trim gets the same stored value as the form, which does.
"""


def validate_password_strength(value: str) -> str:
    """Validate password strength requirements."""
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long")

    if not re.search(r"[a-z]", value):
        raise ValueError("Password must contain at least one lowercase letter")

    if not re.search(r"[A-Z]", value):
        raise ValueError("Password must contain at least one uppercase letter")

    if not re.search(r"\d", value):
        raise ValueError("Password must contain at least one digit")

    if not re.search(SPECIAL_CHARACTER_PATTERN, value):
        raise ValueError(
            "Password must contain at least one special character "
            r"(!@#$%^&*(),.?\":{}|<>-_+=[]\/;'`~)"
        )

    return value


class UserBase(BaseModel):
    """Base user schema with common fields."""

    email: EmailStr
    display_name: DisplayName


class UserCreate(UserBase):
    """Schema for creating a new user."""

    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        """Validate password meets security requirements.

        At least 8 characters with a lowercase letter, an uppercase letter, a
        digit, and one of an expanded set of special characters.
        """
        return validate_password_strength(v)


class UserResponse(UserBase):
    """Schema for user responses (excludes sensitive data)."""

    # Deliberately looser than `UserBase`: response models validate on the way
    # out, so inheriting `DisplayName` would 500 `GET /auth/me` on a stored row.
    display_name: str = Field(max_length=128)

    id: int
    is_active: bool
    is_admin: bool
    email_verified: bool
    email_verified_at: datetime | None = None
    last_login: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class Token(BaseModel):
    """Schema for JWT token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in_seconds: int
    refresh_expires_in_seconds: int


class TokenData(BaseModel):
    """Schema for token payload data."""

    email: str | None = None
    user_id: int | None = None
    token_id: str | None = None
    token_type: str | None = None
    exp: int | None = None


class RefreshTokenRequest(BaseModel):
    """Schema for refreshing an access token using refresh token rotation."""

    refresh_token: str | None = Field(default=None, min_length=20)


class UserProfileUpdate(BaseModel):
    """Schema for updating user profile fields."""

    display_name: DisplayName | None = Field(default=None)


class EmailChangeRequest(BaseModel):
    """Schema for requesting an email-change verification code."""

    new_email: EmailStr


class EmailChangeVerifyRequest(BaseModel):
    """Schema for verifying an email-change code."""

    code: str = Field(..., pattern=rf"^\d{{{EMAIL_CHANGE_CODE_LENGTH}}}$")


class EmailChangeCodeResponse(BaseModel):
    """Schema for email-code request responses."""

    message: str
    expires_at: datetime


class PasswordChangeRequest(BaseModel):
    """Schema for changing password for the current authenticated user."""

    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)
    repeat_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        """Validate new password against security policy."""
        return validate_password_strength(value)

    @model_validator(mode="after")
    def validate_password_match(self) -> PasswordChangeRequest:
        """Ensure repeated password exactly matches."""
        if self.new_password != self.repeat_password:
            raise ValueError("Passwords do not match")
        return self


class JoinUsSubject(str, Enum):
    """Supported Join Us contact subjects."""

    BETA_TESTER = "beta_tester"
    FULL_STACK_DEVELOPER = "full_stack_developer"
    OTHER = "other"


class JoinUsContactRequest(BaseModel):
    """Schema for public Join Us contact form submissions."""

    subject: JoinUsSubject
    body: str = Field(..., min_length=1, max_length=5000)
    captcha_token: str | None = Field(default=None, min_length=1, max_length=4096)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        """Trim body and enforce non-empty payload."""
        normalized = value.strip()
        if len(normalized) == 0:
            raise ValueError("Message cannot be empty")
        return normalized
