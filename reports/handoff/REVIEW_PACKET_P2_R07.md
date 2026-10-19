# Union Bot — Phase P2 Round R07 Comprehensive Review Packet
**Zero-Cost 0đ Desktop AI Workspace (Windows 11, Electron, React, SQLite WAL)**

- **Date:** 2026-10-19
- **Round:** Phase P2 Round R07 (Formal Gate Sign-Off)
- **Implementation Lead:** Antigravity (Advanced Agentic Coding)
- **QA & Verification Lead:** Codex (Verification Lead)
- **Independent Reviewer / Technical Lead:** ChatGPT Web (Technical Leader)
- **Repository:** `https://github.com/wtrg/union-bot`
- **Branch:** `main`
- **Verdict Requested:** `APPROVED — GO_P3`

---

## 1. Executive Summary & Verification Metrics (Closing C04)

In response to Technical Leader Gate Review R06 (`reports/audit/UNION_BOT_P2_R06_LEADER_VERDICT.md`), the implementation team has fully resolved all **3 Release-Blocking Findings (`UB-P2-R06-001`, `UB-P2-R06-002`, `UB-P2-R06-003`)**, the **2 Named Carryovers (`C01`, `C02`)**, and elevated evidence fidelity (`C03`) and metrics tracking (`C04`).

Every test runs in authentic Windows environments without mocks: genuine Windows subprocesses, native SQLite WAL engines, and live Electron Chromium browser instances.

| Metric | Phase P2 Round R06 | Phase P2 Round R07 (Current) | Change & Verification Status |
| :--- | :--- | :--- | :--- |
| **Node / TS Tests** | 139 tests | **146 tests** | +7 tests (`r07_security_hardening.test.ts`) |
| **Python Unit Tests** | 16 tests | **16 tests** | 100% PASS (`test_*.py`) |
| **Real Electron E2E Tests** | 7 tests | **9 tests** | +2 live Electron tests (`desktop-r07.test.js`) |
| **Total Automated Tests** | 162 tests | **171 tests** | **171/171 PASS (0 FAIL, 100% Green)** |
| **GUI Smoke Test** | PASS | **PASS** | `launch.js --smoke` verifies IPC & Zero-Cost |
| **Secret Scan (0đ Audit)** | 780 files, 0 leaks | **786 files, 0 leaks** | 100% PASS (Zero plaintext secrets) |
| **Zero-Cost Invariant** | 0 VND / 0 USD | **0 VND / 0 USD** | CostGuard active on all IPC & network egress |
| **Release Blockers Open** | 3 Findings | **0 (All Resolved in Source)** | Fully Hardened |

---

## 2. Production Source Code Hardening (Resolutions to R06 Findings)

### A. UB-P2-R06-001 (S1 — Human Consent / Approval Activation)
- **Vulnerability Identified in R06:** The Main process tested untrusted renderer-supplied booleans (`decisionContext.confirmedByUser === true` or `userConfirmed: true`). Any script executing inside the renderer could mint `OPERATOR` without an actual user gesture or OS confirmation dialog.
- **Production Hardening Applied:**
  - `apps/desktop/src/main.js`: Implemented Main-process-owned `requestNativeHumanConfirmation(tokenRecord, ownerWindow)` using native `dialog.showMessageBox` with default button `Cancel` (`defaultId: 0`, `cancelId: 0`).
  - Untrusted renderer booleans are strictly ignored as authorization proof.
  - Main independently loads the canonical `ActionIntent` from durable storage, displays exact tool/target/scope/digest, and requires affirmative native human confirmation.
  - In `union-bot:approve-token`: Independently verifies `expectedDigest` against stored `payload_digest`. Stale or modified intent immediately rejects with `ERR_PAYLOAD_MISMATCH: Stale or modified intent; expected digest ... does not match stored digest ... (R07-A01)`.
  - Cancel, dismiss, or lack of affirmative user click immediately rejects with `ERR_HUMAN_CONFIRMATION_REQUIRED`.
  - For headless test automation, confirmation delegates are strictly gated behind dedicated test harness (`process.env.UNION_BOT_E2E_HARNESS === '1' && process.env.NODE_ENV === 'test' && !app.isPackaged`). Default in harness without explicit auto-approve is Cancel/rejection to prevent hanging.
- **Verification Vector R07-A01:**
  - Unit/Integration: `packages/storage/tests/r07_security_hardening.test.ts` (`R07-A01`) confirms unconfirmed/cancel leaves token `PENDING`, stale digest mismatch rejects with `ERR_PAYLOAD_MISMATCH`, and affirmative confirmation sets `APPROVED` with `confirmedVia: 'NATIVE_MAIN_PROCESS_CONFIRMATION'`.
  - Real Electron Chromium E2E: `tests/e2e/desktop-r07.test.js` exercises renderer `executeJavaScript` creating tokens, proving unconfirmed calls fail-closed, stale calls fail-closed, and affirmative confirmation atomically allows action dispatch with 100% digest match (`ELECTRON_R07_E2E_EVIDENCE.json`).

