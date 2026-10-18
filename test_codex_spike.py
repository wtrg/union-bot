import subprocess
import json
import time
import sys

def test_codex_app_server():
    print("Testing Codex App Server stdio handshake...")
    cmd = ["codex", "app-server", "--stdio"]
    # On Windows npm creates codex.cmd or codex.ps1
    # Let's locate the exact executable
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True
        )
    except Exception as e:
        print(f"Failed to spawn codex: {e}")
        return False

    # Send a JSON-RPC request
    req = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "union-bot-probe",
                "version": "1.0.0"
            }
        }
    }
    
    try:
        req_line = json.dumps(req) + "\n"
        proc.stdin.write(req_line)
        proc.stdin.flush()
        
        # Read response with timeout
        print("Waiting for response from codex app-server...")
        time.sleep(2)
        proc.terminate()
        stdout, stderr = proc.communicate(timeout=5)
        print(f"Codex stdout:\n{stdout[:500]}")
        print(f"Codex stderr:\n{stderr[:500]}")
        return True
    except Exception as e:
        print(f"Error communicating with codex: {e}")
        try:
            proc.kill()
        except:
            pass
        return False

if __name__ == "__main__":
    test_codex_app_server()
