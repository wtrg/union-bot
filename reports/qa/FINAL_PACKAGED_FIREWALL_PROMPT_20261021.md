# Packaged UI attachment probe blocked — 2026-10-21

After reopening retained QA portable copy outside repo, Windows Security firewall consent appeared: allow public/private networks to access Electron. No Allow, Cancel or settings interaction performed by Codex, no firewall rule changed. Computer Use UI testing stopped at the security prompt, respecting no system changes and Computer Use security-app prohibition.

No file was attached or task dispatched in this probe. Read-only TCP listener check filtered to exact QA-copy process IDs returned no listening endpoints at inspection; source search found no createServer/listen call. Do not claim a proven inbound server vulnerability or root cause; Chromium/network/Windows first-run behavior remains to diagnose. Scope: c405f21 normal non-smoke UI; smoke starts differently (browser init disabled).

Requested QA cleanup only targeted executable paths strictly under unique retained QA-copy root C:/Users/Lenovo/AppData/Local/Temp/union-bot-codex-portable-2CyJXJ. No unrelated Electron/Antigravity/browser process targeted. Preserve profile and logs. UAT attachment check is BLOCKED_PERMISSION here, not PASS; original plan normal first-run/manual fallback must be evaluated honestly.
