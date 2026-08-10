#!/usr/bin/env python3
"""Network-free dependency audit policy tests."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("dependency-audit.py")
SPEC = importlib.util.spec_from_file_location("dependency_audit", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
dependency_audit = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = dependency_audit
SPEC.loader.exec_module(dependency_audit)

AuditError = dependency_audit.AuditError
Finding = dependency_audit.Finding
compare_findings = dependency_audit.compare_findings
npm_audit_manifest = dependency_audit.npm_audit_manifest
parse_npm_audit = dependency_audit.parse_npm_audit
parse_pip_audit = dependency_audit.parse_pip_audit


class DependencyAuditPolicyTests(unittest.TestCase):
    def test_inherited_finding_does_not_block_unrelated_change(self) -> None:
        finding = Finding("npm", "next", "GHSA-inherited")
        comparison = compare_findings({finding}, {finding}, False)
        self.assertFalse(comparison.blocks)
        self.assertEqual(comparison.inherited, (finding,))

    def test_new_finding_or_production_change_blocks(self) -> None:
        inherited = Finding("python", "fastapi", "CVE-inherited")
        new = Finding("python", "httpx", "CVE-new")
        self.assertTrue(compare_findings({inherited}, {inherited, new}, False).blocks)
        self.assertTrue(compare_findings({inherited}, {inherited}, True).blocks)

    def test_resolved_finding_does_not_block(self) -> None:
        finding = Finding("npm", "axios", "GHSA-resolved")
        self.assertFalse(compare_findings({finding}, set(), True).blocks)

    def test_npm_audit_manifest_omits_development_engine_gate(self) -> None:
        manifest = {
            "dependencies": {"next": "16.3.0"},
            "devEngines": {"runtime": {"name": "node", "version": "26.5.1"}},
        }
        self.assertEqual(
            npm_audit_manifest(manifest), {"dependencies": {"next": "16.3.0"}}
        )

    def test_npm_parser_keeps_only_high_and_critical_advisories(self) -> None:
        data = {
            "vulnerabilities": {
                "next": {
                    "severity": "high",
                    "via": [{"url": "https://example.invalid/GHSA-next"}],
                },
                "other": {"severity": "moderate", "via": ["transitive"]},
            }
        }
        self.assertEqual(
            parse_npm_audit(data),
            {Finding("npm", "next", "https://example.invalid/GHSA-next")},
        )
        with self.assertRaises(AuditError):
            parse_npm_audit({"error": {"summary": "offline"}})

    def test_pip_parser_normalizes_vulnerability_ids(self) -> None:
        data = {
            "dependencies": [
                {"name": "fastapi", "vulns": [{"id": "CVE-TEST"}]},
                {"name": "safe", "vulns": []},
            ]
        }
        self.assertEqual(
            parse_pip_audit(data),
            {Finding("python", "fastapi", "CVE-TEST")},
        )


if __name__ == "__main__":
    unittest.main()
