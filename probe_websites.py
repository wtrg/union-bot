import urllib.request
import ssl
import time
import json

TARGETS = [
    {"name": "ChatGPT Web", "url": "https://chatgpt.com", "origin": "https://chatgpt.com"},
    {"name": "Google Gemini Web", "url": "https://gemini.google.com", "origin": "https://gemini.google.com"},
    {"name": "Claude Web", "url": "https://claude.ai", "origin": "https://claude.ai"},
    {"name": "DeepSeek Web", "url": "https://chat.deepseek.com", "origin": "https://chat.deepseek.com"}
]

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

results = []

for t in TARGETS:
    req = urllib.request.Request(
        t["url"],
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"}
    )
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            elapsed = time.time() - start
            results.append({
                "provider": t["name"],
                "origin": t["origin"],
                "status_code": resp.status,
                "elapsed_seconds": round(elapsed, 3),
                "server": resp.headers.get("server", "unknown"),
                "content_type": resp.headers.get("content-type", "unknown"),
                "cf_ray": resp.headers.get("cf-ray", "none"),
                "status": "REACHABLE",
                "recommended_mode": "EMBEDDED_WEBCONTENTSVIEW_MANUAL_SHARE",
                "error": None
            })
    except urllib.error.HTTPError as e:
        elapsed = time.time() - start
        results.append({
            "provider": t["name"],
            "origin": t["origin"],
            "status_code": e.code,
            "elapsed_seconds": round(elapsed, 3),
            "server": e.headers.get("server", "unknown"),
            "content_type": e.headers.get("content-type", "unknown"),
            "cf_ray": e.headers.get("cf-ray", "none"),
            "status": "CHALLENGE_OR_AUTH" if e.code in (403, 401) else "HTTP_ERROR",
            "recommended_mode": "EMBEDDED_WEBCONTENTSVIEW_MANUAL_SHARE",
            "error": str(e)
        })
    except Exception as ex:
        elapsed = time.time() - start
        results.append({
            "provider": t["name"],
            "origin": t["origin"],
            "status_code": 0,
            "elapsed_seconds": round(elapsed, 3),
            "status": "CONNECTION_FAILED",
            "recommended_mode": "SYSTEM_BROWSER_FALLBACK",
            "error": str(ex)
        })

print(json.dumps(results, indent=2))
with open(r"d:\WORK-TEAM\scratch\browser_probe_results.json", "w", encoding="utf-8") as f:
    json.dump(results, f, indent=2)
