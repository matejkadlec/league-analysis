"""The display-name rule, which used to live only in the settings form."""

import pytest
from pydantic import ValidationError

from app.features.auth.schemas import UserProfileUpdate, UserResponse


@pytest.mark.parametrize(
    "value",
    [
        "Matej",
        "Ana María",  # letters outside ASCII
        "Ångström",
        "a b",  # an inner space
        "Two_Words",
    ],
)
def test_names_the_settings_form_accepts(value: str) -> None:
    assert UserProfileUpdate(display_name=value).display_name == value


@pytest.mark.parametrize(
    "value",
    [
        "ab",  # shorter than three
        "   ",  # whitespace is not a name
        "_ab",  # must start on a letter
        "ab_",  # and end on one
        "user123",  # digits are not letters
        "Jean-Luc",  # nor are hyphens
        "<script>alert(1)</script>",
        "a" * 129,
    ],
)
def test_names_the_api_used_to_accept_from_anything_but_the_form(
    value: str,
) -> None:
    # `PATCH /auth/me` took all of these while the browser refused them.
    with pytest.raises(ValidationError):
        UserProfileUpdate(display_name=value)


def test_surrounding_whitespace_is_stripped_not_rejected() -> None:
    # The form trims before sending; a client that does not gets the same
    # stored value rather than a name with edges.
    assert UserProfileUpdate(display_name="  Matej  ").display_name == "Matej"


def test_omitting_the_field_still_means_no_change() -> None:
    assert UserProfileUpdate().display_name is None


def test_responses_do_not_re_impose_the_rule_on_stored_rows() -> None:
    # FastAPI validates response models on the way out, so inheriting the
    # constraint would turn a stored row into a 500 on `GET /auth/me`.
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    response = UserResponse(
        email="user@example.com",
        display_name="ab",
        id=1,
        is_active=True,
        is_admin=False,
        email_verified=True,
        created_at=now,
        updated_at=now,
    )

    assert response.display_name == "ab"