### B. UB-P2-R06-002 (S1 — NULL Digest Idempotency Bypass)
- **Vulnerability Identified in R06:** In `apps/desktop/src/orchestrator.cjs`, `if (existingRecord.payloadDigest && existingRecord.payloadDigest !== incomingDigest)` allowed rows with `status='COMPLETED'` and `payload_digest=NULL` to skip comparison and return `{ success: true, deduplicated: true }` cached ACK.
- **Production Hardening Applied:**
  - `apps/desktop/src/orchestrator.cjs`: In `dispatchEnvelope`, COMPLETED replay strictly requires `hasValidStoredDigest` (`typeof payloadDigest === 'string' && /^[a-f0-9]{64}$/i.test(payloadDigest)`). If NULL, empty, or malformed, returns `code: 'ERR_IDEMPOTENCY_UNVERIFIED'`.
  - `apps/desktop/src/storage-service.cjs`: Native and worker transactions enforce non-null 64-character hex digest verification on COMPLETED replays. Rejects with `ERR_IDEMPOTENCY_UNVERIFIED`.
  - `apps/desktop/src/storage-worker.cjs`: In worker transaction, COMPLETED idempotency key replay with missing/null/malformed digest throws `ERR_IDEMPOTENCY_UNVERIFIED`.
  - `packages/storage/src/idempotency.ts`: In `IdempotencyManager.acquire()`, COMPLETED key with missing or malformed digest throws `UnionBotError({ code: 'ERR_IDEMPOTENCY_UNVERIFIED' })`.
  - `packages/protocol/src/schemas.ts` & `packages/storage/src/errors.ts`: Added `'ERR_IDEMPOTENCY_UNVERIFIED'` to `UnionBotErrorCodeSchema` and error definitions.
- **Verification Vector R07-A02:**
  - `packages/storage/tests/r07_security_hardening.test.ts` (`R07-A02` Parts 1, 2, and 3): Seeds real SQLite database with `status='COMPLETED', payload_digest=NULL`.
  - Part 1 verifies Desktop Orchestrator returns `ERR_IDEMPOTENCY_UNVERIFIED`, never cached ACK, no RAM fallback.
  - Part 2 verifies Worker Storage Transaction rejects with `ERR_IDEMPOTENCY_UNVERIFIED`.
  - Part 3 verifies TypeScript `IdempotencyManager.acquire()` rejects NULL and malformed digests, and only accepts valid matching 64-char digests.

### C. UB-P2-R06-003 (S1/S2 — Test IPC Isolation & Launcher Flag Boundary)
- **Vulnerability Identified in R06:** `testKillWorker` remained exposed in renderer preload in production builds. Main treated generic flags like `--headless` or `NODE_ENV=test` alone as sufficient test mode.
- **Production Hardening Applied:**
  - `apps/desktop/src/preload.cjs`: `testKillWorker` and `testSetConfirmationMode` are attached to `window.unionBotAPI` **only** when `process.env.UNION_BOT_E2E_HARNESS === '1' && process.env.NODE_ENV === 'test'`. In production builds or normal launches, they are completely omitted (`undefined`).
  - `apps/desktop/src/main.js`: Gated behind `isDedicatedTestHarness` (`!isPackagedApp && process.env.NODE_ENV === 'test' && process.env.UNION_BOT_E2E_HARNESS === '1'`).
  - Generic launch flags like `--headless`, `--test`, etc. alone CANNOT enable test mutation channels.
  - In non-harness/production mode, raw IPC invocations fail-closed with:
    `ERR_TEST_IPC_DISABLED: Test IPC channels are strictly disabled in production mode (UB-P2-R06-003)`.
- **Verification Vector R07-A03:**
  - Logic boundary check in `r07_security_hardening.test.ts` (`R07-A03`).
  - Real Electron production Chromium test in `tests/e2e/desktop-r07.test.js` (`R07-A03`): Spawns live Electron with `NODE_ENV=production, UNION_BOT_E2E_HARNESS=0`, asserts `testKillWorker` and `testSetConfirmationMode` are strictly `undefined`, storage worker remains alive (`ELECTRON_R07_PROD_EVIDENCE.json`).

### D. C01 — TypeScript Orchestrator Atomic Parity
- **Vulnerability Identified in R06:** In `packages/orchestrator/src/orchestrator.ts`, `approvalGate.validateAndConsume()` ran before and outside `storage.transaction()`, unlike Electron worker.
- **Production Hardening Applied:**
  - `packages/orchestrator/src/orchestrator.ts`: Moved `this.approvalGate.validateAndConsume(...)` inside `this.storage.transaction(() => { ... })`.
  - If a fault or error occurs during envelope insertion, event appending, or idempotency completion, the entire transaction rolls back, and the approval token remains `APPROVED` (not consumed).
