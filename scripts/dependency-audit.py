#!/usr/bin/env python3
"""Compare live production dependency findings between base and candidate."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


class AuditError(RuntimeError):
    """Raised when an audit cannot produce trustworthy structured output."""


@dataclass(frozen=True, order=True)
class Finding:
    ecosystem: str
    package: str
    advisory: str


@dataclass(frozen=True)
class Comparison:
    inherited: tuple[Finding, ...]
    new: tuple[Finding, ...]
    production_manifest_changed: bool

    @property
    def blocks(self) -> bool:
        return bool(self.new) or (
            self.production_manifest_changed and bool(self.inherited)
        )


def compare_findings(
    base: set[Finding], candidate: set[Finding], production_manifest_changed: bool
) -> Comparison:
    return Comparison(
        inherited=tuple(sorted(base & candidate)),
        new=tuple(sorted(candidate - base)),
        production_manifest_changed=production_manifest_changed,
    )


def parse_npm_audit(data: dict[str, Any]) -> set[Finding]:
    if "error" in data:
        raise AuditError(f"npm audit service failed: {data['error']}")
    vulnerabilities = data.get("vulnerabilities")
    if not isinstance(vulnerabilities, dict):
        raise AuditError("npm audit output has no vulnerabilities object")

    findings: set[Finding] = set()
    for package, details in vulnerabilities.items():
        if not isinstance(details, dict) or details.get("severity") not in {
            "high",
            "critical",
        }:
            continue
        via = details.get("via", [])
        advisory_ids: set[str] = set()
        if isinstance(via, list):
            for item in via:
                if isinstance(item, dict):
                    advisory_ids.add(str(item.get("url") or item.get("source") or item))
                elif isinstance(item, str):
                    advisory_ids.add(item)
        if not advisory_ids:
            advisory_ids.add(f"severity:{details.get('severity')}")
        findings.update(Finding("npm", package, advisory) for advisory in advisory_ids)
    return findings


def parse_pip_audit(data: dict[str, Any]) -> set[Finding]:
    dependencies = data.get("dependencies")
    if not isinstance(dependencies, list):
        raise AuditError("pip-audit output has no dependencies list")
    findings: set[Finding] = set()
    for dependency in dependencies:
        if not isinstance(dependency, dict):
            continue
        package = str(dependency.get("name", "unknown"))
        vulnerabilities = dependency.get("vulns", [])
        if not isinstance(vulnerabilities, list):
            continue
        for vulnerability in vulnerabilities:
            if isinstance(vulnerability, dict) and vulnerability.get("id"):
                findings.add(Finding("python", package, str(vulnerability["id"])))
    return findings


def run(command: list[str], *, cwd: Path, allow_findings: bool = False) -> str:
    result = subprocess.run(
        command, cwd=cwd, text=True, capture_output=True, check=False
    )
    if result.returncode != 0 and not allow_findings:
        raise AuditError(
            f"command failed ({' '.join(command)}): {result.stderr.strip()}"
        )
    if result.returncode not in ({0, 1} if allow_findings else {0}):
        raise AuditError(
            f"audit command failed ({' '.join(command)}): {result.stderr.strip()}"
        )
    return result.stdout


def write_revision_file(revision: str, source: str, destination: Path) -> None:
    result = subprocess.run(
        ["git", "show", f"{revision}:{source}"],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise AuditError(f"cannot read {source} from base revision {revision}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(result.stdout)


def npm_dependencies(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        key: data.get(key, {})
        for key in ("dependencies", "optionalDependencies", "peerDependencies")
    }


def npm_audit_manifest(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if key != "devEngines"}


def prepare_npm_audit_manifest(path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise AuditError(f"npm manifest is not an object: {path}")
    path.write_text(json.dumps(npm_audit_manifest(data)) + "\n", encoding="utf-8")


def python_dependencies(path: Path) -> list[str]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    project = data.get("project", {})
    return list(project.get("dependencies", [])) if isinstance(project, dict) else []


def audit_npm(directory: Path) -> set[Finding]:
    output = run(
        ["npm", "audit", "--package-lock-only", "--omit=dev", "--json"],
        cwd=directory,
        allow_findings=True,
    )
    return parse_npm_audit(json.loads(output))


def export_requirements(directory: Path, destination: Path) -> None:
    run(
        [
            "uv",
            "export",
            "--project",
            str(directory),
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--format",
            "requirements-txt",
            "--output-file",
            str(destination),
        ],
        cwd=REPOSITORY_ROOT,
    )


def audit_python(directory: Path, requirements: Path) -> set[Finding]:
    output = run(
        [
            "uv",
            "run",
            "--project",
            str(REPOSITORY_ROOT / "backend"),
            "pip-audit",
            "--strict",
            "--progress-spinner",
            "off",
            "--format",
            "json",
            "--requirement",
            str(requirements),
        ],
        cwd=directory,
        allow_findings=True,
    )
    return parse_pip_audit(json.loads(output))


def print_comparison(name: str, comparison: Comparison) -> None:
    state = "BLOCK" if comparison.blocks else "PASS"
    print(
        f"{state}: {name}: {len(comparison.new)} new, "
        f"{len(comparison.inherited)} inherited findings; "
        f"production manifest changed={comparison.production_manifest_changed}."
    )
    for finding in comparison.new:
        print(f"  new: {finding.package} {finding.advisory}")


def prepare_tree(directory: Path, revision: str | None, files: tuple[str, ...]) -> None:
    for source in files:
        destination = directory / Path(source).name
        if revision is None:
            shutil.copy2(REPOSITORY_ROOT / source, destination)
        else:
            write_revision_file(revision, source, destination)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"Usage: {argv[0]} <base-revision>", file=sys.stderr)
        return 2
    base_revision = argv[1]
    verification = subprocess.run(
        ["git", "cat-file", "-e", f"{base_revision}^{{commit}}"],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        check=False,
    )
    if verification.returncode != 0:
        print(
            f"Dependency audit base is not a commit: {base_revision}", file=sys.stderr
        )
        return 2

    try:
        with tempfile.TemporaryDirectory(prefix="league-analysis-audit-") as temporary:
            audit_root = Path(temporary)
            base_frontend = audit_root / "base-frontend"
            head_frontend = audit_root / "head-frontend"
            base_backend = audit_root / "base-backend"
            head_backend = audit_root / "head-backend"
            for directory in (
                base_frontend,
                head_frontend,
                base_backend,
                head_backend,
            ):
                directory.mkdir()

            prepare_tree(
                base_frontend,
                base_revision,
                ("frontend/package.json", "frontend/package-lock.json"),
            )
            prepare_tree(
                head_frontend,
                None,
                ("frontend/package.json", "frontend/package-lock.json"),
            )
            prepare_npm_audit_manifest(base_frontend / "package.json")
            prepare_npm_audit_manifest(head_frontend / "package.json")
            prepare_tree(
                base_backend,
                base_revision,
                ("backend/pyproject.toml", "backend/uv.lock"),
            )
            prepare_tree(
                head_backend,
                None,
                ("backend/pyproject.toml", "backend/uv.lock"),
            )

            base_requirements = audit_root / "base-requirements.txt"
            head_requirements = audit_root / "head-requirements.txt"
            export_requirements(base_backend, base_requirements)
            export_requirements(head_backend, head_requirements)

            comparisons = (
                (
                    "frontend npm",
                    compare_findings(
                        audit_npm(base_frontend),
                        audit_npm(head_frontend),
                        npm_dependencies(base_frontend / "package.json")
                        != npm_dependencies(head_frontend / "package.json"),
                    ),
                ),
                (
                    "backend Python",
                    compare_findings(
                        audit_python(base_backend, base_requirements),
                        audit_python(head_backend, head_requirements),
                        python_dependencies(base_backend / "pyproject.toml")
                        != python_dependencies(head_backend / "pyproject.toml"),
                    ),
                ),
            )
    except (
        AuditError,
        json.JSONDecodeError,
        OSError,
        tomllib.TOMLDecodeError,
    ) as error:
        print(f"Dependency audit failed closed: {error}", file=sys.stderr)
        return 2

    blocked = False
    for name, comparison in comparisons:
        print_comparison(name, comparison)
        blocked = blocked or comparison.blocks
    return 1 if blocked else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
