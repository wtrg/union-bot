import unittest
import json
import io
import time
from unittest.mock import MagicMock
from test_codex_full_rpc import execute_codex_rpc_turn, scrub_rpc_data

class MockProcess:
    def __init__(self, responses, hang=False):
        self.responses = responses
        self.hang = hang
        self.current_idx = 0
        self.stdin = io.StringIO()
        self.stderr = io.StringIO()
        self.returncode = 0

    @property
    def stdout(self):
        return self

    def readline(self):
        if self.current_idx < len(self.responses):
            line = self.responses[self.current_idx]
            self.current_idx += 1
            return line + "\n"
        if self.hang:
            time.sleep(2)
            return ""
        return ""

    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        pass

    def kill(self):
        pass

class TestCodexHarness(unittest.TestCase):
    def test_synthetic_pass(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}}),
            json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/started", "params": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "item/agentMessage/delta", "params": {"delta": "UNION_BOT_CODEX_TURN_VERIFIED"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/completed", "params": {"turnId": "turn_456", "turn": {"id": "turn_456", "status": "completed"}}})
        ]
        proc = MockProcess(responses)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=5)
        self.assertTrue(res["success"])
        self.assertEqual(res["thread_id"], "th_123")
        self.assertEqual(res["turn_id"], "turn_456")
        self.assertEqual(res["terminal_status"], "completed")

    def test_synthetic_wrong_turn_id(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}}),
            json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/started", "params": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "item/agentMessage/delta", "params": {"delta": "UNION_BOT_CODEX_TURN_VERIFIED"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/completed", "params": {"turnId": "WRONG_TURN_789", "turn": {"id": "WRONG_TURN_789", "status": "completed"}}})
        ]
        proc = MockProcess(responses)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=5)
        self.assertFalse(res["success"])
        self.assertIn("Turn ID mismatch", res["reason"])

    def test_synthetic_missing_text(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}}),
            json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/started", "params": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "item/agentMessage/delta", "params": {"delta": "Something random without verification token"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/completed", "params": {"turnId": "turn_456", "turn": {"id": "turn_456", "status": "completed"}}})
        ]
        proc = MockProcess(responses)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=5)
        self.assertFalse(res["success"])
        self.assertIn("did not contain expected verification string", res["reason"])

    def test_synthetic_cancelled_status(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}}),
            json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/started", "params": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/completed", "params": {"turnId": "turn_456", "turn": {"id": "turn_456", "status": "cancelled"}}})
        ]
        proc = MockProcess(responses)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=5)
        self.assertFalse(res["success"])
        self.assertIn("non-completed status", res["reason"])

    def test_synthetic_missing_terminal_status_fails(self):
        """
        UB-P1-SEC-004: If turn/completed message lacks an explicit status field,
        it must NOT default to completed. It must FAIL.
        """
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}}),
            json.dumps({"jsonrpc": "2.0", "id": 3, "result": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/started", "params": {"turnId": "turn_456"}}),
            json.dumps({"jsonrpc": "2.0", "method": "item/agentMessage/delta", "params": {"delta": "UNION_BOT_CODEX_TURN_VERIFIED"}}),
            json.dumps({"jsonrpc": "2.0", "method": "turn/completed", "params": {"turnId": "turn_456", "turn": {"id": "turn_456"}}})
        ]
        proc = MockProcess(responses)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=5)
        self.assertFalse(res["success"])
        self.assertIn("non-completed status: None", res["reason"])

    def test_synthetic_scrub_rpc_data(self):
        """
        UB-P1-SEC-004: Verifies recursive scrubbing of tokens, passwords, and sensitive keys.
        """
        raw_msg = {
            "method": "turn/started",
            "params": {
                "user": "developer@example.com",
                "auth_token": "secret_session_token_12345",
                "apiKey": "sk-1234567890abcdefghijklmnop",
                "nested": {
                    "password": "super_secret_password",
                    "info": "Contact developer@example.com with Bearer eyJhbGciOiJIUzI1NiJ9"
                }
            }
        }
        scrubbed = scrub_rpc_data(raw_msg)
        self.assertEqual(scrubbed["params"]["auth_token"], "[REDACTED]")
        self.assertEqual(scrubbed["params"]["apiKey"], "[REDACTED]")
        self.assertEqual(scrubbed["params"]["nested"]["password"], "[REDACTED]")
        self.assertIn("[REDACTED_EMAIL]", scrubbed["params"]["user"])
        self.assertIn("[REDACTED_TOKEN]", scrubbed["params"]["nested"]["info"])

    def test_synthetic_timeout(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}})
        ]
        proc = MockProcess(responses, hang=True)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=1.0)
        self.assertFalse(res["success"])
        self.assertIn("Timeout", res["reason"])

if __name__ == "__main__":
    unittest.main()
