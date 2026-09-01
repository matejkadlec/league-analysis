"""Every route says what it returns, in the annotation a type checker reads.

A `response_model=` kwarg is not read by pyright, so a handler could return the
wrong shape, or `None` off an `except` arm, with the OpenAPI document still right.
"""

import ast
import pathlib

import pytest

APP = pathlib.Path(__file__).resolve().parents[1] / "app"


def _routes() -> list[tuple[str, str, ast.FunctionDef | ast.AsyncFunctionDef]]:
    found: list[tuple[str, str, ast.FunctionDef | ast.AsyncFunctionDef]] = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)
                    and dec.func.value.id in {"router", "app"}
                    and dec.func.attr
                    in {"get", "post", "put", "patch", "delete", "head", "options"}
                ):
                    found.append((str(path.relative_to(APP)), node.name, node))
    return found


ROUTES = _routes()


def test_the_sweep_actually_found_the_routes() -> None:
    """A sweep that silently matches nothing would pass every assertion below."""
    assert len(ROUTES) > 50


@pytest.mark.parametrize(
    ("where", "node"),
    [(f"{rel}::{name}", node) for rel, name, node in ROUTES],
    ids=[f"{rel}::{name}" for rel, name, _ in ROUTES],
)
def test_every_route_declares_its_return_type(
    where: str, node: ast.FunctionDef | ast.AsyncFunctionDef
) -> None:
    assert node.returns is not None, f"{where} has no return annotation"


@pytest.mark.parametrize(
    ("where", "node"),
    [(f"{rel}::{name}", node) for rel, name, node in ROUTES],
    ids=[f"{rel}::{name}" for rel, name, _ in ROUTES],
)
def test_response_model_is_only_used_where_it_says_something_new(
    where: str, node: ast.FunctionDef | ast.AsyncFunctionDef
) -> None:
    """`response_model=X` alongside `-> X` is a second copy that can drift.

    It stays only where the handler returns an ORM instance and the kwarg is
    what converts it, which is exactly when the two spellings differ.
    """
    for dec in node.decorator_list:
        if not isinstance(dec, ast.Call):
            continue
        for kw in dec.keywords:
            if kw.arg != "response_model":
                continue
            assert node.returns is not None
            assert ast.unparse(kw.value) != ast.unparse(node.returns), (
                f"{where} repeats its return type in response_model="
            )
