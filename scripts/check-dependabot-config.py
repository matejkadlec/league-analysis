#!/usr/bin/env python3
"""Validate the repository's deliberately narrow Dependabot v2 configuration."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
CONFIGURATION = REPOSITORY_ROOT / ".github" / "dependabot.yml"
BLOCK_START = re.compile(r'^  - package-ecosystem: "(?P<ecosystem>[a-z-]+)"$')
DIRECTORY = re.compile(r'^    directory: "(?P<directory>/.*)"$')
OPEN_LIMIT = re.compile(r"^    open-pull-requests-limit: (?P<limit>[1-9][0-9]*)$")
EXPECTED_LABELS = {
    "npm": "frontend",
    "uv": "backend",
    "github-actions": "github-actions",
}


def expected_updates() -> dict[tuple[str, str], int]:
    expected: dict[tuple[str, str], int] = {}
    if (REPOSITORY_ROOT / "frontend" / "package.json").is_file() and (
        REPOSITORY_ROOT / "frontend" / "package-lock.json"
    ).is_file():
        expected[("npm", "/frontend")] = 3
    if (REPOSITORY_ROOT / "backend" / "pyproject.toml").is_file() and (
        REPOSITORY_ROOT / "backend" / "uv.lock"
    ).is_file():
        expected[("uv", "/backend")] = 3
    if any((REPOSITORY_ROOT / ".github" / "workflows").glob("*.y*ml")):
        expected[("github-actions", "/")] = 2

    docker_directories = {
        path.parent.relative_to(REPOSITORY_ROOT).as_posix()
        for path in REPOSITORY_ROOT.rglob("Dockerfile*")
        if ".git" not in path.parts and "node_modules" not in path.parts
    }
    for directory in docker_directories:
        expected[("docker", f"/{directory}" if directory != "." else "/")] = 2
    return expected


def update_blocks(lines: list[str], errors: list[str]) -> list[list[str]]:
    starts = [index for index, line in enumerate(lines) if BLOCK_START.fullmatch(line)]
    if not starts:
        errors.append("updates must contain at least one package-ecosystem block")
        return []
    blocks: list[list[str]] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(lines)
        blocks.append(lines[start:end])
    return blocks


def require_line(block: list[str], line: str, label: str, errors: list[str]) -> None:
    if line not in block:
        errors.append(f"{label} is missing {line!r}")


def validate_block(block: list[str], errors: list[str]) -> tuple[str, str, int] | None:
    start = BLOCK_START.fullmatch(block[0])
    if start is None:
        errors.append(f"invalid update block start: {block[0]!r}")
        return None
    ecosystem = start.group("ecosystem")
    directory_match = next(
        (match for line in block if (match := DIRECTORY.fullmatch(line)) is not None),
        None,
    )
    if directory_match is None:
        errors.append(f"{ecosystem} update has no absolute directory")
        return None
    directory = directory_match.group("directory")
    limit_match = next(
        (match for line in block if (match := OPEN_LIMIT.fullmatch(line)) is not None),
        None,
    )
    if limit_match is None:
        errors.append(f"{ecosystem} update has no positive open-pull-requests-limit")
        return None
    limit = int(limit_match.group("limit"))

    require_line(block, '    target-branch: "master"', ecosystem, errors)
    require_line(block, "    schedule:", ecosystem, errors)
    require_line(block, '      interval: "weekly"', ecosystem, errors)
    require_line(block, '      day: "monday"', ecosystem, errors)
    require_line(block, '      timezone: "Europe/Prague"', ecosystem, errors)
    if not any(
        re.fullmatch(r'      time: "(?:[01][0-9]|2[0-3]):[0-5][0-9]"', line)
        for line in block
    ):
        errors.append(f"{ecosystem} update needs a valid local schedule time")
    require_line(block, "    labels:", ecosystem, errors)
    require_line(block, '      - "dependencies"', ecosystem, errors)
    expected_label = EXPECTED_LABELS.get(ecosystem)
    if expected_label is not None:
        require_line(block, f'      - "{expected_label}"', ecosystem, errors)
    require_line(block, "    groups:", ecosystem, errors)
    require_line(block, "      minor-and-patch:", ecosystem, errors)
    require_line(block, '        applies-to: "version-updates"', ecosystem, errors)
    require_line(block, '          - "*"', ecosystem, errors)
    require_line(block, '          - "minor"', ecosystem, errors)
    require_line(block, '          - "patch"', ecosystem, errors)
    return ecosystem, directory, limit


def main() -> int:
    errors: list[str] = []
    if not CONFIGURATION.is_file():
        errors.append(f"missing {CONFIGURATION.relative_to(REPOSITORY_ROOT)}")
    else:
        lines = CONFIGURATION.read_text(encoding="utf-8").splitlines()
        if not lines or lines[0] != "version: 2":
            errors.append("dependabot configuration must start with version: 2")
        if "updates:" not in lines:
            errors.append("dependabot configuration has no updates list")
        actual: dict[tuple[str, str], int] = {}
        for block in update_blocks(lines, errors):
            result = validate_block(block, errors)
            if result is None:
                continue
            ecosystem, directory, limit = result
            key = (ecosystem, directory)
            if key in actual:
                errors.append(
                    f"duplicate Dependabot update for {ecosystem} at {directory}"
                )
            actual[key] = limit
        expected = expected_updates()
        if actual != expected:
            errors.append(
                "configured ecosystems/directories/limits do not match repository "
                f"manifests: expected {expected}, found {actual}"
            )

    if errors:
        print("Dependabot configuration validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Dependabot configuration covers every current dependency ecosystem.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
