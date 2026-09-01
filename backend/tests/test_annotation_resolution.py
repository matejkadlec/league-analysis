"""Every annotation in `app/` must still resolve at runtime.

Under PEP 649 a name imported only under `if TYPE_CHECKING:` raises `NameError`
when evaluated, and neither Ruff nor Pyright reports it.
"""

from __future__ import annotations

import importlib
import inspect
import pkgutil
import typing

import pytest

import app


def iter_app_modules() -> list[str]:
    """Every importable module under `app`, including subpackages."""
    return sorted(module.name for module in pkgutil.walk_packages(app.__path__, "app."))


@pytest.mark.parametrize("module_name", iter_app_modules())
def test_module_annotations_resolve_at_runtime(module_name: str) -> None:
    """No callable in this module carries an unresolvable annotation."""
    module = importlib.import_module(module_name)

    unresolvable: list[str] = []
    for name, value in vars(module).items():
        # Only what this module defines: SQLAlchemy re-exports functions whose
        # own annotations are TYPE_CHECKING-only.
        if not (inspect.isfunction(value) or inspect.iscoroutinefunction(value)):
            continue
        if getattr(value, "__module__", None) != module_name:
            continue
        try:
            typing.get_type_hints(value)
        except NameError as error:
            unresolvable.append(f"{name}: {error}")

    assert unresolvable == [], (
        f"{module_name} has annotations that cannot be evaluated at runtime. "
        "Import the name normally instead of under `if TYPE_CHECKING:` — "
        "see .claude/pitfalls.md history and app/core/riot_api/"
        "credential_vocabulary.py for the cycle-breaking pattern."
    )
