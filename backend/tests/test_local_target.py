"""The loopback proof both destructive local commands now share.

`cleanse_local_riot_data.py` and `reconcile_admin_account.py` mutate a
database only after proving it is loopback-only. These cases cover the union
of what each accepted, plus the range a string comparison misses.
"""

from __future__ import annotations

import pytest

from scripts.local_target import (
    is_loopback_address,
    is_loopback_listener_configuration,
)


@pytest.mark.parametrize(
    "value",
    [
        "localhost",
        "127.0.0.1",
        "127.0.0.1/32",
        "::1",
        "::1/128",
        "[::1]",
        # Loopback is a whole /8, not three spellings: PostgreSQL can be bound
        # to any of it and still be reachable from this machine alone.
        "127.0.0.2",
    ],
)
def test_every_loopback_form_is_accepted(value: str) -> None:
    assert is_loopback_address(value)


@pytest.mark.parametrize(
    "value", ["0.0.0.0", "0.0.0.0/0", "10.0.0.8", "192.168.1.2", "db.internal", ""]
)
def test_remote_and_wildcard_targets_are_rejected(value: str) -> None:
    assert not is_loopback_address(value)


@pytest.mark.parametrize(
    "value", ["localhost", "127.0.0.1", "127.0.0.1, ::1", "localhost,127.0.0.1,::1"]
)
def test_a_loopback_only_listener_list_passes(value: str) -> None:
    assert is_loopback_listener_configuration(value)


@pytest.mark.parametrize(
    "value", ["", "*", "0.0.0.0", "127.0.0.1, *", "localhost,0.0.0.0", "db.internal"]
)
def test_one_shared_bind_address_invalidates_the_list(value: str) -> None:
    assert not is_loopback_listener_configuration(value)
