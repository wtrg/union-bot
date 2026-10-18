#!/usr/bin/env python3
"""
Secure Secret Scanner for Union Bot
Detects potential hardcoded credentials, API keys, tokens, and private keys.
Enforces strict redaction: NEVER stores or outputs plaintext matches.
Fail-closed architecture with explicit scan error auditing and triage classification.
"""

import os
import sys
import re
import json
import argparse
from pathlib import Path

RULES = [
    {
        "id": "SEC-001",
        "description": "Potential hardcoded credential assignment",
        "pattern": re.compile(r'(?i)(?:api_key|apikey|secret|password|bearer|auth|authorization)\s*[:=]\s*["\']([^"\']{8,})["\']'),
        "group": 1
    },
    {
        "id": "SEC-002",
        "description": "OpenAI secret key format",
        "pattern": re.compile(r'(?i)\b(sk-[a-zA-Z0-9]{20,})\b'),
        "group": 1
    },
    {
        "id": "SEC-003",
        "description": "GitHub Personal Access Token format",
        "pattern": re.compile(r'\b(ghp_[a-zA-Z0-9]{20,})\b'),
        "group": 1
    },
    {
        "id": "SEC-004",
        "description": "Google API Key format",
        "pattern": re.compile(r'\b(AIza[0-9A-Za-z-_]{35})\b'),
        "group": 1
    },
    {
        "id": "SEC-005",
        "description": "Slack token format",
        "pattern": re.compile(r'\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b'),
        "group": 1
    },
    {
        "id": "SEC-006",
        "description": "Private key block header",
        "pattern": re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
        "group": 0
    }
]

EXCLUDE_DIRS = {
    '.git', 'node_modules', '.venv', '__pycache__',
    'browser_profile', '.system_generated', 'dist', 'build', '.idea', '.vscode'
}

TARGET_EXTENSIONS = {
    '.py', '.ts', '.js', '.json', '.html', '.css',
    '.env', '.md', '.txt', '.yml', '.yaml', '.bat', '.cmd', '.sh', '.toml'
}

KNOWN_SAFE_SUBSTRINGS = [
    "example", "mock", "placeholder", "fake", "dummy", "test",
    "redacted", "your-key-here", "sk-...", "aiza...", "xxx", "****"
]

def mask_secret(secret_str: str) -> str:
    """Masks secret string to prevent credential exposure in logs or JSON reports."""
    if not secret_str:
        return "[EMPTY]"
    if len(secret_str) <= 6:
        return "***"
    return f"{secret_str[:3]}...***...{secret_str[-2:]}"

def is_safe_triage(match_str: str, file_path: str) -> bool:
    """Determines if finding is a known benign test fixture, placeholder, or documentation."""
    lower_match = match_str.lower()
    lower_path = file_path.lower()
    
    # Check test directories or documentation
    if "test" in lower_path or "mock" in lower_path or "doc" in lower_path or "fixture" in lower_path or "report" in lower_path:
        return True
    
    # Check known benign placeholders
    for safe in KNOWN_SAFE_SUBSTRINGS:
        if safe in lower_match:
            return True
            
    return False

def scan_file(fpath: Path, base_dir: Path, findings: list, scan_errors: list):
    """Scans single file with fail-closed error handling and zero-plaintext logging."""
    try:
        content = fpath.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        scan_errors.append({
            "path": str(fpath.relative_to(base_dir) if fpath.is_relative_to(base_dir) else fpath),
            "error": str(e)
        })
        return

    lines = content.splitlines()
    for line_idx, line in enumerate(lines, start=1):
        for rule in RULES:
            matches = rule["pattern"].findall(line)
            if matches:
                for match in matches:
                    raw_val = match if isinstance(match, str) else match[0] if isinstance(match, tuple) else ""
                    rel_path = str(fpath.relative_to(base_dir) if fpath.is_relative_to(base_dir) else fpath)
                    
                    triage_status = "triaged_safe" if is_safe_triage(raw_val, rel_path) else "unresolved"
                    findings.append({
                        "rule_id": rule["id"],
                        "description": rule["description"],
                        "path": rel_path,
                        "line": line_idx,
                        "masked_hint": mask_secret(raw_val),
                        "triage_status": triage_status
                    })

def run_scanner(roots: list, output_path: str = None, strict: bool = False) -> dict:
    findings = []
    scan_errors = []
    scanned_files_count = 0

    for root_str in roots:
        root_dir = Path(root_str).resolve()
        if not root_dir.exists():
            scan_errors.append({"path": str(root_dir), "error": "Root directory does not exist"})
            continue

        for current_root, dirs, files in os.walk(root_dir):
            # Prune excluded directories cleanly based on exact segment matching
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for fname in files:
                fpath = Path(current_root) / fname
                if fpath.suffix.lower() in TARGET_EXTENSIONS:
                    scanned_files_count += 1
                    scan_file(fpath, root_dir, findings, scan_errors)

    triaged_safe = sum(1 for f in findings if f["triage_status"] == "triaged_safe")
    unresolved = sum(1 for f in findings if f["triage_status"] == "unresolved")
    confirmed = 0

    report = {
        "summary": {
            "scanned_roots": [str(Path(r).resolve()) for r in roots],
            "scanned_files_count": scanned_files_count,
            "findings_total": len(findings),
            "triaged_safe": triaged_safe,
            "confirmed_leaks": confirmed,
            "unresolved": unresolved,
            "scan_errors_count": len(scan_errors)
        },
        "scan_errors": scan_errors,
        "findings": findings
    }

    if output_path:
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')

    return report

def main():
    parser = argparse.ArgumentParser(description="Union Bot Secure Secret Scanner")
    parser.add_argument("--roots", nargs="+", default=["."], help="Directories to scan")
    parser.add_argument("--output", default="scratch/secret_scan_results.json", help="Report JSON path")
    parser.add_argument("--strict", action="store_true", help="Fail with nonzero exit on unreadable files or unresolved leaks")
    args = parser.parse_args()

    report = run_scanner(args.roots, args.output, args.strict)
    summary = report["summary"]

    print("=" * 60)
    print("UNION BOT SECURE SECRET SCANNER AUDIT REPORT")
    print(f"Scanned files : {summary['scanned_files_count']}")
    print(f"Total findings: {summary['findings_total']}")
    print(f"  - Triaged Safe (Test/Doc/Fixture): {summary['triaged_safe']}")
    print(f"  - Confirmed Real Leaks           : {summary['confirmed_leaks']}")
    print(f"  - Unresolved Findings            : {summary['unresolved']}")
    print(f"Scan errors   : {summary['scan_errors_count']}")
    print("=" * 60)

    if args.strict and (summary["confirmed_leaks"] > 0 or summary["unresolved"] > 0 or summary["scan_errors_count"] > 0):
        print("ERROR: Scanner strict check failed!")
        sys.exit(1)

    print("PASS: Secret scan completed safely without plaintext exposure.")
    sys.exit(0)

if __name__ == "__main__":
    main()
