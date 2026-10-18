import unittest
import json
import io
import time
from unittest.mock import MagicMock
from test_codex_full_rpc import execute_codex_rpc_turn

class MockProcess:
    def __init__(self, responses, hang=False):
        self.responses = responses
        self.hang = hang
        self.current_idx = 0
        self.stdin = io.StringIO()
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

    def test_synthetic_timeout(self):
        responses = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"serverInfo": {"name": "codex"}}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"threadId": "th_123"}})
            # Missing turn/start and turn/completed, then hangs
        ]
        proc = MockProcess(responses, hang=True)
        res = execute_codex_rpc_turn(mock_process=proc, timeout_seconds=1.0)
        self.assertFalse(res["success"])
        self.assertIn("Timeout", res["reason"])

if __name__ == "__main__":
    unittest.main()
