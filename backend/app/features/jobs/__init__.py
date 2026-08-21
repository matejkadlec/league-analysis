"""Jobs feature - Background job management and execution."""

# Deliberately no re-exports; see the note in `app/features/auth/__init__.py`.
# Importing a job model no longer pulls in the router, the service and the
# scheduler. Import from the submodule (e.g. `from .scheduler import ...`).
