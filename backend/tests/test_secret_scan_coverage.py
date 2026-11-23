"""The working-tree secret scan covers every repository file from any directory.

`test.sh` runs its first backend steps before the scan and leaves the shell in
`backend/`. The scan then looked for each repository path there, found one, and
passed.
"""

import os
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNNER = REPO_ROOT / "tools" / "run-gitleaks.sh"


def _repository_files_on_disk() -> int:
    """Tracked and untracked, not ignored, and present: what the scan must read."""
    listed = subprocess.run(
        [
            "git",
            "-C",
            str(REPO_ROOT),
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        capture_output=True,
        check=True,
    ).stdout.decode()
    return sum(1 for path in listed.split("\0") if path and (REPO_ROOT / path).exists())


def test_the_working_tree_scan_reads_every_file_when_started_from_backend(
    tmp_path: Path,
) -> None:
    pinned = re.search(r"expected_version='([^']+)'", RUNNER.read_text())
    assert pinned is not None, "run-gitleaks.sh pins no gitleaks version"
    gitleaks = tmp_path / "gitleaks"
    gitleaks.write_text(
        f'#!/bin/bash\nif [ "$1" = version ]; then echo "v{pinned.group(1)}"; fi\n'
    )
    gitleaks.chmod(0o755)
    expected = _repository_files_on_disk()

    result = subprocess.run(
        ["bash", str(RUNNER)],
        cwd=REPO_ROOT / "backend",
        env={**os.environ, "GITLEAKS_BINARY": str(gitleaks), "TMPDIR": str(tmp_path)},
        capture_output=True,
        text=True,
        check=False,
        timeout=50,
    )

    assert result.returncode == 0, result.stderr
    assert f"gitleaks: {expected} tracked and untracked working-tree files" in (
        result.stdout
    )
