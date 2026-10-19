# Review Packet: Phase P3 Gate Review (Round R05 Addendum)
**Project:** Union Bot (0đ Zero-Cost Desktop AI Workspace on Windows 11)  
**Date:** 2026-10-19  
**Gate:** Phase P3 Gate (Desktop UI & Multi-Agent Workspace Integration) — Round R05 Addendum  
**Roles:** Implementation Lead (Antigravity), Verification Lead (Codex), Technical Leader (ChatGPT Web)  
**Status:** **SUBMITTED FOR FINAL GATE REVIEW APPROVAL — TARGET: `APPROVED — GO_P4`**

---

## 1. Executive Summary & Verification Metrics

Following the Technical Leader's formal gate review in `UNION_BOT_P3_R04_FORMAL_GATE_REVIEW.md`, all required remediations were explicitly narrowed to **2 Final Blockers** (`UB-P3-R04-G01` and `UB-P3-R04-G02`). Both blockers have now been completely resolved, verified in real Windows 11 Electron Chromium subprocesses, and backed by authentic SQLite WAL and CAS store evidence on disk.

| Metric | Verification Result | Status |
| :--- | :--- | :--- |
| **Monorepo TypeScript Typecheck** | `tsc --noEmit` monorepo & `apps/workspace-ui` (0 errors) | **PASS (100%)** |
| **Workspace UI Production Bundle** | Vite v5.4.21 bundle built cleanly (`dist/assets/index-BLsgZXAF.js`) | **PASS (100%)** |
| **TypeScript / Node Unit & Integration Tests** | 157 tests across 27 suites (including all P2, P3, R03-R07 suites) | **PASS (157/157)** |
| **Python Unit Tests** | 16 tests in `tests/test_*.py` | **PASS (16/16)** |
| **Real Windows Electron Chromium E2E** | 11 tests across 5 real subprocess suites (P3, R07, R06, R05, R04) | **PASS (11/11)** |
| **Total Automated Tests** | **184 automated tests** (157 TS + 16 Py + 11 Real Electron E2E) | **PASS (184/184)** |
| **Automated GUI Smoke Test** | Real window, anti-spoofing, single instance, zero-cost egress | **PASS (100%)** |
| **Strict Secret Scan Audit** | 798 files scanned, 0 unresolved, 0 leaks (`python scan_secrets.py --strict`) | **PASS (0 Leaks)** |
| **Durability Across App Restart** | SQLite rooms, envelopes, attachments, CAS fidelity, export files | **PASS (P3-C03)** |
| **Zero-Cost Egress Invariant** | $0.00 egress, 0 paid APIs, 0 cloud endpoints | **PASS (0đ)** |

---

## 2. Resolution of Technical Leader Blockers

### Blocker 1: `UB-P3-R04-G01` (Severity: S1) — ActionIntent Payload Strict Enforcement

- **Requirement:** ActionIntent payload is strictly required for both token creation and token approval. If missing, null, or empty string, fail-closed (`ERR_PAYLOAD_MISMATCH`). Checked on Native, Worker, and IPC before native human confirmation is prompted.
- **Root Cause Addressed:** In legacy Phase P2 code, `payload_json` was optional in SQLite and callers could create tokens by supplying only a precomputed `payloadDigest`.
- **Implementation:**
  1. **Storage Engine (`packages/storage/src/approval-gate.ts`):**
     - `createApprovalToken`: Checks that `payload` or non-empty `payload_json` is present. Throws `ERR_PAYLOAD_MISMATCH: ActionIntent payload or payload_json is required to create an approval token (UB-P3-R04-G01)`.
     - `approveToken`: Checks that stored `payload_json` exists and is non-empty. Computes digest and enforces match against `payload_digest`. Throws `ERR_PAYLOAD_MISMATCH: Stored ActionIntent payload is missing or unparseable. Approval strictly denied fail-closed (UB-P3-R04-G01)`.
  2. **Electron Storage Worker (`apps/desktop/src/storage-worker.cjs`):**
     - Enforces payload validation on `createApprovalToken` and `approveToken`. Throws `ERR_PAYLOAD_MISMATCH` if missing or unparseable.
  3. **Electron Main IPC Handlers (`apps/desktop/src/main.js`):**
     - In `union-bot:create-approval-token`: Rejects requests missing payload with `ERR_PAYLOAD_MISMATCH`.
     - In `union-bot:approve-token`: Inspects token record before native confirmation dialog or auto-approval delegate; rejects immediately fail-closed with `ERR_PAYLOAD_MISMATCH` if payload is missing.
  4. **Test Suite Modernization:**
     - Updated legacy tests across `r04_approval_security.test.ts`, `r05_approval_atomic_idempotency.test.ts`, `r06_security_hardening.test.ts`, `r07_security_hardening.test.ts`, and Electron E2E harnesses (R05-H05, R05-H07, R06-B03, R06-B01, R07-A01) to pass genuine semantic `ActionIntent` payloads.
  5. **Verification Evidence:**
     - `p3Result.g01CreationMissingPayloadBlocked === true`
     - `evidence.regressionVectors['UB-P3-R04-G01'].creationMissingPayloadBlocked === true`

