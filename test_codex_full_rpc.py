#!/usr/bin/env python3
"""
Full RPC Turn Execution Test for Codex App Server (Phase P1 / UB-P1-SEC-004)
Hardened security & execution architecture:
- Direct argv execution (shell=False) with verified binary path via shutil.which().
- Background daemon thread drains stderr safely to prevent pipe deadlock.
- Uses time.monotonic() for robust watchdog timeouts.
- Strict schema-aware redaction: scrubs tokens, auth headers, emails, and sensitive keys from saved evidence.
- Strict terminal status check: NEVER defaults to 'completed' if status field is missing.
- Exact content assertion: verifies correlated threadId, turnId, and 'UNION_BOT_CODEX_TURN_VERIFIED'.
"""

import subprocess
import shutil
import json
import time
import sys
import queue
import threading
import re
from pathlib import Path

def reader_worker(pipe, q):
    """Background thread to read lines from pipe without blocking main thread."""
    try:
        for line in iter(pipe.readline, ''):
            if line:
                q.put(line)
            else:
                break
    except Exception:
        pass
    finally:
        q.put(None)

def stderr_drain_worker(pipe, err_buffer, max_lines=100):
    """Background thread to drain stderr safely to prevent pipe deadlock."""
    try:
        for line in iter(pipe.readline, ''):
            if line and len(err_buffer) < max_lines:
                err_buffer.append(line.strip())
    except Exception:
        pass

def redact_sensitive_string(text: str) -> str:
    """Masks tokens, emails, and credentials from log messages."""
    if not isinstance(text, str):
        return text
    # Redact email addresses
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[REDACTED_EMAIL]', text)
    # Redact common key formats (OpenAI, GitHub, Google, Slack, Bearer)
    text = re.sub(r'(?i)\b(?:sk-[a-zA-Z0-9]{15,}|ghp_[a-zA-Z0-9]{15,}|AIza[0-9A-Za-z-_]{30,}|xox[baprs]-[0-9a-zA-Z]{10,48})\b', '[REDACTED_KEY]', text)
    text = re.sub(r'(?i)bearer\s+[a-zA-Z0-9_\-\.]{15,}', 'Bearer [REDACTED_TOKEN]', text)
    return text

def scrub_rpc_data(data):
    """Recursively scrubs JSON-RPC data structures for safe evidence storage."""
    if isinstance(data, dict):
        scrubbed = {}
        for k, v in data.items():
            k_lower = k.lower()
            if any(term in k_lower for term in ('token', 'key', 'auth', 'password', 'secret', 'cookie', 'authorization', 'bearer')):
                scrubbed[k] = '[REDACTED]'
            else:
                scrubbed[k] = scrub_rpc_data(v)
        return scrubbed
    elif isinstance(data, list):
        return [scrub_rpc_data(item) for item in data]
    elif isinstance(data, str):
        return redact_sensitive_string(data)
    return data

