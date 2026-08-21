"""Authentication feature module."""

# Deliberately no re-exports. This package used to forward 26 names, of which
# `main.py` imported one; the cost was that `import app.features.auth.models`
# ran the router and the service first, which is half of what
# `app/model_registry.py` says it exists to prevent. Import from the submodule
# (e.g. `from app.features.auth.models import User`).
