"""The one answer to "is this database on this machine and nowhere else?".

Two mutating commands -- `cleanse_local_riot_data.py` and
`reconcile_admin_account.py` -- gate on this.
"""

from __future__ import annotations

import ipaddress


def is_loopback_address(value: str) -> bool:
    """Return whether one configured or observed host is loopback-only."""
    normalized = value.strip().strip("[]").lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_interface(normalized).ip.is_loopback
    except ValueError:
        return False


def is_loopback_listener_configuration(value: str) -> bool:
    """Return whether every configured PostgreSQL bind address is loopback-only."""
    addresses = [item.strip().strip("'\"") for item in value.split(",") if item.strip()]
    return bool(addresses) and all(is_loopback_address(item) for item in addresses)
