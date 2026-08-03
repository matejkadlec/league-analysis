#!/usr/bin/env python3
"""Validate the checked-in master ruleset and audit its live GitHub state."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_REPOSITORY = "matejkadlec/league-analysis"
CONFIGURATION_PATH = REPOSITORY_ROOT / ".github" / "master-branch-ruleset.json"
EXPECTED_NAME = "Protect master with verified PR delivery"
EXPECTED_CONTEXTS = (
    "Deterministic full-project gate",
    "Live production dependency audit",
)
GITHUB_ACTIONS_INTEGRATION_ID = 15368
EXPECTED_RULE_TYPES = {
    "deletion",
    "non_fast_forward",
    "pull_request",
    "required_status_checks",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load_configuration() -> dict[str, Any]:
    try:
        configuration = json.loads(CONFIGURATION_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read {CONFIGURATION_PATH}: {error}") from error
    if not isinstance(configuration, dict):
        fail("ruleset configuration must be a JSON object")
    return configuration


def rules_by_type(configuration: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rules = configuration.get("rules")
    if not isinstance(rules, list):
        fail("ruleset configuration must contain a rules array")

    mapped_rules: dict[str, dict[str, Any]] = {}
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("type"), str):
            fail("each ruleset rule must be an object with a type")
        rule_type = rule["type"]
        if rule_type in mapped_rules:
            fail(f"ruleset configuration contains duplicate rule type: {rule_type}")
        mapped_rules[rule_type] = rule
    return mapped_rules


def status_checks(rule: dict[str, Any]) -> tuple[tuple[str, int], ...]:
    parameters = rule.get("parameters")
    if not isinstance(parameters, dict):
        fail("required_status_checks rule must include parameters")
    checks = parameters.get("required_status_checks")
    if not isinstance(checks, list):
        fail("required_status_checks must be an array")
    configured_checks: list[tuple[str, int]] = []
    for check in checks:
        if not isinstance(check, dict) or not isinstance(check.get("context"), str):
            fail("each required status check must declare a context")
        if not isinstance(check.get("integration_id"), int):
            fail("each required status check must bind a GitHub integration")
        configured_checks.append((check["context"], check["integration_id"]))
    return tuple(configured_checks)


def validate_configuration(configuration: dict[str, Any]) -> None:
    if configuration.get("name") != EXPECTED_NAME:
        fail(f"ruleset name must be {EXPECTED_NAME!r}")
    if configuration.get("target") != "branch":
        fail("ruleset target must be branch")
    if configuration.get("enforcement") != "active":
        fail("ruleset enforcement must be active")
    if configuration.get("bypass_actors") != []:
        fail("ruleset bypass actors must remain empty")

    conditions = configuration.get("conditions")
    if not isinstance(conditions, dict) or conditions.get("ref_name") != {
        "include": ["refs/heads/master"],
        "exclude": [],
    }:
        fail("ruleset must target exactly refs/heads/master")

    rules = rules_by_type(configuration)
    if set(rules) != EXPECTED_RULE_TYPES:
        fail(
            "ruleset must contain only deletion, non-fast-forward, pull-request, and status-check rules"
        )

    pull_request = rules["pull_request"].get("parameters")
    if not isinstance(pull_request, dict):
        fail("pull_request rule must include parameters")
    expected_pull_request = {
        "allowed_merge_methods": ["merge", "squash", "rebase"],
        "dismiss_stale_reviews_on_push": True,
        "dismissal_restriction": {"enabled": False},
        "require_code_owner_review": False,
        "require_last_push_approval": False,
        "required_approving_review_count": 0,
        "required_review_thread_resolution": True,
    }
    if pull_request != expected_pull_request:
        fail("pull_request rule does not match the documented sole-owner policy")

    required_status_checks = rules["required_status_checks"].get("parameters")
    if not isinstance(required_status_checks, dict):
        fail("required_status_checks rule must include parameters")
    if required_status_checks.get("do_not_enforce_on_create") is not False:
        fail("status checks must apply to every merge into master")
    if required_status_checks.get("strict_required_status_checks_policy") is not True:
        fail("status checks must require a branch current with master")
    expected_checks = tuple(
        (context, GITHUB_ACTIONS_INTEGRATION_ID) for context in EXPECTED_CONTEXTS
    )
    if status_checks(rules["required_status_checks"]) != expected_checks:
        fail("status checks must match the stable GitHub Actions jobs and integration")


def fetch_live_rulesets(repository: str) -> list[dict[str, Any]]:
    if shutil.which("gh") is None:
        fail("GitHub CLI (gh) is required for the live ruleset audit")
    result = subprocess.run(
        [
            "gh",
            "api",
            f"repos/{repository}/rulesets?targets=branch&includes_parents=true&per_page=100",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        stderr = result.stderr.strip() or "unknown gh API failure"
        fail(f"cannot list live rulesets for {repository}: {stderr}")
    try:
        rulesets = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"GitHub returned invalid ruleset JSON: {error}") from error
    if not isinstance(rulesets, list):
        fail("GitHub ruleset listing was not an array")
    return [ruleset for ruleset in rulesets if isinstance(ruleset, dict)]


def fetch_live_ruleset(repository: str, ruleset_id: int) -> dict[str, Any]:
    result = subprocess.run(
        ["gh", "api", f"repos/{repository}/rulesets/{ruleset_id}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        stderr = result.stderr.strip() or "unknown gh API failure"
        fail(f"cannot read live ruleset {ruleset_id}: {stderr}")
    try:
        ruleset = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"GitHub returned invalid live ruleset JSON: {error}"
        ) from error
    if not isinstance(ruleset, dict):
        fail("GitHub ruleset detail was not an object")
    return ruleset


def fetch_repository_metadata(repository: str) -> dict[str, Any]:
    result = subprocess.run(
        ["gh", "api", f"repos/{repository}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        stderr = result.stderr.strip() or "unknown gh API failure"
        fail(f"cannot read repository metadata for {repository}: {stderr}")
    try:
        metadata = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"GitHub returned invalid repository metadata JSON: {error}"
        ) from error
    if not isinstance(metadata, dict):
        fail("GitHub repository metadata was not an object")
    return metadata


def pattern_matches_ref(pattern: str, ref: str, default_branch: str) -> bool:
    if pattern == "~ALL":
        return True
    if pattern == "~DEFAULT_BRANCH":
        return ref == f"refs/heads/{default_branch}"
    return fnmatchcase(ref, pattern)


def ruleset_applies_to_master(ruleset: dict[str, Any], default_branch: str) -> bool:
    conditions = ruleset.get("conditions")
    if conditions is None:
        return True
    if not isinstance(conditions, dict):
        fail("active branch ruleset conditions must be an object")
    ref_name = conditions.get("ref_name")
    if ref_name is None:
        return True
    if not isinstance(ref_name, dict):
        fail("active branch ruleset ref_name conditions must be an object")
    include = ref_name.get("include")
    exclude = ref_name.get("exclude", [])
    if not isinstance(include, list) or not all(
        isinstance(item, str) for item in include
    ):
        fail("active branch ruleset ref_name include conditions must be strings")
    if not isinstance(exclude, list) or not all(
        isinstance(item, str) for item in exclude
    ):
        fail("active branch ruleset ref_name exclude conditions must be strings")

    master_ref = "refs/heads/master"
    return any(
        pattern_matches_ref(pattern, master_ref, default_branch) for pattern in include
    ) and not any(
        pattern_matches_ref(pattern, master_ref, default_branch) for pattern in exclude
    )


def comparable_parameters(rule_type: str, rule: dict[str, Any]) -> Any:
    """Normalize GitHub's omitted disabled/default pull-request properties."""
    parameters = rule.get("parameters")
    if not isinstance(parameters, dict):
        return parameters
    normalized = dict(parameters)
    if rule_type == "pull_request":
        if normalized.get("dismissal_restriction") == {"enabled": False}:
            normalized.pop("dismissal_restriction")
        if normalized.get("required_reviewers") == []:
            normalized.pop("required_reviewers")
    return normalized


