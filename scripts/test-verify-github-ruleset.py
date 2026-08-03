#!/usr/bin/env python3
"""Focused regressions for GitHub branch-ruleset verification."""

from __future__ import annotations

import importlib.util
import subprocess
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

SCRIPT_PATH = Path(__file__).with_name("verify-github-ruleset.py")
SPECIFICATION = importlib.util.spec_from_file_location(
    "verify_github_ruleset", SCRIPT_PATH
)
if SPECIFICATION is None or SPECIFICATION.loader is None:
    raise RuntimeError("could not load GitHub ruleset verifier")
VERIFIER = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(VERIFIER)


class GitHubRulesetVerifierTest(unittest.TestCase):
    def setUp(self) -> None:
        self.expected = VERIFIER.load_configuration()

    def live_ruleset(self, ruleset_id: int = 1) -> dict[str, object]:
        live = deepcopy(self.expected)
        live["id"] = ruleset_id
        return live

    def audit_with(self, live_rulesets: dict[int, dict[str, object]]) -> None:
        with (
            patch.object(
                VERIFIER,
                "fetch_repository_metadata",
                return_value={"default_branch": "master"},
            ),
            patch.object(
                VERIFIER,
                "fetch_live_rulesets",
                return_value=[
                    {"id": ruleset_id, "target": "branch"}
                    for ruleset_id in live_rulesets
                ],
            ),
            patch.object(
                VERIFIER,
                "fetch_live_ruleset",
                side_effect=lambda _repository, ruleset_id: live_rulesets[ruleset_id],
            ),
        ):
            VERIFIER.audit_live_ruleset(self.expected, "matejkadlec/league-analysis")

    def test_valid_configuration_and_live_ruleset_pass(self) -> None:
        VERIFIER.validate_configuration(self.expected)
        self.audit_with({1: self.live_ruleset()})

    def test_missing_actions_integration_fails_configuration_validation(self) -> None:
        configuration = deepcopy(self.expected)
        checks = configuration["rules"][3]["parameters"]["required_status_checks"]
        checks[0].pop("integration_id")

        with self.assertRaisesRegex(ValueError, "GitHub integration"):
            VERIFIER.validate_configuration(configuration)

    def test_default_branch_drift_fails_before_ruleset_audit(self) -> None:
        with patch.object(
            VERIFIER,
            "fetch_repository_metadata",
            return_value={"default_branch": "main"},
        ):
            with self.assertRaisesRegex(
                ValueError, "default branch must remain master"
            ):
                VERIFIER.audit_live_ruleset(
                    self.expected, "matejkadlec/league-analysis"
                )

    def test_additional_active_ruleset_for_master_fails(self) -> None:
        sibling = {
            "id": 2,
            "name": "Extra master restriction",
            "target": "branch",
            "enforcement": "active",
            "conditions": {
                "ref_name": {
                    "include": ["refs/heads/master"],
                    "exclude": [],
                }
            },
            "rules": [],
        }

        with self.assertRaisesRegex(ValueError, "additional active branch rulesets"):
            self.audit_with({1: self.live_ruleset(), 2: sibling})

    def test_live_check_without_actions_integration_fails_audit(self) -> None:
        live = self.live_ruleset()
        checks = live["rules"][3]["parameters"]["required_status_checks"]
        checks[0].pop("integration_id")

        with self.assertRaisesRegex(ValueError, "parameters drifted"):
            self.audit_with({1: live})

    def test_paginated_ruleset_listing_includes_every_page(self) -> None:
        result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='[{"id": 1}]\n[{"id": 2}]\n',
            stderr="",
        )
        with (
            patch.object(VERIFIER.shutil, "which", return_value="/usr/bin/gh"),
            patch.object(VERIFIER.subprocess, "run", return_value=result) as run,
        ):
            rulesets = VERIFIER.fetch_live_rulesets("matejkadlec/league-analysis")

        self.assertEqual(rulesets, [{"id": 1}, {"id": 2}])
        self.assertIn("--paginate", run.call_args.args[0])

    def test_non_array_ruleset_page_fails_closed(self) -> None:
        result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout='{"id": 1}', stderr=""
        )
        with (
            patch.object(VERIFIER.shutil, "which", return_value="/usr/bin/gh"),
            patch.object(VERIFIER.subprocess, "run", return_value=result),
            self.assertRaisesRegex(ValueError, "listing page was not an array"),
        ):
            VERIFIER.fetch_live_rulesets("matejkadlec/league-analysis")

    def test_single_star_does_not_cross_ref_path_segments(self) -> None:
        self.assertFalse(
            VERIFIER.pattern_matches_ref("refs/*", "refs/heads/master", "master")
        )
        self.assertTrue(
            VERIFIER.pattern_matches_ref("refs/heads/*", "refs/heads/master", "master")
        )
        self.assertTrue(
            VERIFIER.pattern_matches_ref(
                "refs/**/master", "refs/heads/master", "master"
            )
        )

    def test_single_star_exclusion_does_not_hide_master_ruleset(self) -> None:
        ruleset = {
            "conditions": {"ref_name": {"include": ["~ALL"], "exclude": ["refs/*"]}}
        }

        self.assertTrue(VERIFIER.ruleset_applies_to_master(ruleset, "master"))


if __name__ == "__main__":
    unittest.main()
