import os
import re

PATTERNS = [
    (r'(?i)(?:api_key|apikey|secret|password|token|bearer|auth|authorization)\s*[:=]\s*["\']([^"\']{8,})["\']', "Potential hardcoded credential"),
    (r'(?i)sk-[a-zA-Z0-9]{20,}', "OpenAI secret key"),
    (r'(?i)ghp_[a-zA-Z0-9]{20,}', "GitHub Personal Access Token"),
    (r'(?i)AIza[0-9A-Za-z-_]{35}', "Google API Key"),
    (r'(?i)xox[baprs]-[0-9a-zA-Z]{10,48}', "Slack token"),
    (r'(?i)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', "Private key block"),
]

findings = []

def scan_file(fpath):
    try:
        with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = f.readlines()
        for idx, line in enumerate(lines):
            # check patterns
            for pat, desc in PATTERNS:
                matches = re.findall(pat, line)
                if matches:
                    findings.append({
                        "file": fpath,
                        "line": idx + 1,
                        "description": desc,
                        "preview": line.strip()[:100]
                    })
    except Exception as e:
        pass

scan_roots = [
    r'D:\muti_chat_bot_package',
    r'D:\WORK-TEAM'
]

scanned_files_count = 0

for root_path in scan_roots:
    for root, dirs, files in os.walk(root_path):
        if any(skip in root for skip in ['.git', 'node_modules', '.venv', '__pycache__', 'browser_profile', '.system_generated', 'dist']):
            continue
        for f in files:
            if f.endswith(('.py', '.ts', '.js', '.json', '.html', '.css', '.env', '.md', '.txt', '.yml', '.yaml', '.bat', '.cmd', '.sh')):
                scanned_files_count += 1
                scan_file(os.path.join(root, f))

print(f"Scanned {scanned_files_count} files across both D:\\muti_chat_bot_package and D:\\WORK-TEAM.")
print(f"Total findings: {len(findings)}")

# Save report
report_data = {
    "scanned_roots": scan_roots,
    "scanned_files_count": scanned_files_count,
    "total_findings": len(findings),
    "findings": findings
}

import json
with open(r'd:\WORK-TEAM\scratch\secret_scan_results.json', 'w', encoding='utf-8') as rf:
    json.dump(report_data, rf, indent=2)

print("Saved secret scan results to scratch/secret_scan_results.json.")