def execute_codex_rpc_turn(mock_process=None, timeout_seconds=45):
    """
    Executes a complete multi-turn handshake with Codex App Server.
    Can accept a mock_process for unit testing.
    """
    proc = mock_process
    stderr_lines = []

    if proc is None:
        codex_bin = shutil.which("codex")
        if not codex_bin:
            return {
                "success": False,
                "reason": "Codex executable not found on PATH",
                "thread_id": None,
                "turn_id": None,
                "terminal_status": None,
                "agent_text": "",
                "messages_count": 0,
                "messages": []
            }

        # Safe direct execution (shell=False)
        proc = subprocess.Popen(
            [codex_bin, "app-server", "--stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=False
        )

    out_queue = queue.Queue()
    reader_thread = threading.Thread(target=reader_worker, args=(proc.stdout, out_queue), daemon=True)
    reader_thread.start()

    if proc.stderr:
        stderr_thread = threading.Thread(target=stderr_drain_worker, args=(proc.stderr, stderr_lines), daemon=True)
        stderr_thread.start()

    def send(msg):
        line = json.dumps(msg) + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()

    messages_received = []
    thread_id = None
    expected_turn_id = None
    turn_started_received = False
    turn_completed_received = False
    terminal_status = None
    agent_text = ""
    error_reason = None

    start_time = time.monotonic()

    try:
        # Step 1: Initialize handshake
        send({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {"name": "union-bot-test", "version": "1.0.0"},
                "capabilities": {}
            }
        })

        while time.monotonic() - start_time < timeout_seconds:
            try:
                line = out_queue.get(timeout=0.5)
            except queue.Empty:
                continue

            if line is None:
                # Stream closed
                break

            line_str = line.strip()
            if not line_str:
                continue

            try:
                msg = json.loads(line_str)
            except Exception as e:
                error_reason = f"Malformed JSON from server: {e}"
                break

            messages_received.append(msg)

            # Route by message ID or notification method
            msg_id = msg.get("id")
            method = msg.get("method")
            params = msg.get("params", {})

            # 1. Handle initialize response (ID 1)
            if msg_id == 1:
                send({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "thread/start",
                    "params": {}
                })

            # 2. Handle thread/start response (ID 2)
            elif msg_id == 2:
                result = msg.get("result", {})
                thread_id = result.get("threadId") or result.get("id") or (result.get("thread", {}).get("id"))
                if not thread_id:
                    error_reason = "No threadId returned from thread/start response"
                    break

                # Send turn/start with exact prompt
                send({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "turn/start",
                    "params": {
                        "threadId": thread_id,
                        "input": [
                            {"type": "text", "text": "Please reply with exactly: UNION_BOT_CODEX_TURN_VERIFIED"}
                        ]
                    }
                })

            # 3. Handle turn/start response (ID 3)
            elif msg_id == 3:
                result = msg.get("result", {})
                expected_turn_id = result.get("turnId") or result.get("id") or (result.get("turn", {}).get("id"))

            # 4. Handle notifications from server
            elif method:
                if method in ("turn/started", "turn/start"):
                    turn_started_received = True
                    if not expected_turn_id:
                        expected_turn_id = params.get("turnId") or params.get("turn", {}).get("id")

                elif method == "item/agentMessage/delta":
                    delta = params.get("delta", "")
                    agent_text += delta

                elif method == "turn/completed":
                    turn_completed_received = True
                    turn_obj = params.get("turn", {})
                    completed_turn_id = params.get("turnId") or turn_obj.get("id")
                    
                    # Strict terminal status check: NEVER default to 'completed' if field is absent
                    terminal_status = turn_obj.get("status") if "status" in turn_obj else params.get("status")

                    # Verify turnId correlation
                    if expected_turn_id and completed_turn_id != expected_turn_id:
                        error_reason = f"Turn ID mismatch: expected {expected_turn_id}, got {completed_turn_id}"
                        break

                    # Verify threadId correlation
                    completed_thread_id = params.get("threadId") or turn_obj.get("threadId")
                    if thread_id and completed_thread_id and completed_thread_id != thread_id:
                        error_reason = f"Thread ID mismatch: expected {thread_id}, got {completed_thread_id}"
                        break

                    # Check terminal status strictly
                    if terminal_status != "completed":
                        error_reason = f"Turn finished with non-completed status: {terminal_status}"
                        break

                    # Stop loop upon verified completion
                    break

    finally:
        # Clean process shutdown
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()

    # Final Verification Assertions
    is_pass = False
    if error_reason:
        final_reason = error_reason
    elif not thread_id:
        final_reason = "No valid thread ID established"
    elif not turn_completed_received:
        final_reason = "Timeout or stream ended before turn/completed received"
    elif terminal_status != "completed":
        final_reason = f"Turn terminal status is '{terminal_status}', expected 'completed'"
    elif "UNION_BOT_CODEX_TURN_VERIFIED" not in agent_text:
        final_reason = f"Agent response did not contain expected verification string: '{agent_text.strip()}'"
    else:
        is_pass = True
        final_reason = "Correlated turn execution verified with exact text assertion"

    return {
        "success": is_pass,
        "reason": final_reason,
        "thread_id": thread_id,
        "turn_id": expected_turn_id,
        "terminal_status": terminal_status,
        "agent_text": agent_text.strip(),
        "messages_count": len(messages_received),
        "messages": messages_received,
        "stderr_lines": stderr_lines
    }

def main():
    print("=== Testing Codex App Server Real Turn Execution (Strict Correlated RPC - UB-P1-SEC-004) ===")
    res = execute_codex_rpc_turn(timeout_seconds=45)

    # Apply strict schema-aware scrubbing before saving evidence
    scrubbed_messages = [scrub_rpc_data(msg) for msg in res["messages"]]

    out_path = Path("scratch/codex_live_turn_evidence.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(scrubbed_messages, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Total messages received : {res['messages_count']}")
    print(f"Thread ID               : {res['thread_id']}")
    print(f"Turn ID                 : {res['turn_id']}")
    print(f"Terminal Status         : {res['terminal_status']}")
    print(f"Agent Text              : '{res['agent_text']}'")
    print(f"Verdict Reason          : {res['reason']}")

    if res["success"]:
        print("=== TEST RESULT: PASS (Correlated Full Turn Verified) ===")
        sys.exit(0)
    else:
        print("=== TEST RESULT: FAIL ===")
        sys.exit(1)

if __name__ == "__main__":
    main()
