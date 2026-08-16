"""Prove `import_all_models()` names every module that maps a table.

`alembic/env.py` builds `Base.metadata` by calling `import_all_models()`. A
model module missing from that list is absent from the metadata *and*, because
nobody wrote a migration for it either, absent from the database — the two
agree, `alembic check` reports nothing, and the table simply does not exist
until a query fails in production.

Walking the package is the obvious guard and the wrong one to put in `env.py`:
discovery means importing, so every router and service would execute during a
migration. Here in a test that cost is fine, so the walk lives on this side and
the migration path keeps the explicit list.

Both halves run in subprocesses. In-process they would contaminate each other,
since the pytest session has already imported much of `app` and
`Base.metadata` is global.

What this compares is reachable *tables*, not lines in the registry. Deleting
an entry that some other imported module pulls in transitively will not fail
this test, and should not: the table still reaches the metadata, so Alembic
still sees it. What does fail is a mapped table nothing imports at all — the
new feature whose models module was never wired up, which is the case that
reaches production broken.
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

# `onerror` is passed explicitly because `pkgutil.walk_packages` defaults to
# swallowing import errors. A model module that raises on import would then be
# skipped in silence, which is the exact failure this test exists to catch.
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
    # The comparison above is only as good as the walk. If the walk ever stops
    # finding models -- a renamed package, a changed `app.__path__` -- it yields
    # nothing, `walked - registered` is trivially empty, and the assertion above
    # passes while checking nothing. A table the registry reached that the walk
    # did not is impossible unless the walk is broken.
    unreachable = registered - walked
    assert not unreachable, (
        "the package walk did not find tables the registry did, so the walk is "
        "broken and this test is not guarding anything: "
        + ", ".join(sorted(unreachable))
    )


def test_registry_finds_the_models_it_claims_to() -> None:
    """Guard the guard: an empty walk would make the test above vacuous."""
    assert len(_tables(_WALKED_TABLES)) > 10
