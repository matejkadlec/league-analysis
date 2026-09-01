"""Comment hygiene for Python, mirroring the frontend's oxlint rules.

Ruff has no comment-length rule, so the backend half is a script, not a fork.
Run from `backend/`: `python scripts/check_comments.py [path]`.
"""

from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from pathlib import Path

MAX_PROSE_LINES = 2
# `alembic` is deliberately out: revisions are immutable historical records
# whose prose narrates legacy/compat transitions by design.
DEFAULT_PATHS = ("app", "tests", "scripts")

DIRECTIVE = re.compile(r"^#\s*(noqa\b|type:\s*ignore|ruff:|mypy:|pyright:|pylint:)")

DEFERRAL = re.compile(
    r"\b(TODO|FIXME|XXX)\b|\bhack(y|ish)?\b|for now\b|\btemporar(y|ily)\b"
    r"|\bstopgap\b|\bband-aid\b|quick (fix|follow)|good enough for\b"
    r"|for the demo\b|in a real (app|product|implementation)\b"
    r"|(implement|handle|clean(ed)? up|improve|finish|fix( it)?|do (this|it)"
    r"|revisit)\s+(this\s+)?later\b|\bfollow-?up (PR|task|change)\b",
    re.IGNORECASE,
)
COMPAT_COMMENT = re.compile(
    r"@deprecated|backwards?[- ]compat|kept for (old|compat|legacy)"
    r"|for old (callers|clients|formats?)|supports? the old\b"
    r"|\blegacy (path|format|behavio|support)|old format\b",
    re.IGNORECASE,
)
COMPAT_NAME = re.compile(r"^(legacy|deprecated)|Legacy|Deprecated")

# A docstring's summary line and structured sections are free; everything else
# in it is prose under the same ceiling as a comment.
SECTIONS = frozenset(
    (
        "Args:",
        "Arguments:",
        "Attributes:",
        "Example:",
        "Examples:",
        "Parameters:",
        "Raises:",
        "Returns:",
        "Yields:",
    )
)

LONG_DOCSTRING_MESSAGE = (
    "no-long-docstrings: this docstring carries {count} lines of prose past "
    "its summary; the ceiling is {ceiling}. A docstring documents the "
    "interface -- state it, name the arguments under `Args:`, and cut the "
    "narration. FastAPI publishes a route docstring as the OpenAPI "
    "description, so what is written here is served to callers."
)
LONG_MESSAGE = (
    "no-long-comments: this comment carries {count} lines of prose; the "
    "ceiling is {ceiling}. Keep the constraint a reader needs and cut the "
    "narration -- what it replaced, how it was found, which run it broke."
)
DEFERRAL_MESSAGE = (
    'no-deferral-comments: deferral marker in a comment ("{match}"). Build it '
    "right, or file an LGA ticket and delete the marker; an approved unbuilt "
    "path raises, it never silently degrades."
)
COMPAT_COMMENT_MESSAGE = (
    'no-compat-shims: backward-compatibility marker in a comment ("{match}"). '
    "Nothing outside this repository calls our internals: update every caller "
    "in this change, migrate data forward, and DELETE the old path."
)
COMPAT_NAME_MESSAGE = (
    'no-compat-shims: identifier "{name}" declares a legacy/deprecated thing. '
    "Do not keep two ways to do the same thing — replace the old one and "
    "update its callers in this change."
)


def comment_blocks(source: str) -> list[list[tokenize.TokenInfo]]:
    """Group `#` comments the way the oxlint rule groups `//` ones."""
    blocks: list[list[tokenize.TokenInfo]] = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type != tokenize.COMMENT:
            continue
        trailing = token.line[: token.start[1]].strip() != ""
        joins = (
            bool(blocks)
            and not trailing
            and token.start[0] == blocks[-1][-1].start[0] + 1
        )
        if joins:
            blocks[-1].append(token)
        else:
            blocks.append([token])
    return blocks


def docstring_prose(doc: str) -> int:
    """Count the lines of a docstring that are narration, not documentation."""
    prose = 0
    section_indent: int | None = None
    for raw in doc.expandtabs().splitlines()[1:]:
        text = raw.strip()
        if not text:
            continue
        indent = len(raw) - len(raw.lstrip())
        if section_indent is not None and indent > section_indent:
            continue
        section_indent = None
        if text in SECTIONS:
            section_indent = indent
            continue
        prose += 1
    return prose


def long_docstrings(tree: ast.Module) -> list[tuple[int, str]]:
    """Return every docstring whose prose runs past the ceiling."""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(
            node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
        ):
            continue
        doc = ast.get_docstring(node, clean=False)
        if doc is None:
            continue
        prose = docstring_prose(doc)
        if prose <= MAX_PROSE_LINES:
            continue
        body = node.body[0]
        found.append(
            (
                body.lineno,
                LONG_DOCSTRING_MESSAGE.format(count=prose, ceiling=MAX_PROSE_LINES),
            )
        )
    return found


