"""Credential-health vocabulary, kept free of dependencies on purpose.

`client.py` and `credential_health.py` each need the other, and breaking that
cycle with a `TYPE_CHECKING` import turns runtime reflection over
`create_tracked_riot_api_client` into a PEP 649 `NameError`.
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
