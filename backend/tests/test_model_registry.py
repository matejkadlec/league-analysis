"""Prove `import_all_models()` names every module that maps a table.

`alembic/env.py` builds `Base.metadata` from `import_all_models()`, so a module
missing from that list is invisible to Alembic and to the database.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

_REGISTRY_TABLES = """
from app.model_registry import import_all_models
from app.core.models import Base

import_all_models()
print("\\n".join(sorted(Base.metadata.tables)))
"""

# `pkgutil.walk_packages` swallows import errors unless `onerror` is passed, so a
# model module that raises would be skipped in silence.
_WALKED_TABLES = """
import importlib
import pkgutil

import app
from app.core.models import Base


def fail(name: str) -> None:
    raise


for module in pkgutil.walk_packages(app.__path__, "app.", onerror=fail):
    importlib.import_module(module.name)
print("\\n".join(sorted(Base.metadata.tables)))
"""


def _tables(source: str) -> set[str]:
    """Return the mapped table names a fresh interpreter ends up with."""
    result = subprocess.run(
        [sys.executable, "-c", source],
        cwd=BACKEND_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, f"subprocess failed:\n{result.stderr}"
    return {line for line in result.stdout.splitlines() if line}


def test_registry_lists_every_mapped_model() -> None:
    """Fail when a model module exists that the registry does not import."""
    registered = _tables(_REGISTRY_TABLES)
    walked = _tables(_WALKED_TABLES)

    missing = walked - registered
    assert not missing, (
        "these tables are mapped somewhere under app/ but "
        "app/model_registry.py does not import the module defining them, "
        "so Alembic cannot see them: " + ", ".join(sorted(missing))
    )
    # The comparison above is only as good as the walk: a walk that finds nothing
    # makes the assertion pass while checking nothing.
    unreachable = registered - walked
    assert not unreachable, (
        "the package walk did not find tables the registry did, so the walk is "
        "broken and this test is not guarding anything: "
        + ", ".join(sorted(unreachable))
    )


def test_registry_finds_the_models_it_claims_to() -> None:
    """Guard the guard: an empty walk would make the test above vacuous."""
    assert len(_tables(_WALKED_TABLES)) > 10
