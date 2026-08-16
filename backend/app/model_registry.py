"""The one place that names every module holding a mapped model.

`Base.metadata` only knows about a table once the module defining it has been
imported. Alembic reads that metadata to decide what a migration must do, so a
model module nobody imports is invisible to it — and invisible in a way that
looks like success: the table is absent from the metadata *and* absent from the
database, the two agree, and `alembic check` reports nothing to do. The failure
surfaces in production as `UndefinedTable` on the first query.

The list is written out rather than discovered by walking the package, which is
what Apache Airflow does for the same reason: walking has to import every
module to find the models, so routers, services and settings validation would
all execute during a migration, and `pkgutil.walk_packages` swallows import
errors by default — a model module that fails to import would be skipped in
silence, which is the bug this guards against wearing a disguise.

A hand-written list has one failure mode, forgetting to add to it. That is what
`tests/test_model_registry.py` exists to catch: it walks the package in a
subprocess and fails if the walk finds a mapped table this list missed.

It sits beside `main.py` rather than under `app/core/` because it names every
feature, and `app/core` is forbidden from importing `app/features` — the same
layering reason `main.py` lives here.
"""

# Every import here is unused by definition — importing *is* the side effect
# that registers the model on `Base.metadata`.
# pyright: reportUnusedImport=false

from __future__ import annotations


def import_all_models() -> None:
    """Import every module that defines a mapped model."""
    from app.core.riot_api import credential_health, db_rate_limiter  # noqa: F401
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