---

### Blocker 2: `UB-P3-R04-G02` (Severity: S1) — Attachment & Export Lifecycle Completeness

- **Requirement:** 
  1. Eliminate `local_...` fallback fake SHA generation in `ChatRoom.tsx`; report error banner and preserve draft on CAS save failure.
  2. Drive PNG & PDF attachments via composer attach button in live Electron E2E.
  3. Verify pending attachment chips rendered in DOM.
  4. Verify authentic files written to CAS store on disk with authentic SHA-256 hashes.
  5. Verify real JSON & Markdown export files written to disk.
  6. Verify durability of SQLite room history, envelopes, CAS attachment bytes (byte-for-byte fidelity), and export files across real app restart (`--p3-reopen-e2e`).
- **Implementation:**
  1. **UI Layer (`apps/workspace-ui/src/components/ChatRoom.tsx`):**
     - Completely removed fake SHA generation (`local_${Date.now()}_...`).
     - Added `attachmentError` state and `[data-testid="chat-attachment-error"]` error banner.
     - Preserves draft message in `inputText` and textarea upon attachment failure.
     - Multi-line composer with `[data-testid="chat-composer-attach-btn"]`, `[data-testid="pending-attachment-chip"]`, and `[data-testid="chat-composer-send-btn"]`.
  2. **File Dialog IPC (`apps/desktop/src/main.js`):**
     - Handler `union-bot:open-file-dialog`: Reads selected file from filesystem, computes authentic SHA-256, writes to `userData/cas-store/<sha256>`, and returns authentic attachment metadata.
     - Dedicated test harness support: `union-bot:test-queue-attachment-path` queues test fixtures for headless automated execution without blocking native OS modals.
  3. **Workspace Export IPC (`apps/desktop/src/main.js`):**
     - Handler `union-bot:export-workspace`: Writes `workspace_export.json` and `workspace_export.md` to `app.getPath('userData')/exports/`.
     - Handler `union-bot:test-get-export-files`: Verifies export files exist on disk, are non-empty, and contain valid JSON and Markdown content.
  4. **Live Electron Subprocess E2E (`apps/desktop/src/main.js` & `tests/e2e/desktop-p3.test.js`):**
     - Step 3a: Queues non-existent file path -> clicks `attachBtn` -> asserts `g02AttachmentErrorBannerShown === true` and draft in textarea preserved (`g02DraftPreservedOnError === true`).
     - Step 3b: Queues authentic PNG fixture -> clicks `attachBtn`; queues authentic PDF fixture -> clicks `attachBtn` -> asserts `g02BothChipsRendered === true` in DOM.
     - Step 4: Types multi-line message into textarea -> clicks `composerSendBtn` -> asserts message sent via DOM.
     - Step 5: Queries SQLite room history -> retrieves authentic SHA-256 hashes:
       - PNG: `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0`
       - PDF: `9ce0d7fd8b15d3de88f1acfb49e0b61540a6be10a62f519c243d9cd4fd9db4e1`
       - Reads back bytes from CAS store -> verifies authentic byte length (`casFilesWritten === true`).
     - Step 8: Triggers workspace export -> asserts `exportFilesOnDiskValid === true` (`workspace_export.json` and `workspace_export.md` present and non-empty on disk).
  5. **Durable Reopen Verification (`--p3-reopen-e2e`):**
     - Electron closes cleanly and relaunches against the identical `testUserDataDir`.
     - Verifies:
       - Room survived restart (`roomFound: true`)
       - Project survived restart (`projectFound: true`)
       - Tasks survived restart (`taskFound: true`)
       - Room envelopes survived restart (`historyFound: true`)
       - CAS attachments survived restart (`hasAttachments: true`)
       - Byte-for-byte CAS fidelity verified for both PNG & PDF (`bothAttachmentsFidelityVerified: true`)
       - ActionIntent payload survived restart (`actionIntentSurvived: true`)
       - Real export files survived restart on disk (`exportFilesSurvived: true`)
       - Real UI DOM rendered (`uiOperational: true`)

