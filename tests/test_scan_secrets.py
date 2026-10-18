import os
import sys
import tempfile
import unittest
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scan_secrets import run_scanner, mask_secret

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

        # 2. Secret file (fake test token)
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

    def test_safe_triage_for_documentation_and_test(self):
        test_file = self.dir_path / "test_example.py"
        test_file.write_text("OPENAI_KEY = 'sk-mock1234567890abcdefghijklmnop'\n", encoding="utf-8")

        report = run_scanner([str(self.dir_path)])
        summary = report["summary"]
        self.assertEqual(summary["triaged_safe"], 1)
        self.assertEqual(summary["confirmed_leaks"], 0)

    def test_nonexistent_root_recorded_as_error(self):
        bad_path = self.dir_path / "does_not_exist"
        report = run_scanner([str(bad_path)])
        summary = report["summary"]
        self.assertEqual(summary["scan_errors_count"], 1)
        self.assertEqual(report["scan_errors"][0]["error"], "Root directory does not exist")

if __name__ == "__main__":
    unittest.main()