def audit_live_ruleset(expected: dict[str, Any], repository: str) -> None:
    repository_metadata = fetch_repository_metadata(repository)
    if repository_metadata.get("default_branch") != "master":
        fail("repository default branch must remain master")

    branch_rulesets: list[dict[str, Any]] = []
    for listed_ruleset in fetch_live_rulesets(repository):
        if listed_ruleset.get("target") != "branch":
            continue
        ruleset_id = listed_ruleset.get("id")
        if not isinstance(ruleset_id, int):
            fail("listed branch ruleset has no numeric id")
        branch_rulesets.append(fetch_live_ruleset(repository, ruleset_id))

    matching = [
        ruleset for ruleset in branch_rulesets if ruleset.get("name") == EXPECTED_NAME
    ]
    if len(matching) != 1:
        fail(f"expected exactly one {EXPECTED_NAME!r} ruleset, found {len(matching)}")
    ruleset_id = matching[0].get("id")
    if not isinstance(ruleset_id, int):
        fail("live ruleset has no numeric id")
    live = fetch_live_ruleset(repository, ruleset_id)

    for field in ("name", "target", "enforcement", "bypass_actors", "conditions"):
        if live.get(field) != expected.get(field):
            fail(f"live ruleset field drifted: {field}")

    expected_rules = rules_by_type(expected)
    live_rules = rules_by_type(live)
    if set(live_rules) != set(expected_rules):
        fail("live ruleset rule types drifted")
    for rule_type, expected_rule in expected_rules.items():
        if comparable_parameters(
            rule_type, live_rules[rule_type]
        ) != comparable_parameters(rule_type, expected_rule):
            fail(f"live ruleset parameters drifted: {rule_type}")

    additional_rulesets = [
        ruleset
        for ruleset in branch_rulesets
        if ruleset.get("id") != ruleset_id
        and ruleset.get("enforcement") == "active"
        and ruleset_applies_to_master(ruleset, "master")
    ]
    if additional_rulesets:
        identifiers = ", ".join(
            str(additional_ruleset.get("id"))
            for additional_ruleset in additional_rulesets
        )
        fail(f"additional active branch rulesets apply to master: {identifiers}")

    print(f"Live GitHub ruleset audit passed for {repository} (ruleset {ruleset_id}).")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config-only",
        action="store_true",
        help="validate the tracked desired-state JSON without calling GitHub",
    )
    parser.add_argument(
        "--repository",
        default=DEFAULT_REPOSITORY,
        help=f"repository to audit (default: {DEFAULT_REPOSITORY})",
    )
    arguments = parser.parse_args()

    try:
        configuration = load_configuration()
        validate_configuration(configuration)
        if arguments.config_only:
            print("GitHub ruleset configuration is valid.")
        else:
            audit_live_ruleset(configuration, arguments.repository)
    except ValueError as error:
        print(f"GitHub ruleset verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
