"""The one answer to "is this database on this machine and nowhere else?".

The mutating commands gate on this. `mirror_pi_postgres_to_local.py` keeps its
own copy because it is installed alone, with no repository on `sys.path`.
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
