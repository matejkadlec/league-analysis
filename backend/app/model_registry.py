"""The one place that names every module holding a mapped model.

`Base.metadata` only knows a table once its module is imported, and Alembic reads
that metadata to decide what a migration must do.
"""

# Importing *is* the side effect that registers a model on `Base.metadata`.
# pyright: reportUnusedImport=false

from __future__ import annotations


def import_all_models() -> None:
    """Import every module that defines a mapped model."""
    from app.core.riot_api import credential_health  # noqa: F401
    from app.features.auth.email_change import (  # noqa: F401
        email_change_request,
    )
    from app.features.auth.join_us import (  # noqa: F401
        join_us_contact_submission,
        subject_counts,
    )
    from app.features.auth.tokens import (  # noqa: F401
        refresh_token,
        revoked_access_token,
    )
    from app.features.auth.users import (  # noqa: F401
        models as auth_models,
    )
    from app.features.auth.users import (  # noqa: F401
        user_card_preference,
        user_cookie_consent,
        user_settings,
        user_tracked_player,
    )
    from app.features.jobs import models as job_models  # noqa: F401
    from app.features.matches import (  # noqa: F401
        models as match_models,
    )
    from app.features.matches import (  # noqa: F401
        participants,
        timeline,
    )
    from app.features.matchmaking_analysis import (  # noqa: F401
        models as matchmaking_models,
    )
    from app.features.players import leagues  # noqa: F401
    from app.features.players import models as player_models  # noqa: F401
    from app.features.playstyle_analysis import (  # noqa: F401
        models as playstyle_models,
    )
    from app.features.settings import models as settings_models  # noqa: F401
    from app.features.smurf_boost_detection import (  # noqa: F401
        models as smurf_boost_models,
    )
