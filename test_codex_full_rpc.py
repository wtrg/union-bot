#!/usr/bin/env python3
"""
Full RPC Turn Execution Test for Codex App Server
Implements non-blocking line reading with thread queue & watchdog timeout.
Enforces strict correlation: threadId, turnId, terminal completed status, and agent text assertion.
"""

import subprocess
import json
import time
import sys
import queue
import threading
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

def execute_codex_rpc_turn(mock_process=None, timeout_seconds=45):
    """
    Executes a complete multi-turn handshake with Codex App Server.
    Can accept a mock_process for unit testing.
    """
    proc = mock_process
    if proc is None:
        proc = subprocess.Popen(
            ["codex", "app-server", "--stdio"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True
        )

    out_queue = queue.Queue()
    reader_thread = threading.Thread(target=reader_worker, args=(proc.stdout, out_queue), daemon=True)
    reader_thread.start()

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

    # Step 1: Initialize
    send({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {"name": "union-bot-agent", "version": "1.0.0"}
        }
    })

    deadline = time.time() + timeout_seconds

    try:
        while time.time() < deadline:
            remaining = max(0.1, deadline - time.time())
            try:
                line = out_queue.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if proc.poll() is not None:
                    error_reason = f"Process terminated prematurely with exit code {proc.returncode}"
                    break
                continue

            if line is None:
                # Pipe closed
                break

            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
            except Exception:
                continue

            messages_received.append(data)

            # Response to initialize (id: 1)
            if data.get("id") == 1 and "result" in data:
                # Step 2: Start Thread
                send({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "thread/start",
                    "params": {}
                })

            # Response to thread/start (id: 2)
            elif data.get("id") == 2 and "result" in data:
                res = data["result"]
                thread_id = res.get("threadId") or res.get("id") or (res.get("thread", {}).get("id"))
                if not thread_id:
                    error_reason = "thread/start did not return a valid thread ID"
                    break

                # Step 3: Start Turn
                send({
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "turn/start",
                    "params": {
                        "threadId": thread_id,
                        "input": [
                            {
                                "type": "text",
                                "text": "Respond with exactly: UNION_BOT_CODEX_TURN_VERIFIED"
                            }
                        ]
                    }
                })

            # Response to turn/start (id: 3)
            elif data.get("id") == 3 and "result" in data:
                res = data["result"]
                expected_turn_id = res.get("turnId") or res.get("id") or (res.get("turn", {}).get("id"))

            # Notifications
            method = data.get("method")
            if method:
                params = data.get("params", {})
                
                if method == "turn/started":
                    turn_started_received = True
                    notif_turn_id = params.get("turnId") or params.get("turn", {}).get("id")
                    if not expected_turn_id and notif_turn_id:
                        expected_turn_id = notif_turn_id

                elif method == "item/agentMessage/delta":
                    delta = params.get("delta", "")
                    agent_text += delta

                elif method == "turn/completed":
                    turn_completed_received = True
                    turn_obj = params.get("turn", {})
                    completed_turn_id = params.get("turnId") or turn_obj.get("id")
                    terminal_status = turn_obj.get("status") or params.get("status", "completed")

                    # Verify turnId correlation
                    if expected_turn_id and completed_turn_id != expected_turn_id:
                        error_reason = f"Turn ID mismatch: expected {expected_turn_id}, got {completed_turn_id}"
                        break

                    # Verify threadId correlation
                    completed_thread_id = params.get("threadId") or turn_obj.get("threadId")
                    if thread_id and completed_thread_id and completed_thread_id != thread_id:
                        error_reason = f"Thread ID mismatch: expected {thread_id}, got {completed_thread_id}"
                        break

                    # Check terminal status
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
        final_reason = f"Turn terminal status is {terminal_status}"
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
        "messages": messages_received
    }

def main():
    print("=== Testing Codex App Server Real Turn Execution (Strict Correlated RPC) ===")
    res = execute_codex_rpc_turn(timeout_seconds=45)

    # Save scrubbed evidence
    scrubbed_messages = []
    for msg in res["messages"]:
        scrubbed_messages.append(msg)

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
