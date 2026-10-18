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

for root, dirs, files in os.walk(r'D:\muti_chat_bot_package'):
    if '.venv' in root or '__pycache__' in root or '.git' in root or 'browser_profile' in root:
        continue
    for f in files:
        if f.endswith(('.py', '.js', '.json', '.html', '.css', '.env', '.md', '.txt', '.yml', '.yaml', '.bat', '.cmd', '.sh')):
            scan_file(os.path.join(root, f))

print(f"Total findings: {len(findings)}")
for item in findings[:20]:
    rel = os.path.relpath(item['file'], r'D:\muti_chat_bot_package')
    print(f"[{item['line']}] {rel}: {item['description']}")
    print(f"   Preview: {item['preview']}")