---

## 3. Evidence Artifact: `ELECTRON_P3_E2E_EVIDENCE.json`

```json
{
  "timestamp": "2026-10-19T11:53:35.532Z",
  "environment": "Real Windows Electron Chromium E2E (Phase P3 Gate R04)",
  "nodeEnv": "test",
  "regressionVectors": {
    "UB-P3-R04-G01": {
      "creationMissingPayloadBlocked": true
    },
    "UB-P3-R04-G02": {
      "attachmentErrorBannerShown": true,
      "draftPreservedOnError": true,
      "bothChipsRendered": true,
      "casFilesWritten": true,
      "exportFilesOnDiskValid": true
    },
    "P3-R04-F01": {
      "creationMismatchBlocked": true
    },
    "P3-R04-F02": {
      "approveTamperBlocked": true
    },
    "P3-R04-F03": {
      "approveBtnDisabledOnMismatch": true
    },
    "P3-R04-F05": {
      "projectFormCreatedInDom": true,
      "chatMessageSentViaDom": true,
      "exportTriggeredViaDom": true
    }
  },
  "results": {
    "roomCreated": true,
    "roomInList": true,
    "g02DraftPreservedOnError": true,
    "g02AttachmentErrorBannerShown": true,
    "g02PngAttachedViaButton": true,
    "g02PdfAttachedViaButton": true,
    "g02BothChipsRendered": true,
    "pngSaved": true,
    "pdfSaved": true,
    "envelopeDispatched": true,
    "historyFound": true,
    "casFilesWritten": true,
    "g01CreationMissingPayloadBlocked": true,
    "f01CreationMismatchBlocked": true,
    "tokenCreated": true,
    "tokenInList": true,
    "actionIntentPreserved": true,
    "f02ApproveTamperBlocked": true,
    "hasApprovalCards": true,
    "hasVerifiedBadge": true,
    "hasMismatchBadge": true,
    "f03ApproveBtnDisabledOnMismatch": true,
    "tokenRejected": true,
    "pathTraversalBlocked": true,
    "invalidShaBlocked": true,
    "f05ProjectFormCreatedInDom": true,
    "projectCreated": true,
    "projectInList": true,
    "f05ChatMessageSentViaDom": true,
    "hasChatRendered": true,
    "tamperedApprovalBlocked": true,
    "taskCreated": true,
    "taskInList": true,
    "hasTasksRendered": true,
    "f05ExportTriggeredViaDom": true,
    "exportSucceeded": true,
    "exportFilesOnDiskValid": true,
    "pngSha256": "6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0",
    "pdfSha256": "9ce0d7fd8b15d3de88f1acfb49e0b61540a6be10a62f519c243d9cd4fd9db4e1"
  },
  "allPassed": true
}
```

---

## 4. Verification Suite Execution Log (`scripts/verify.ps1`)

