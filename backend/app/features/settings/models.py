"""Models for system settings.

Viewer-owned card preferences moved to `auth.user_card_preference`, beside
the other user-owned tables; only the system-side credential model remains.
"""

from app.core.riot_api.credential_health import RiotAPIKey as RiotAPIKey
