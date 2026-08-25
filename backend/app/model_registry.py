"""The one place that names every module holding a mapped model.

`Base.metadata` only knows about a table once the module defining it has been
imported, and Alembic reads that metadata to decide what a migration must do.
The list is hand-written; `tests/test_model_registry.py` catches a missed entry.
"""

# Every import here is unused by definition — importing *is* the side effect
# that registers the model on `Base.metadata`.
# pyright: reportUnusedImport=false

from __future__ import annotations


def import_all_models() -> None:
    """Import every module that defines a mapped model."""
    from app.core.riot_api import credential_health  # noqa: F401
    from app.features.auth import (  # noqa: F401
        email_change_request,
        join_us_contact_submission,
        refresh_token,
        revoked_access_token,
        subject_counts,
        user_cookie_consent,
        user_settings,
        user_tracked_player,
    )
    from app.features.auth import (  # noqa: F401
        models as auth_models,
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