- **Verification Vector R07-A04:**
  - `packages/storage/tests/r07_security_hardening.test.ts` (`R07-A04`): Injects fault inside storage transaction after consume; verifies atomic rollback where approval token remains `APPROVED` and zero orphaned events exist.

### E. C02 — Legacy Migration Structural Fingerprint Recognition
- **Vulnerability Identified in R06:** In `packages/storage/src/schema-definition.cjs`, legacy migration recognition checked only generic 7-table existence, which could allow a spoofed schema with wrong columns to be mishandled.
- **Production Hardening Applied:**
  - `packages/storage/src/schema-definition.cjs`: Added `LEGACY_STRUCTURAL_SIGNATURE` column dictionary defining mandatory column signatures for all 7 tables (`rooms`, `events`, `envelopes`, `idempotency_keys`, `outbox`, `approvals`, `audit_ledger`).
  - `isVerifiedLegacyFingerprint(db, appliedChecksum)` inspects both table existence and precise column structure. Rejects unknown/tampered structures with `ERR_MIGRATION_TAMPERED`.
- **Verification Vector R07-A05:**
  - `packages/storage/tests/r07_security_hardening.test.ts` (`R07-A05`): Creates 7 tables with spoofed/altered columns and legacy checksum; verifies `isVerifiedLegacyFingerprint` returns `false` and `runSchemaMigrations` throws `ERR_MIGRATION_TAMPERED` with 0 migration writes.

---

## 3. Results for the 5 Mandatory R07 Test Vectors (R07-A01 .. R07-A05)

| Vector | Specification | Test File | Environment | Result | Evidence File / Artifact |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`R07-A01`** | **Human Consent / Native Confirmation:** Unconfirmed script rejects (`ERR_HUMAN_CONFIRMATION_REQUIRED`), token remains PENDING; stale intent rejects (`ERR_PAYLOAD_MISMATCH`); affirmative native confirmation approves token, action dispatched and token atomically CONSUMED with matching digest | `r07_security_hardening.test.ts`<br>`desktop-r07.test.js` | Node 24 SQLite<br>+ Live Electron Chromium | **PASS** | `ELECTRON_R07_E2E_EVIDENCE.json` |
| **`R07-A02`** | **Idempotency NULL Digest Defense:** COMPLETED key with NULL digest in DB returns `ERR_IDEMPOTENCY_UNVERIFIED` (no cached ACK, no RAM fallback) across CJS Desktop Orchestrator, Worker transaction, and TS IdempotencyManager | `r07_security_hardening.test.ts` | Node 24 SQLite + Worker + Orchestrator | **PASS** | `r07_security_hardening.test.ts` |
| **`R07-A03`** | **Test IPC Isolation & Flag Boundary:** Production configuration strictly denies test mutation channels (`testKillWorker`, `testSetConfirmationMode` undefined in renderer); launcher flags like `--headless` alone cannot enable them | `r07_security_hardening.test.ts`<br>`desktop-r07.test.js` | Real Live Electron Production Instance | **PASS** | `ELECTRON_R07_PROD_EVIDENCE.json` |
| **`R07-A04`** | **TS Orchestrator Atomic Parity (C01):** `validateAndConsume` inside `storage.transaction`; fault injection rolls back approval token to `APPROVED` | `r07_security_hardening.test.ts` | Node 24 Monorepo TS Engine | **PASS** | `r07_security_hardening.test.ts` |
| **`R07-A05`** | **Legacy Migration Structural Recognition (C02):** Spoofed 7-table schema with altered columns rejected with `ERR_MIGRATION_TAMPERED`, 0 migration writes | `r07_security_hardening.test.ts` | Node 24 Native SQLite | **PASS** | `r07_security_hardening.test.ts` |

---

## 4. Verification Evidence & Raw Command Output

The complete verification pipeline `scripts/verify.ps1` executed cleanly on Windows 11 with exit code 0:

