#!/usr/bin/env python3
"""Refuse to track a file whose name implies a secret.

Scans every tracked and untracked-but-not-ignored file, so a credential
committed before the hooks were installed is still caught. JSON validity and
merge-conflict markers are covered by the check-json and check-merge-conflict
pre-commit hooks.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN_TRACKED_NAMES = {".env", "id_rsa", "id_ed25519"}
FORBIDDEN_SUFFIXES = {".pem", ".key"}


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
    )
    return [
        REPOSITORY_ROOT / path.decode() for path in result.stdout.split(b"\0") if path
    ]


def main() -> int:
    errors: list[str] = []
    for path in tracked_files():
        if path.name in FORBIDDEN_TRACKED_NAMES or path.suffix in FORBIDDEN_SUFFIXES:
            errors.append(
                f"sensitive-looking file is tracked: {path.relative_to(REPOSITORY_ROOT)}"
            )

    if errors:
        print("Repository hygiene failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("No sensitive-looking filenames are tracked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
