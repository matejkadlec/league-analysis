"""Authentication feature module."""

# Deliberately no re-exports: forwarding names here made
# `import app.features.auth.models` run the router and the service first, which
# is half of what `app/model_registry.py` exists to prevent. Import from the
# submodule (e.g. `from app.features.auth.models import User`).
