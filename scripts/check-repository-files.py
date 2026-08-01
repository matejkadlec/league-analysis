#!/usr/bin/env python3
"""Run deterministic repository hygiene checks without modifying files."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
CONFLICT_MARKERS = ("<<<<<<< ", "=======", ">>>>>>> ")
FORBIDDEN_TRACKED_NAMES = {".env", "id_rsa", "id_ed25519"}


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
        relative = path.relative_to(REPOSITORY_ROOT)
        if path.name in FORBIDDEN_TRACKED_NAMES or path.suffix in {".pem", ".key"}:
            errors.append(f"sensitive-looking file is tracked: {relative}")
            continue
        if not path.is_file():
            continue
        if path.suffix == ".json":
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
                errors.append(f"invalid JSON in {relative}: {error}")
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if any(line.startswith(marker) for marker in CONFLICT_MARKERS):
                errors.append(f"merge-conflict marker in {relative}:{line_number}")

    if errors:
        print("Repository hygiene failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Tracked JSON, conflict markers, and sensitive filenames are clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
