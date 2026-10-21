#!/usr/bin/env python3
"""
Secure Secret Scanner for Union Bot (Phase P1 / UB-P1-SEC-002)
Detects potential hardcoded credentials, API keys, tokens, and private keys.
Enforces strict redaction: NEVER stores or outputs plaintext matches.
Strict Triage Architecture:
- NO directory or substring based auto-safe triage.
- Every match defaults to UNRESOLVED unless explicitly allowlisted in BENIGN_FIXTURE_ALLOWLIST.
- In --strict mode, any UNRESOLVED finding or scan error exits nonzero.
- Scans .env.*, .npmrc, *.pem, *.key, and all source/config files.
"""

import os
import sys
import re
import json
import argparse
import hashlib
from pathlib import Path

RULES = [
    {
        "id": "SEC-001",
        "description": "Potential hardcoded credential assignment",
        "pattern": re.compile(r'(?i)(?:api_key|apikey|secret|password|bearer|auth|authorization)[\w_-]*\s*[:=]\s*["\']([^"\']{8,})["\']'),
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
    '.env', '.md', '.txt', '.yml', '.yaml', '.bat', '.cmd', '.sh', '.toml',
    '.pem', '.key', '.cert'
}

TARGET_FILENAMES = {
    '.npmrc', '.yarnrc', 'credentials.json', 'token.json', 'session.json'
}

# Explicit, vetted benign fixtures allowlist (UB-P1-SEC-002)
# No finding is marked safe unless it exactly matches an entry below.
BENIGN_FIXTURE_ALLOWLIST = [
    {
        "path_suffix": "tests/test_scan_secrets.py",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "840881e18cbe400765483cf840dfbbd39aa6304e39fb84a70b8e79ead298cc15",
            "b4108cde217de62eda8d832e8054396f78b207d41008840634a4a7024909cb76"
        ],
        "reason": "Scanner unit test synthetic credential fixture"
    },
    {
        "path_suffix": "tests/test_scan_secrets.py",
        "rule_id": "SEC-002",
        "expected_match_sha256": [
            "b4108cde217de62eda8d832e8054396f78b207d41008840634a4a7024909cb76"
        ],
        "reason": "Scanner unit test synthetic OpenAI key fixture"
    },
    {
        "path_suffix": "tests/test_codex_harness.py",
        "rule_id": "SEC-002",
        "expected_match_sha256": [
            "b4108cde217de62eda8d832e8054396f78b207d41008840634a4a7024909cb76"
        ],
        "reason": "Codex harness unit test synthetic redaction fixture"
    },
    {
        "path_suffix": "reports/audit/SECRET_SCAN_REPORT.md",
        "rule_id": "SEC-006",
        "expected_match_sha256": [
            "03d104c669e3c7b6be7f989db8b12c8b910d3be8c1e2a73c9369d3cc0ba803b5"
        ],
        "reason": "Audit report table documenting legacy sample header"
    },
    {
        "path_suffix": "packages/protocol/tests/protocol.test.ts",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "e1585a8b92753b31cad9eb5bc523b69475a5a5413e3b67ab39fe647471bb9381"
        ],
        "reason": "Protocol unit test authStatus enum value fixture"
    },
    {
        "path_suffix": "reports/audit/REVIEW_FIX_PLAN_P2_R01.md",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "e1585a8b92753b31cad9eb5bc523b69475a5a5413e3b67ab39fe647471bb9381"
        ],
        "reason": "Leader audit fix plan documentation quoting legacy authStatus enum"
    },
    {
        "path_suffix": "packages/browser-manager/src/types.ts",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "7b15b57dc77e666d18dc97ee7a52750c0b42764232c6f74925fd3bef97a4b8d7"
        ],
        "reason": "Phase P4 browser manager AuthStatus type definition"
    },
    {
        "path_suffix": "apps/workspace-ui/src/types.ts",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "7b15b57dc77e666d18dc97ee7a52750c0b42764232c6f74925fd3bef97a4b8d7"
        ],
        "reason": "Phase P4 workspace UI AuthStatus type definition"
    },
    {
        "path_suffix": "packages/agent-antigravity/src/antigravity-discovery.ts",
        "rule_id": "SEC-001",
        "expected_match_sha256": [
            "a9c81fde910d08552b292ad7d7c8f118af0302387e287732567cca6cd89f10e7"
        ],
        "reason": "Phase P7 Antigravity discovery authStatus FREE_LOCAL enum value"
    },
    {
        "path_suffix": "tests/v4/unit/u09_browser_bridge.test.ts",
        "rule_id": "SEC-004",
        "expected_match_sha256": [
            "78a2951f11c241c0c40b0f6709615caaf6c08e1c6e0d16edf6e87d7c8f22d564"
        ],
        "reason": "Phase V4 U09 browser bridge unit test synthetic Google API key fixture"
    },
    {
        "path_suffix": "tests/v4/unit/u09_browser_bridge.test.ts",
        "rule_id": "SEC-003",
        "expected_match_sha256": [
            "1db61e13c133f7d98ceeae9ad1f8c83e06a420fcdc53111b2646078187f1657f"
        ],
        "reason": "Phase V4 U09 browser bridge unit test synthetic GitHub PAT fixture"
    }
]

