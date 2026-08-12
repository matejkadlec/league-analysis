#!/usr/bin/env python3
"""Enforce immutable actions and least-privilege workflow policy."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIRECTORY = REPOSITORY_ROOT / ".github" / "workflows"
PINNED_USE = re.compile(r"^[^@\s]+@[0-9a-f]{40}$")
USE_LINE = re.compile(r"^\s*uses:\s*([^\s#]+)(?:\s+#\s+(.+))?$")
JOB_LINE = re.compile(r"^  ([a-zA-Z0-9_-]+):\s*$")


def job_blocks(lines: list[str]) -> dict[str, list[str]]:
    jobs_index = next(
        (index for index, line in enumerate(lines) if line == "jobs:"), None
    )
    if jobs_index is None:
        return {}
    blocks: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines[jobs_index + 1 :]:
        if line and not line.startswith(" "):
            break
        match = JOB_LINE.match(line)
        if match:
            current = match.group(1)
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line)
    return blocks


def main() -> int:
    errors: list[str] = []
    workflows = sorted(
        (*WORKFLOW_DIRECTORY.glob("*.yml"), *WORKFLOW_DIRECTORY.glob("*.yaml"))
    )
    if not workflows:
        errors.append("no GitHub workflow definitions exist")

    for workflow in workflows:
        relative = workflow.relative_to(REPOSITORY_ROOT)
        lines = workflow.read_text(encoding="utf-8").splitlines()
        text = "\n".join(lines)
        is_deployment_workflow = workflow.name == "deploy.yml"
        if "pull_request_target:" in text:
            errors.append(f"{relative} must not use pull_request_target")
        # A workflow that never runs on pull requests, such as the production
        # deployment, must not be forced to declare that trigger.
        required_triggers = ["  push:", "  workflow_dispatch:"]
        if not is_deployment_workflow:
            required_triggers.append("  pull_request:")
        for required_trigger in required_triggers:
            if required_trigger not in lines:
                errors.append(
                    f"{relative} is missing trigger {required_trigger.strip()}"
                )
        if "permissions:\n  contents: read" not in text:
            errors.append(f"{relative} must declare only top-level contents: read")
        expected_cancellation = (
            "cancel-in-progress: false"
            if is_deployment_workflow
            else "cancel-in-progress: true"
        )
        if expected_cancellation not in text:
            errors.append(
                f"{relative} must declare {expected_cancellation} for its concurrency boundary"
            )

        for line_number, line in enumerate(lines, start=1):
            match = USE_LINE.match(line)
            if not match:
                continue
            target, version_comment = match.groups()
            if target.startswith(("./", "docker://")):
                continue
            if not PINNED_USE.fullmatch(target):
                errors.append(
                    f"{relative}:{line_number} action is not pinned by full SHA"
                )
            if not version_comment or not version_comment.startswith("v"):
                errors.append(
                    f"{relative}:{line_number} pinned action needs a version comment"
                )

        blocks = job_blocks(lines)
        if not blocks:
            errors.append(f"{relative} has no jobs")
        for job, block in blocks.items():
            if not any(line.startswith("    timeout-minutes:") for line in block):
                errors.append(f"{relative} job {job} has no timeout-minutes")

        checkout_steps = text.split("uses: actions/checkout@")
        for checkout_index, checkout_step in enumerate(checkout_steps[1:], start=1):
            step_text = checkout_step.split("\n      - name:", maxsplit=1)[0]
            if "persist-credentials: false" not in step_text:
                errors.append(
                    f"{relative} checkout step {checkout_index} persists credentials"
                )

    if errors:
        print("GitHub workflow policy failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("GitHub workflows use pinned actions, minimal permissions, and bounded jobs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