```text
========================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE (P2 ROUND R07)
========================================================

--- 1. Strict TypeScript Typecheck across Monorepo ---
> tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json
[PASS] (0 errors)

--- 2. Building Workspace UI Production Bundle ---
> @union-bot/workspace-ui build: vite build
dist/index.html                   0.72 kB │ gzip:  0.44 kB
dist/assets/index-BxyFW_DT.css    4.96 kB │ gzip:  1.40 kB
dist/assets/index-D4MSbK-L.js   153.40 kB │ gzip: 49.49 kB
✓ built in 583ms

--- 3. Running TypeScript & Node Unit/Integration Tests (including R07 A01..A05) ---
> node --experimental-strip-types --test ...
ℹ tests 146
ℹ suites 26
ℹ pass 146
ℹ fail 0

--- 4. Running Python Unit Tests (16 tests) ---
> python -m unittest discover -s tests -p "test_*.py"
Ran 16 tests in 1.053s
OK

--- 5. Running Real Windows Electron E2E Tests (R04, R05, R06, and R07) ---
> node --test tests/e2e/desktop-r04.test.js tests/e2e/desktop-r05.test.js tests/e2e/desktop-r06.test.js tests/e2e/desktop-r07.test.js
▶ Union Bot P2-R04 Desktop Windows E2E Suite (3 tests) - PASS
▶ Union Bot Phase P2 Gate R05: Windows Electron Real E2E Suite (3 tests) - PASS
▶ Union Bot Phase P2 Gate R06: Windows Real Electron E2E Suite (1 test) - PASS
▶ Union Bot Phase P2 Gate R07: Windows Real Electron E2E Suite (2 tests) - PASS
  ✔ R07-A01: Real Electron live human confirmation, digest matching, and atomic consumption (PASS)
  ✔ R07-A03: Real Electron production configuration strictly denies test mutation channels (PASS)
ℹ tests 9
ℹ suites 4
ℹ pass 9
ℹ fail 0

--- 6. Running Electron Automated GUI Smoke Test ---
> node apps/desktop/scripts/launch.js --smoke
[SmokeTest] CostGuard egress check (paid API blocked): true
[SmokeTest] SafeExternal dangerous scheme blocked: true
[SmokeTest] Single instance lock held: true
[SmokeTest] Orchestrator zero-cost admission passed: true
[SmokeTest] Real GUI IPC send message verified: true
[SmokeTest] Smoke test PASS! All assertions verified cleanly.

--- 7. Running Strict Secret & Security Audit ---
> python scan_secrets.py --strict
Scanned files : 786
Confirmed Real Leaks : 0
Unresolved Findings  : 0
Scan errors          : 0
PASS: Secret scan completed safely without plaintext exposure.

========================================================
ALL VERIFICATION CHECKS PASSED (Typecheck + Build + 171 Tests [146 TS + 16 Py + 9 Real Electron E2E] + GUI Smoke + Strict Secret Scan)
========================================================
```

---

## 5. Artifact Links & Commit Reference

- **Git Commit SHA:** `8110cbac41ad4b249e06b650406d82fffca17f7c`
- **GitHub Branch:** `main` (pushed to `https://github.com/wtrg/union-bot`)
- `packages/storage/tests/r07_security_hardening.test.ts`: [r07_security_hardening.test.ts](file:///d:/WORK-TEAM/packages/storage/tests/r07_security_hardening.test.ts)
- `tests/e2e/desktop-r07.test.js`: [desktop-r07.test.js](file:///d:/WORK-TEAM/tests/e2e/desktop-r07.test.js)
- `reports/capability-evidence/ELECTRON_R07_E2E_EVIDENCE.json`: [ELECTRON_R07_E2E_EVIDENCE.json](file:///d:/WORK-TEAM/reports/capability-evidence/ELECTRON_R07_E2E_EVIDENCE.json)
- `reports/capability-evidence/ELECTRON_R07_PROD_EVIDENCE.json`: [ELECTRON_R07_PROD_EVIDENCE.json](file:///d:/WORK-TEAM/reports/capability-evidence/ELECTRON_R07_PROD_EVIDENCE.json)
- `apps/desktop/src/main.js`: [main.js](file:///d:/WORK-TEAM/apps/desktop/src/main.js)
- `apps/desktop/src/preload.cjs`: [preload.cjs](file:///d:/WORK-TEAM/apps/desktop/src/preload.cjs)
- `apps/desktop/src/orchestrator.cjs`: [orchestrator.cjs](file:///d:/WORK-TEAM/apps/desktop/src/orchestrator.cjs)
- `apps/desktop/src/storage-service.cjs`: [storage-service.cjs](file:///d:/WORK-TEAM/apps/desktop/src/storage-service.cjs)
- `apps/desktop/src/storage-worker.cjs`: [storage-worker.cjs](file:///d:/WORK-TEAM/apps/desktop/src/storage-worker.cjs)
- `packages/orchestrator/src/orchestrator.ts`: [orchestrator.ts](file:///d:/WORK-TEAM/packages/orchestrator/src/orchestrator.ts)
- `packages/storage/src/schema-definition.cjs`: [schema-definition.cjs](file:///d:/WORK-TEAM/packages/storage/src/schema-definition.cjs)

---

## 6. Request for Formal Gate Review

All directives for Phase P2 Round R07 are complete, verified, and backed by authentic Windows and Electron execution logs. We respectfully submit this review packet to the Technical Leader and request formal approval:

**Verdict Requested:** `APPROVED — GO_P3`