def mask_secret(secret_str: str) -> str:
    """Masks secret string to prevent credential exposure in logs or JSON reports."""
    if not secret_str:
        return "[EMPTY]"
    if len(secret_str) <= 6:
        return "***"
    return f"{secret_str[:3]}...***...{secret_str[-2:]}"

def is_allowlisted_fixture(file_path: str, rule_id: str, raw_val: str = "") -> bool:
    """
    Checks if a finding exactly matches an entry in the strict BENIGN_FIXTURE_ALLOWLIST.
    Strictly forbids auto-safe triage based on folder names or arbitrary substring matches.
    UB-P1-SEC-S1: Verifies content SHA256 of the matched secret string against expected digest.
    EVERY allowlisted entry MUST declare non-empty expected_match_sha256 digests.
    When raw_val is provided, its SHA256 MUST match the pinned expected digest.
    """
    normalized_path = file_path.replace('\\', '/')

    for item in BENIGN_FIXTURE_ALLOWLIST:
        if normalized_path.endswith(item["path_suffix"]) and item["rule_id"] == rule_id:
            expected_hashes = item.get("expected_match_sha256")
            if not expected_hashes:
                # Disallow any fixture without pinned expected digests
                return False
            if not raw_val:
                # Metadata check mode: verify entry is registered with valid expected digests
                return True
            match_hash = hashlib.sha256(raw_val.encode('utf-8')).hexdigest()
            if isinstance(expected_hashes, str):
                return match_hash == expected_hashes
            elif isinstance(expected_hashes, (list, set, tuple)):
                return match_hash in expected_hashes
            return False
    return False

def should_scan_file(fpath: Path) -> bool:
    """Determines whether a file should be scanned based on extension or special filename."""
    fname = fpath.name.lower()
    suffix = fpath.suffix.lower()

    # Support .env.* files (.env, .env.local, .env.production, etc.)
    if fname.startswith('.env'):
        return True

    # Support exact sensitive configuration filenames
    if fname in TARGET_FILENAMES:
        return True

    # Support target extensions
    if suffix in TARGET_EXTENSIONS:
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

                    # Default to UNRESOLVED unless explicitly allowlisted with exact content digest
                    triage_status = "triaged_safe" if is_allowlisted_fixture(rel_path, rule["id"], raw_val) else "unresolved"
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
                if should_scan_file(fpath):
                    scanned_files_count += 1
                    scan_file(fpath, root_dir, findings, scan_errors)

    triaged_safe = sum(1 for f in findings if f["triage_status"] == "triaged_safe")
    unresolved = sum(1 for f in findings if f["triage_status"] == "unresolved")
    confirmed_leaks = 0  # Confirmed leaks require manual escalation and revocation

    summary = {
        "scanned_roots": [str(Path(r).resolve()) for r in roots],
        "scanned_files_count": scanned_files_count,
        "findings_total": len(findings),
        "triaged_safe": triaged_safe,
        "confirmed_leaks": confirmed_leaks,
        "unresolved": unresolved,
        "scan_errors_count": len(scan_errors)
    }

    result = {
        "summary": summary,
        "scan_errors": scan_errors,
        "findings": findings
    }

    if output_path:
        out_p = Path(output_path).resolve()
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(result, indent=2), encoding='utf-8')

    print("=" * 60)
    print("UNION BOT SECURE SECRET SCANNER AUDIT REPORT")
    print(f"Scanned files : {scanned_files_count}")
    print(f"Total findings: {len(findings)}")
    print(f"  - Triaged Safe (Explicit Allowlist): {triaged_safe}")
    print(f"  - Confirmed Real Leaks              : {confirmed_leaks}")
    print(f"  - Unresolved Findings               : {unresolved}")
    print(f"Scan errors   : {len(scan_errors)}")
    print("=" * 60)

    # In strict mode, any unresolved findings or scan errors trigger failure
    if strict and (unresolved > 0 or len(scan_errors) > 0 or confirmed_leaks > 0):
        print("ERROR: Scanner strict check failed! Unresolved findings or scan errors exist.")
        return result

    print("PASS: Secret scan completed safely without plaintext exposure.")
    return result

def main():
    parser = argparse.ArgumentParser(description="Union Bot Secure Secret Scanner")
    parser.add_argument("--roots", nargs="+", default=["."], help="Directories to scan")
    parser.add_argument("--output", default="scratch/secret_scan_results.json", help="Path to write JSON results")
    parser.add_argument("--strict", action="store_true", help="Fail with nonzero exit code if unresolved findings or errors exist")

    args = parser.parse_args()
    report = run_scanner(roots=args.roots, output_path=args.output, strict=args.strict)

    if args.strict:
        has_failures = (
            report["summary"]["unresolved"] > 0 or
            report["summary"]["scan_errors_count"] > 0 or
            report["summary"]["confirmed_leaks"] > 0
        )
        if has_failures:
            sys.exit(1)

    sys.exit(0)

if __name__ == "__main__":
    main()
