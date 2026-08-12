"""Load the repository-reviewed Alembic head for operational tooling."""

from __future__ import annotations

import re
from pathlib import Path

EXPECTED_HEAD_PATTERN = re.compile(r"^[0-9]{8}_[0-9]{4}$")


def load_expected_alembic_head() -> str:
    """Read one validated head from a repository or installed-tool snapshot."""
    script_path = Path(__file__).resolve()
    candidates = (
        script_path.with_name("expected-alembic-head.txt"),
        script_path.parents[1] / "alembic" / "expected-head.txt",
    )
    for candidate in candidates:
        if candidate.is_file() and not candidate.is_symlink():
            value = candidate.read_text(encoding="utf-8").strip()
            if EXPECTED_HEAD_PATTERN.fullmatch(value) is None:
                raise RuntimeError("the expected Alembic head has an invalid shape")
            return value
    raise RuntimeError("the reviewed expected Alembic head file is missing")


EXPECTED_ALEMBIC_HEAD = load_expected_alembic_head()
