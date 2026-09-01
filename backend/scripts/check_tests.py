"""Test meaningfulness for pytest, mirroring the frontend's `meaningful-tests`.

Every rule states its whole reasoning in its own report message. Run from
`backend/`: `python scripts/check_tests.py [path]`.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

DEFAULT_PATHS = ("tests",)

# A call whose name says it asserts: counting bare `ast.Assert` nodes would
# instead report callers of shared helpers like `_assert_the_session_was_installed`.
ASSERT_HELPER_MARKER = "assert"

# Mock introspection: present, these prove the wiring was called. Absent an
# assertion on the observable result, that is all they prove.
CALL_ASSERTIONS = frozenset(
    (
        "assert_called",
        "assert_called_once",
        "assert_called_with",
        "assert_called_once_with",
        "assert_any_call",
        "assert_has_calls",
        "assert_awaited",
        "assert_awaited_once",
        "assert_awaited_with",
        "assert_awaited_once_with",
        "assert_any_await",
        "assert_has_awaits",
    )
)

# The negative forms are outcome assertions, not wiring checks: when the claim
# is that nothing happened, the missing call is the observable outcome.
ABSENCE_ASSERTIONS = frozenset(("assert_not_called", "assert_not_awaited"))

# `assert mock.called` is a call assertion wearing a statement's clothes, so it
# must not rescue a test from the rule below.
CALL_ATTRIBUTES = frozenset(
    ("called", "call_count", "call_args", "call_args_list", "await_count", "awaited")
)

NO_ASSERTIONS_MESSAGE = (
    "meaningful-tests: `{name}` asserts nothing. It passes whenever the code "
    "under it does not raise, so a function that returns early, does half its "
    "work, or is deleted outright still leaves it green. Assert what the call "
    "produced -- the value, the row written, the log emitted -- or, if the "
    "point really is that it does not raise, say so with a `pytest.raises` on "
    "the failing case beside it."
)
CALL_ASSERTIONS_ONLY_MESSAGE = (
    "meaningful-tests: every assertion in `{name}` inspects a mock. Those pin "
    "the wiring and pass while the value returned, the row written or the "
    "status recorded is wrong -- a function that calls its collaborator "
    "correctly and then computes the wrong answer satisfies all of them. "
    "Assert the observable outcome as well; call assertions corroborate one, "
    "they cannot stand in for it."
)
CANNOT_FAIL_MESSAGE = (
    "meaningful-tests: `{source}` cannot fail. Both sides are the same "
    "expression, so no change to the code or the data can make them differ. "
    "Compare the value against what it is supposed to be, not against itself."
)
CONSTANT_ASSERT_MESSAGE = (
    "meaningful-tests: `assert {source}` is always true. A truthy constant "
    "asserts nothing about the run; this is a placeholder that survived. "
    "State the property the test is named for."
)


def _is_test_function(node: ast.AST) -> bool:
    """Whether this node is a test pytest will collect."""
    return isinstance(
        node, ast.FunctionDef | ast.AsyncFunctionDef
    ) and node.name.startswith("test")


def _attribute_name(node: ast.expr) -> str:
    """The trailing attribute of a call target, or `""`."""
    func = node.func if isinstance(node, ast.Call) else node
    return func.attr if isinstance(func, ast.Attribute) else ""


def _mentions_call_attribute(node: ast.AST) -> bool:
    """Whether an assertion reads a mock's own call bookkeeping."""
    return any(
        isinstance(child, ast.Attribute) and child.attr in CALL_ATTRIBUTES
        for child in ast.walk(node)
    )


def _raises_context(node: ast.AST) -> bool:
    """Whether a `with` item is `pytest.raises`/`pytest.warns`.

    Those are assertions -- the block fails if nothing raises -- so they exempt
    a test from the zero-assertion rule.
    """
    if not isinstance(node, ast.With | ast.AsyncWith):
        return False
    return any(
        _attribute_name(item.context_expr) in {"raises", "warns"}
        for item in node.items
        if isinstance(item.context_expr, ast.Call)
    )


def _classify(function: ast.FunctionDef | ast.AsyncFunctionDef) -> tuple[int, int, int]:
    """Count `(assertions, call assertions, outcome assertions)` in one test.

    Assertions in a nested function count: `httpx.MockTransport` handlers
    assert on the request they are handed.
    """
    assertions = call_assertions = outcome = 0
    for node in ast.walk(function):
        if node is not function and _is_test_function(node):
            continue
        if isinstance(node, ast.Assert):
            assertions += 1
            if _mentions_call_attribute(node.test):
                call_assertions += 1
            else:
                outcome += 1
        elif isinstance(node, ast.Call):
            name = _attribute_name(node)
            if name in CALL_ASSERTIONS:
                assertions += 1
                call_assertions += 1
            elif (
                name in ABSENCE_ASSERTIONS
                or ASSERT_HELPER_MARKER in name.lower()
                or (
                    isinstance(node.func, ast.Name)
                    and ASSERT_HELPER_MARKER in node.func.id.lower()
                )
            ):
                assertions += 1
                outcome += 1
        elif _raises_context(node):
            assertions += 1
            outcome += 1
    return assertions, call_assertions, outcome


def _cannot_fail(
    function: ast.FunctionDef | ast.AsyncFunctionDef,
) -> list[tuple[int, str]]:
    """Assertions whose two sides are the same expression, or a truthy constant."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(function):
        if not isinstance(node, ast.Assert):
            continue
        test = node.test
        if isinstance(test, ast.Constant) and bool(test.value):
            found.append(
                (node.lineno, CONSTANT_ASSERT_MESSAGE.format(source=ast.unparse(test)))
            )
            continue
        if (
            isinstance(test, ast.Compare)
            and len(test.ops) == 1
            and isinstance(test.ops[0], ast.Eq | ast.Is)
            and ast.unparse(test.left) == ast.unparse(test.comparators[0])
        ):
            found.append(
                (node.lineno, CANNOT_FAIL_MESSAGE.format(source=ast.unparse(test)))
            )
    return found


def check_source(source: str) -> list[tuple[int, str]]:
    """Return every `(line, message)` the three rules find in one file."""
    found: list[tuple[int, str]] = []
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not _is_test_function(node):
            continue
        assert isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
        assertions, call_assertions, outcome = _classify(node)
        if assertions == 0:
            found.append((node.lineno, NO_ASSERTIONS_MESSAGE.format(name=node.name)))
        elif call_assertions > 0 and outcome == 0:
            found.append(
                (node.lineno, CALL_ASSERTIONS_ONLY_MESSAGE.format(name=node.name))
            )
        found.extend(_cannot_fail(node))
    return sorted(found)


def python_files(roots: list[Path]) -> list[Path]:
    """Expand the given files and directories into the test files to read."""
    files = {root for root in roots if root.is_file()}
    files.update(
        path for root in roots if root.is_dir() for path in root.rglob("test_*.py")
    )
    return sorted(files)


def main(argv: list[str]) -> int:
    roots = [Path(argument) for argument in argv] or [
        Path(name) for name in DEFAULT_PATHS
    ]
    # A vanished root must fail loudly: silently scanning nothing reads green.
    missing = [root for root in roots if not root.exists()]
    if missing:
        for root in missing:
            print(f"ERROR: root does not exist: {root}", file=sys.stderr)
        return 1
    reported = 0
    for path in python_files(roots):
        for line, message in check_source(path.read_text(encoding="utf-8")):
            print(f"{path}:{line}: {message}")
            reported += 1
    if reported:
        print(f"\n{reported} test-meaningfulness violations.", file=sys.stderr)
    return 1 if reported else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