def stray_string_docs(tree: ast.Module) -> list[tuple[int, str]]:
    """Return over-ceiling bare string statements anywhere in the tree.

    `ast.get_docstring` sees only a docstring holder's first statement; any
    other bare string (attribute docstring, f-string) is caught here instead.
    """
    docstring_lines = {
        node.body[0].lineno
        for node in ast.walk(tree)
        if isinstance(
            node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef
        )
        and ast.get_docstring(node) is not None
    }
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Expr) or node.lineno in docstring_lines:
            continue
        text = _string_text(node.value)
        if text is None:
            continue
        prose = docstring_prose(text)
        if prose > MAX_PROSE_LINES:
            found.append(
                (
                    node.lineno,
                    LONG_DOCSTRING_MESSAGE.format(count=prose, ceiling=MAX_PROSE_LINES),
                )
            )
    return found


def _string_text(value: ast.expr) -> str | None:
    """The text of a plain or formatted string expression, else None."""
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return value.value
    if isinstance(value, ast.JoinedStr):
        return "".join(
            part.value
            if isinstance(part, ast.Constant) and isinstance(part.value, str)
            else "{}"
            for part in value.values
        )
    return None


def compat_names(tree: ast.Module) -> list[tuple[int, str]]:
    """Return declared names that announce a legacy or deprecated thing.

    Decorators are read too: the deprecation decorator is the JSDoc tag's
    Python spelling, and `warnings` reaches it through an attribute.
    """
    declared: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            declared.append((node.lineno, node.name))
            declared.extend(
                (child.lineno, child.id if isinstance(child, ast.Name) else child.attr)
                for decorator in node.decorator_list
                for child in ast.walk(decorator)
                if isinstance(child, ast.Name | ast.Attribute)
            )
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            declared.append((node.lineno, node.id))
    return [(line, name) for line, name in declared if COMPAT_NAME.search(name)]


def marker_hits(line: int, text: str) -> list[tuple[int, str]]:
    """Deferral and compat findings for one comment or docstring's text."""
    found: list[tuple[int, str]] = []
    deferral = DEFERRAL.search(text)
    if deferral:
        found.append((line, DEFERRAL_MESSAGE.format(match=deferral.group(0))))
    compat = COMPAT_COMMENT.search(text)
    if compat:
        found.append((line, COMPAT_COMMENT_MESSAGE.format(match=compat.group(0))))
    return found


def doc_texts(tree: ast.Module) -> list[tuple[int, str]]:
    """Every documentation string in the tree: docstrings and bare strings."""
    texts: dict[int, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr):
            text = _string_text(node.value)
            if text is not None:
                texts.setdefault(node.lineno, text)
    return sorted(texts.items())


def check_source(source: str) -> list[tuple[int, str]]:
    """Return every `(line, message)` the four checks find in one file."""
    found: list[tuple[int, str]] = []
    for block in comment_blocks(source):
        # A tool directive is machinery, not prose, but it stays in the run so
        # it cannot split one thought into two blocks under the ceiling.
        prose = [token for token in block if not DIRECTIVE.match(token.string)]
        if len(prose) > MAX_PROSE_LINES:
            message = LONG_MESSAGE.format(count=len(prose), ceiling=MAX_PROSE_LINES)
            found.append((block[0].start[0], message))
        for token in block:
            found.extend(marker_hits(token.start[0], token.string))
    tree = ast.parse(source)
    found.extend(long_docstrings(tree))
    found.extend(stray_string_docs(tree))
    for line, text in doc_texts(tree):
        found.extend(marker_hits(line, text))
    found.extend(
        (line, COMPAT_NAME_MESSAGE.format(name=name))
        for line, name in compat_names(tree)
    )
    return sorted(found)


def python_files(roots: list[Path]) -> list[Path]:
    """Expand the given files and directories into the Python files to read."""
    files = {root for root in roots if root.is_file()}
    files.update(path for root in roots if root.is_dir() for path in root.rglob("*.py"))
    return sorted(files)


def main(argv: list[str]) -> int:
    roots = [Path(argument) for argument in argv] or [
        Path(name) for name in DEFAULT_PATHS
    ]
    reported = 0
    for path in python_files(roots):
        for line, message in check_source(path.read_text(encoding="utf-8")):
            print(f"{path}:{line}: {message}")
            reported += 1
    if reported:
        print(f"\n{reported} comment-hygiene violations.", file=sys.stderr)
    return 1 if reported else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
