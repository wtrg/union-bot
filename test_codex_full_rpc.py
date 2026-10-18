import subprocess
import json
import time
import sys

def test_codex_full_rpc():
    print("=== Testing Codex App Server Real Turn Execution (thread/start & turn/start) ===")
    proc = subprocess.Popen(
        ["codex", "app-server", "--stdio"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        shell=True
    )

    def send(msg):
        line = json.dumps(msg) + "\n"
        proc.stdin.write(line)
        proc.stdin.flush()

    messages_received = []
    thread_id = None
    turn_completed = False
    agent_text = ""

    # 1. Initialize
    print("1. Sending initialize...")
    send({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {"name": "union-bot-agent", "version": "1.0.0"}
        }
    })

    start_time = time.time()
    turn_started = False

    while time.time() - start_time < 45:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            messages_received.append(data)
            
            # Response to initialize
            if data.get("id") == 1 and "result" in data:
                print("   Initialized successfully!")
                # 2. Start Thread
                print("2. Sending thread/start...")
                send({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "thread/start",
                    "params": {}
                })

            # Response to thread/start
            elif data.get("id") == 2 and "result" in data:
                result = data["result"]
                thread_id = result.get("threadId") or result.get("id") or (result.get("thread", {}).get("id"))
                print(f"   Thread started successfully with ID: {thread_id}")

                # 3. Start Turn
                print("3. Sending turn/start with test prompt...")
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

            # Notifications
            method = data.get("method")
            if method:
                params = data.get("params", {})
                if method == "turn/started":
                    turn_started = True
                    print(f"   Notification: turn/started (Turn ID: {params.get('turnId')})")
                elif method == "item/agentMessage/delta":
                    delta = params.get("delta", "")
                    agent_text += delta
                elif method == "item/completed":
                    item = params.get("item", {})
                    print(f"   Notification: item/completed (type: {item.get('type')})")
                elif method == "turn/completed":
                    turn_completed = True
                    print(f"   Notification: turn/completed (Turn ID: {params.get('turnId')})")
                    break

        except Exception as e:
            print("Error parsing line:", line[:100], e)

    proc.terminate()
    try:
        proc.wait(timeout=3)
    except:
        proc.kill()

    # Save evidence
    with open(r"d:\WORK-TEAM\scratch\codex_live_turn_evidence.json", "w", encoding="utf-8") as out:
        json.dump(messages_received, out, indent=2)

    print(f"\nTotal messages received: {len(messages_received)}")
    print(f"Turn started: {turn_started}")
    print(f"Turn completed: {turn_completed}")
    print(f"Agent response text: '{agent_text.strip()}'")

    if turn_completed:
        print("=== TEST RESULT: PASS (Full Turn Execution Verified) ===")
        return True
    else:
        print("=== TEST RESULT: INCOMPLETE TURN ===")
        return False

if __name__ == "__main__":
    success = test_codex_full_rpc()
    sys.exit(0 if success else 1)
