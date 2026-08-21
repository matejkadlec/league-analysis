"""The one answer to "is this database on this machine and nowhere else?".

Two reviewed commands mutate a database only because they have proved the
target is loopback-only: `cleanse_local_riot_data.py` deletes every Riot row,
`reconcile_admin_account.py` rewrites the administrator credential. They asked
that question in two different ways, and the answers had already diverged --
one accepted the three exact strings `localhost`, `127.0.0.1` and `::1`, the
other accepted any address in the loopback range, so `127.0.0.2` passed one
gate and failed the other. `ipaddress` is the answer that is right about the
whole range, about CIDR notation as PostgreSQL reports it, and about spellings
like `::ffff:127.0.0.1`.

`mirror_pi_postgres_to_local.py` keeps its own copy on purpose: the installer
copies that file alone to `~/.local/share`, where it runs under `/usr/bin/
python3` with no repository on `sys.path`, so it cannot import this module.
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
