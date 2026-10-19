# Union Bot Phase P5 Round R02 Review Packet: Artifact Store, Previews & Local MCP
**Target Gate:** Phase P5 Round R02 Sign-off (`APPROVED — GO_P6`)  
**Previous Verdict:** `CHANGES_REQUIRED — GO_P6_NOT_YET — P6_NON_EXECUTING_SCAFFOLD_ALLOWED` (Technical Leader Review, 2026-10-19)  
**Submission Commit:** `05df2c953fb44955375fc4c9bb4a9191a92e1053`  
**Auditor / Technical Leader:** ChatGPT Web ("Ý tưởng AI Workspace")  
**Implementer:** Antigravity Agent  
**Environment:** Windows 11 Electron Desktop (Node 24, SQLite WAL, Chromium WebContentsView)  
**Cost Guard Policy:** $0.00 / 0đ Zero-Cost Enforcement Active  

---

## 1. Executive Summary

In response to the Technical Leader's S1 audit verdict on Round R01, all 5 remediation vectors (**UB-P5-R01-001** through **UB-P5-R01-005**) have been completely resolved, integrated into production IPC handlers, and validated across both unit tests and Windows Real Electron E2E subprocesses.

Zero regressions were introduced: the entire verification pipeline (`verify.ps1`) executed with **exit code 0** across all 204 monorepo tests, 13 real Windows Electron E2E suites, GUI smoke test, and strict secret scan.

---

## 2. Remediation Details for The 5 Vectors

| Finding Code | Vector ID | Severity | Root Cause in R01 | Production Remediation in Round R02 | Verification Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UB-P5-R01-001** | **P5-R02-T01** | S1 — Data Integrity | Production `save-attachment` wrote directly to disk without routing through CAS `ArtifactStore.storeBytes` or enforcing size limits. | Production `union-bot:save-attachment` and `union-bot:open-file-dialog` now route directly through `artifactStore.storeBytes(buffer, ...)`, sniff MIME via magic bytes (`detectMimeType`), enforce 50MB hard limit (`ERR_FILE_TOO_LARGE`), and populate both `byteSize` and `sizeBytes` for full protocol schema compliance. | `apps/desktop/tests/desktop.test.js` (P5-R02-T01: 50MB rejected, bucketed path created); `ELECTRON_P5_E2E_EVIDENCE.json` (`r02_largeFileRejected: true`). |
| **UB-P5-R01-002** | **P5-R02-T02** | S1 — Sandbox / Security | `ToolHost.resolveSafePath` checked string prefix only, allowing symlink/junction breakout; `runSafeTest` ran unapproved scripts. | Hardened `ToolHost.resolveSafePath` with `fs.realpathSync` validation to ensure canonical target path does not escape workspace; capped file reads at 5MB (`ABSOLUTE_MAX_READ_BYTES`); hardened `runSafeTest` to block unapproved script execution fail-closed with `ERR_APPROVAL_REQUIRED`. | `apps/desktop/tests/desktop.test.js` (P5-R02-T02: traversal denied, script rejected); `ELECTRON_P5_E2E_EVIDENCE.json` (`r02_unapprovedScriptBlocked: true`, `toolHostTraversalDenied: true`). |
| **UB-P5-R01-003** | **P5-R02-T03** | S1 — Data Integrity | `export-transcript-bundle` concatenated `roomId` without regex validation and read history from in-memory cache rather than durable SQLite. | Strictly validated `roomId` format (`/^[a-zA-Z0-9_-]+$/`), rejecting traversal payloads (`../../escape`) fail-closed with `ERR_INVALID_ROOM_ID`. Ensured `bundleDir` is contained in `exportsDir`. Replaced in-memory read with durable SQLite history fetch via `storage.getRoomEnvelopes(cleanRoomId)` with fallback to `orchestrator.getRoomHistoryAsync(cleanRoomId)`. | `apps/desktop/tests/desktop.test.js` (P5-R02-T03: traversal blocked); `ELECTRON_P5_E2E_EVIDENCE.json` (`r02_maliciousRoomExportBlocked: true`, `exportBundleSucceeded: true`). |
| **UB-P5-R01-004** | **P5-R02-T04** | S1 — Preview Security | `sanitizeSvg` was unit-tested but not wired into production attachment ingestion or preview pipeline. | Integrated `sanitizeSvg` on production path inside `save-attachment` and `open-file-dialog` before writing into CAS. Tested in real Electron that malicious SVG `<script>` tags, inline event handlers (`onload=`, `onclick=`), and `javascript:` URLs are completely stripped before storage and preview. | `apps/desktop/tests/desktop.test.js` (P5-R02-T04: all scripts stripped); `ELECTRON_P5_E2E_EVIDENCE.json` (`r02_svgSanitized: true`). |
| **UB-P5-R01-005** | **P5-R02-T05** | S1 — Functional / CAS | `MCPService.artifact_inspect` checked flat `<cas>/<sha>` instead of bucketed `<cas>/<prefix>/<sha>`. | Hardened `MCPService.artifact_inspect` to check bucketed path `<cas>/<prefix>/<sha>` first, with fallback to legacy flat layout, with strict path traversal verification against escaping CAS store boundary. Returned both `byteSize` and `sizeBytes`. | `apps/desktop/tests/desktop.test.js` (P5-R02-T05: bucketed & flat verified); `ELECTRON_P5_E2E_EVIDENCE.json` (`r02_mcpInspectBucketed: true`). |

