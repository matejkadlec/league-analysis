"""Every annotation in `app/` must still resolve at runtime.

Under PEP 649 an annotation is lazy, so a name imported only under
`if TYPE_CHECKING:` costs nothing until something evaluates it — and then
`inspect.signature()`, `typing.get_type_hints()` or any library reflecting over
a signature raises `NameError` at call time, from a module that imported
perfectly. Ruff's UP037 actively creates the condition by stripping the quotes
that used to make such annotations safe, and Pyright agrees the name is valid
because it honours `TYPE_CHECKING`, so neither gate reports it.

It has bitten this repository four times: both service decorators (every
decorated method raised on first call, caught only by four tests),
`jobs/base.py`, `matches/match_utils.py`, and
`riot_api/credential_health.py` — the last of which needed a genuine import
cycle broken to fix, which is why the cheap fix is the wrong instinct.

This walks the whole package rather than a list, so a new occurrence fails here
instead of in production.
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
        # Only what this module defines: a re-exported third-party helper is
        # its author's problem, and SQLAlchemy in particular re-exports
        # functions whose own annotations are TYPE_CHECKING-only.
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
