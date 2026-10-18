import subprocess
import json
import time

def test_codex_full_rpc():
    print("Testing Codex App Server full RPC turn...")
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

    # 1. Initialize
    send({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {"name": "union-bot-probe", "version": "1.0.0"}
        }
    })

    # 2. Config Read
    send({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "config/read",
        "params": {}
    })

    # 3. Model List
    send({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "model/list",
        "params": {}
    })

    # Read lines from stdout
    responses = []
    start_time = time.time()
    while time.time() - start_time < 5:
        line = proc.stdout.readline()
        if not line:
            break
        line = line.strip()
        if line:
            try:
                data = json.loads(line)
                responses.append(data)
                print(f"Received msg ID={data.get('id')} Method={data.get('method')}")
                if len(responses) >= 4:
                    break
            except Exception as e:
                print("Line:", line[:100])

    proc.terminate()
    try:
        proc.wait(timeout=2)
    except:
        proc.kill()

    with open(r"d:\WORK-TEAM\scratch\codex_live_turn_evidence.json", "w", encoding="utf-8") as out:
        json.dump(responses, out, indent=2)

    print(f"Recorded {len(responses)} messages from Codex App Server!")
    for r in responses:
        print("  - Response summary:", str(r)[:160])

if __name__ == "__main__":
    test_codex_full_rpc()