---

## 3. Comprehensive Verification Matrix

```text
========================================================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE — PHASE P5 ROUND R02
========================================================================================
1. Monorepo TypeScript & Project Typecheck : PASS (0 errors across 6 workspaces)
2. Workspace UI Production Bundle (Vite)   : PASS (dist/index.html, 0.72 kB gzip: 0.44 kB)
3. Monorepo Unit & Integration Test Suites : PASS (185 TS tests + 16 Python tests)
4. Desktop Security & Unit Suite (P5-R02)  : PASS (14/14 tests pass, including T01..T05)
5. Windows Real Electron Subprocess E2E    : PASS (13 suites, 13 passed, 0 failed):
   - P3 Gate Live Dynamic Room & Attachments : PASS (22.6s)
   - P3-C03 Close & Reopen SQLite/CAS       : PASS (15.3s)
   - P4 Embedded Browser Isolation & Bounds  : PASS (16.5s)
   - P5 CAS, Previews, ToolHost & Local MCP  : PASS (25.5s)
   - P2-R04 Storage Error Recovery Smoke     : PASS (5.4s)
   - P2-R04 Durable Kill / Relaunch          : PASS (7.1s)
   - P2-R04 Frame Boundary Isolation         : PASS (4.9s)
   - P2-R05 Hard Kill & Identical Replay     : PASS (14.1s)
   - P2-R05 Production Approval IPC Flow     : PASS (7.5s)
   - P2-R05 Worker Termination Recovery      : PASS (7.9s)
   - P2-R06 Human Confirmation & Multi-action: PASS (5.1s)
   - P2-R07 Live Human Confirmation & Digest : PASS (5.6s)
   - P2-R07 Production Test Channel Denial   : PASS (4.5s)
6. Electron Automated GUI Smoke Test       : PASS (CostGuard 0đ, SafeExternal, single instance)
7. Strict Secret & Credential Scanner      : PASS (827 files scanned, 0 real leaks)
========================================================================================
OVERALL STATUS: ALL GATES PASS (Exit Code 0)
========================================================================================
```

---

## 4. Key Evidence Files

- `reports/capability-evidence/ELECTRON_P5_E2E_EVIDENCE.json`
- `reports/capability-evidence/ELECTRON_P3_E2E_EVIDENCE.json`
- `reports/capability-evidence/ELECTRON_P4_E2E_EVIDENCE.json`
- `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`
- `reports/audit/UNION_BOT_P5_R01_LEADER_VERDICT.md`

---

## 5. Recommendation & Request for Sign-off

All 5 S1 findings from Round R01 have been cleanly resolved and verified on Windows 11 with concrete negative tests and zero regressions.

We formally request the Technical Leader's sign-off:
**`APPROVED — GO_P6`**
To officially close Phase P5 and proceed to **Phase P6: Native AI Agent Integration & Orchestration**.
