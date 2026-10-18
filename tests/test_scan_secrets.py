import os
import sys
import tempfile
import unittest
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scan_secrets import run_scanner, mask_secret, is_allowlisted_fixture

class TestSecretScanner(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.dir_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_mask_secret(self):
        self.assertEqual(mask_secret(""), "[EMPTY]")
        self.assertEqual(mask_secret("123"), "***")
        masked = mask_secret("sk-1234567890abcdefghijklmnop")
        self.assertTrue(masked.startswith("sk-"))
        self.assertTrue(masked.endswith("op"))
        self.assertIn("...***...", masked)
        # Verify plaintext is NEVER exposed entirely
        self.assertNotIn("abcdefghijkl", masked)

    def test_detect_positive_and_negative(self):
        # 1. Clean file
        clean_file = self.dir_path / "clean.py"
        clean_file.write_text("def hello():\n    return 'world'\n", encoding="utf-8")

        # 2. Secret file
        secret_file = self.dir_path / "secret.py"
        secret_file.write_text("api_key = 'abcdef1234567890'\n", encoding="utf-8")

        report = run_scanner([str(self.dir_path)])
        summary = report["summary"]

        self.assertEqual(summary["scanned_files_count"], 2)
        self.assertGreaterEqual(summary["findings_total"], 1)

        # Assert no plaintext in findings
        for f in report["findings"]:
            self.assertNotIn("abcdef1234567890", f["masked_hint"])
            self.assertIn("...", f["masked_hint"])

    def test_no_autosafe_by_folder_name_marks_unresolved(self):
        """
        UB-P1-SEC-002: A credential format found in a folder named 'tests' or 'docs'
        must NOT be automatically marked safe. It must be UNRESOLVED.
        """
        test_subfolder = self.dir_path / "tests"
        test_subfolder.mkdir()
        fake_test_key = test_subfolder / "live_key.txt"
        fake_test_key.write_text("sk-" + "unallowlistedSecretKey1234567890abcdef\n", encoding="utf-8")

        report = run_scanner([str(self.dir_path)], strict=False)
        summary = report["summary"]

        self.assertEqual(summary["findings_total"], 1)
        self.assertEqual(summary["unresolved"], 1, "Must be UNRESOLVED despite being in tests/ folder")
        self.assertEqual(summary["triaged_safe"], 0)

    def test_scans_dot_env_files(self):
        """
        UB-P1-SEC-002: .env.local, .env.production must be scanned regardless of extension parsing.
        """
        env_file = self.dir_path / ".env.local"
        env_file.write_text("OPENAI_API_KEY = 'sk-1234567890abcdefghijklmnop'\n", encoding="utf-8")

        report = run_scanner([str(self.dir_path)])
        summary = report["summary"]

        self.assertEqual(summary["scanned_files_count"], 1)
        self.assertGreaterEqual(summary["findings_total"], 1)
        self.assertGreaterEqual(summary["unresolved"], 1)

    def test_strict_mode_fails_on_unresolved(self):
        """
        UB-P1-SEC-002: In strict mode, unresolved findings cause strict failure.
        """
        secret_file = self.dir_path / "unresolved.py"
        secret_file.write_text("secret_token = 'abcdef1234567890'\n", encoding="utf-8")

        report = run_scanner([str(self.dir_path)], strict=True)
        self.assertGreater(report["summary"]["unresolved"], 0)

    def test_allowlisted_fixture_is_triaged_safe(self):
        """
        UB-P1-SEC-002: Only explicitly allowlisted fixtures are marked triaged_safe.
        """
        self.assertTrue(is_allowlisted_fixture("tests/test_scan_secrets.py", "SEC-001"))
        self.assertTrue(is_allowlisted_fixture("reports/audit/SECRET_SCAN_REPORT.md", "SEC-006"))
        self.assertFalse(is_allowlisted_fixture("tests/some_random_test.py", "SEC-001"))

    def test_nonexistent_root_recorded_as_error(self):
        bad_path = self.dir_path / "does_not_exist"
        report = run_scanner([str(bad_path)], strict=False)
        summary = report["summary"]
        self.assertEqual(summary["scan_errors_count"], 1)
        self.assertEqual(report["scan_errors"][0]["error"], "Root directory does not exist")

    def test_allowlisted_fixture_digest_verification(self):
        """
        UB-P1-SEC-S1: Modifying the secret value inside an allowlisted file path
        must fail digest verification and remain UNRESOLVED.
        """
        # Exact benign fixture match -> True
        self.assertTrue(
            is_allowlisted_fixture(
                "tests/test_scan_secrets.py",
                "SEC-002",
                "sk-1234567890abcdefghijklmnop"
            )
        )
        # Modified / attacker-injected key in the same file -> False (UNRESOLVED)
        self.assertFalse(
            is_allowlisted_fixture(
                "tests/test_scan_secrets.py",
                "SEC-002",
                "sk-" + "rogueInjectedKeyNotOnAllowlist1234567890"
            )
        )

if __name__ == "__main__":
    unittest.main()