```
========================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE (PHASE P3 GATE)
========================================================

--- 1. Strict TypeScript Typecheck across Monorepo ---
> tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json
(Clean: 0 errors)

--- 2. Building Workspace UI Production Bundle ---
> vite build
✓ 40 modules transformed.
dist/index.html                   0.72 kB │ gzip:  0.44 kB
dist/assets/index-DAqw_zWq.css    5.80 kB │ gzip:  1.64 kB
dist/assets/index-BLsgZXAF.js   210.77 kB │ gzip: 62.18 kB
✓ built in 552ms

--- 3. Running TypeScript & Node Unit/Integration Tests ---
ℹ tests 157
ℹ suites 27
ℹ pass 157
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 1945.295

--- 4. Running Python Unit Tests (16 tests) ---
Ran 16 tests in 1.060s
OK

--- 5. Running Real Windows Electron E2E Tests (R04, R05, R06, R07, and P3) ---
▶ Union Bot Phase P3 Gate: Windows Real Electron E2E Suite
  ✔ P3-E2E: Real Electron live dynamic room, PNG/PDF attachments, approval inbox, and export (PASS)
  ✔ P3-REOPEN-E2E: Real Electron close & reopen verifies SQLite & CAS attachment durability (P3-C03) (PASS)
✔ Union Bot Phase P3 Gate: Windows Real Electron E2E Suite (10408ms)
▶ Union Bot P2-R04 Desktop Windows E2E Suite
  ✔ R04-G07: Real Electron startup with storage failure shows recovery screen and strictly blocks mutation IPC
  ✔ R04-G08: Real Electron kill/relaunch maintains exactly-once durable state, replay ACK, and changed rejection
  ✔ R04-G11: Actual Electron IPC frame boundary permits only trusted main frame and strictly denies rogue windows/frames
✔ Union Bot P2-R04 Desktop Windows E2E Suite (8999ms)
▶ Union Bot Phase P2 Gate R05: Windows Electron Real E2E Suite (H05, H07, H08)
  ✔ R05-H05: Hard kill after approved action commit -> restart -> identical replay ACKs without ALREADY_CONSUMED, zero duplicate events/outbox
  ✔ R05-H07: Full production IPC approval flow matches digests (preview===approved===consumed===recorded), blocks post-preview tamper
  ✔ R05-H08: Storage worker runtime termination triggers STORAGE_ERROR_BLOCKED and strictly blocks mutation IPC fail-closed
✔ Union Bot Phase P2 Gate R05: Windows Electron Real E2E Suite (7685ms)
▶ Union Bot Phase P2 Gate R06: Windows Real Electron E2E Suite
  ✔ R06 Real Electron E2E: Validates R06-B01, R06-B03, and R06-B06 in live Electron Chromium instance
✔ Union Bot Phase P2 Gate R06: Windows Real Electron E2E Suite (1074ms)
▶ Union Bot Phase P2 Gate R07: Windows Real Electron E2E Suite
  ✔ R07-A01: Real Electron live human confirmation, digest matching, and atomic consumption
  ✔ R07-A03: Real Electron production configuration strictly denies test mutation channels (C03)
✔ Union Bot Phase P2 Gate R07: Windows Real Electron E2E Suite (3945ms)
ℹ tests 11
ℹ suites 5
ℹ pass 11
ℹ fail 0

--- 6. Running Electron Automated GUI Smoke Test ---
[SmokeTest] CostGuard egress check (paid API blocked): true
[SmokeTest] SafeExternal dangerous scheme blocked: true
[SmokeTest] Single instance lock held: true
[SmokeTest] Orchestrator zero-cost admission passed: true
[SmokeTest] Real GUI IPC send message verified: true
[SmokeTest] Real GUI IPC get room history verified: true
[SmokeTest] Renderer anti-spoofing enforcement verified: true
[SmokeTest] Smoke test PASS! All assertions verified cleanly.

--- 7. Running Strict Secret & Security Audit ---
Scanned files : 798
Total findings: 11
  - Triaged Safe (Explicit Allowlist): 11
  - Confirmed Real Leaks              : 0
  - Unresolved Findings               : 0
PASS: Secret scan completed safely without plaintext exposure.

========================================================
ALL VERIFICATION CHECKS PASSED (Typecheck + Build + 184 Tests [157 TS + 16 Py + 11 Real Electron E2E] + GUI Smoke + Strict Secret Scan)
========================================================
```

---

## 5. Formal Gate Verdict Request

With `UB-P3-R04-G01` and `UB-P3-R04-G02` completely resolved, strictly verified across both native, worker, and IPC layers, and confirmed durable across real application restarts:

The Implementation Lead (Antigravity) and Verification Lead (Codex) respectfully request the Technical Leader on ChatGPT Web to issue the formal gate decision:
# **`APPROVED — GO_P4`**
