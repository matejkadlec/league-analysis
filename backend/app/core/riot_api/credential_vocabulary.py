"""Credential-health vocabulary, kept free of dependencies on purpose.

`client.py` needs `RiotCredentialStatus` to report what a provider response
proved, and `credential_health.py` needs `RiotAPIClient` to build a client bound
to the current credential generation. Holding both enums in `credential_health`
made that a cycle, which was survivable only by importing `RiotAPIClient` under
`TYPE_CHECKING` — and under PEP 649 that turns any runtime reflection over
`create_tracked_riot_api_client` into `NameError`, the trap recorded in
`.claude/pitfalls.md`.

These enums name states; they depend on nothing. Giving them their own module
breaks the cycle at its narrowest point and lets both sides import honestly.
"""

from __future__ import annotations

from enum import StrEnum


class RiotCredentialStatus(StrEnum):
    """Authoritative credential-health states exposed by the backend."""

    MISSING = "missing"
    UNKNOWN = "unknown"
    VALID = "valid"
    INVALID = "invalid"


class RiotCredentialEvidence(StrEnum):
    """Safe evidence categories persisted without provider payloads."""

    MISSING = "missing"
    CONFIGURED = "configured"
    SETTINGS_VALIDATION = "settings_validation"
    PROVIDER_SUCCESS = "provider_success"
    CREDENTIAL_REJECTED = "credential_rejected"
