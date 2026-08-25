"""Comment hygiene for Python, mirroring the frontend's three oxlint rules.

The frontend enforces `no-long-comments`, `no-deferral-comments` and
`no-compat-shims` as oxlint custom plugins. Ruff has no plugin API and no
comment-length rule, so the backend half is this script rather than a fork or a
new dependency. The regexes are copied verbatim from the oxlint rules so a
sentence that fails review in TypeScript fails it here too.

What the three checks say:

`no-long-comments` — a comment past a few lines is usually code that never got
clarified, or narration of how it got that way rather than what it constrains. A
run of consecutive own-line `#` lines counts as ONE comment, because per-line
counting would make the ceiling unenforceable. A comment trailing code
(`x = 1  # why`) starts its own block: the code between it and the previous
line breaks the run.

`no-deferral-comments` — a "for now / TODO / temporary" comment is a scope
decision recorded nowhere an owner will see, defaulting to permanent. Build it,
or file an LGA ticket and delete the marker.

`no-compat-shims` — this is an application, not a library: every caller is in
this repository, so there is no "backward" to be compatible with. Renames
update all call sites in the same change; old paths are deleted, not
deprecated. The identifier half runs over the AST, not over the text, so a
string literal that merely mentions "legacy" is not a hit.

DOCSTRINGS ARE NOT COMMENTS. They are the documented interface of a module,
class or function, and this script never looks at them: `tokenize` reports them
as STRING tokens and only `#` text arrives as COMMENT.

Usage: `python scripts/check_comments.py [path ...]`, run from `backend/`.
Reports `path:line: rule: message` and exits 1 when anything is reported.
`--self-check` is in `tests/test_check_comments.py` instead, next to the rest
of the suite.
"""

from __future__ import annotations

import ast
import io
import re
import sys
import tokenize
from pathlib import Path

MAX_PROSE_LINES = 4
DEFAULT_PATHS = ("app", "tests", "scripts")

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


def compat_names(source: str) -> list[tuple[int, str]]:
    """Return declared names that announce a legacy or deprecated thing.

    Decorators are read too: `@deprecated` is the JSDoc tag's Python spelling,
    and `warnings.deprecated` reaches it through an attribute.
    """
    declared: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(source)):
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


def check_source(source: str) -> list[tuple[int, str]]:
    """Return every `(line, message)` the three checks find in one file."""
    found: list[tuple[int, str]] = []
    for block in comment_blocks(source):
        if len(block) > MAX_PROSE_LINES:
            message = LONG_MESSAGE.format(count=len(block), ceiling=MAX_PROSE_LINES)
            found.append((block[0].start[0], message))
        for token in block:
            deferral = DEFERRAL.search(token.string)
            if deferral:
                found.append(
                    (token.start[0], DEFERRAL_MESSAGE.format(match=deferral.group(0)))
                )
            compat = COMPAT_COMMENT.search(token.string)
            if compat:
                found.append(
                    (
                        token.start[0],
                        COMPAT_COMMENT_MESSAGE.format(match=compat.group(0)),
                    )
                )
    found.extend(
        (line, COMPAT_NAME_MESSAGE.format(name=name))
        for line, name in compat_names(source)
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
