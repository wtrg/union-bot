# Union Bot — Phase P2 Round R05 Comprehensive Review Packet
**Zero-Cost 0đ Desktop AI Workspace (Windows 11, Electron, React, SQLite WAL)**

- **Date:** 2026-10-19
- **Round:** Phase P2 Round R05 (Formal Sign-Off Gate)
- **Implementation Owner:** Antigravity (Advanced Agentic Coding)
- **QA & Security Reviewer:** Codex (Verification Lead)
- **Technical Reviewer / Lead:** ChatGPT Web (Technical Leader)
- **Repository:** `https://github.com/wtrg/union-bot`
- **Branch:** `main`
- **Verdict Requested:** `APPROVED — GO_P3`

---

## 1. Executive Summary & Gate Status

In response to the Technical Leader's Round R05 Directives (`UNION_BOT_P2_R05_INDEPENDENT_REVIEW_GATE.md`), all **3 S1 Blockers**, **8 Regression Vectors (`R05-H01` through `R05-H08`)**, and **4 Carryover Directives (`R04-C01` through `R04-C04`)** have been fully implemented, hardened, and verified with **100% green passing results** across genuine Windows subprocesses, native SQLite WAL engines, and real Electron instances.

| Metric | Phase P2 Round R04 | Phase P2 Round R05 (Current) | Delta / Status |
| :--- | :--- | :--- | :--- |
| **Node / TS Tests** | 123 tests | **132 tests** | +9 tests (H01..H04, H06) |
| **Python Unit Tests** | 16 tests | **16 tests** | 100% PASS |
| **Real Electron E2E Tests** | 3 tests | **6 tests** | +3 tests (H05, H07, H08) |
| **Total Automated Tests** | 142 tests | **154 tests** | **154/154 PASS (0 FAIL)** |
| **GUI Smoke Test** | PASS | **PASS** | Dynamic envelope ID, 0 collisions |
| **Secret Scan (0đ Audit)** | 769 files, 0 leaks | **775 files, 0 leaks** | 100% PASS (Zero plaintext secrets) |
| **Zero-Cost Invariant** | 0 VND / 0 USD | **0 VND / 0 USD** | CostGuard active on all IPC & network egress |
| **S1 Blockers Open** | 3 S1 Blockers | **0 (All Resolved)** | Production architecture implemented |

---

## 2. Resolution of S1 Blockers

### A. UB-P2-R04-01: Migration Checksum & Schema Parity
- **Root Cause in R04:** Schema migration v1 lacked `dag_nodes` and `snapshots` in its checksum calculation, leading to `ERR_MIGRATION_TAMPERED` when TypeScript and Worker cross-opened databases.
- **Production Architecture Implemented:**
  - Created a single authoritative schema source: `packages/storage/src/schema-definition.cjs` and `apps/desktop/src/schema-definition.cjs`.
  - Canonical migration v1 checksum: `6d2974377ba1d41d8cbdc1653a7e0d85baa0f011858c3df27f4ccce7c35e1fad` (authentic SHA256 covering all tables: `rooms`, `envelopes`, `events`, `outbox`, `idempotency_keys`, `approvals`, `dag_nodes`, `snapshots`, and all 7 indices).
  - Both TypeScript `StorageEngine`, Native Electron `storage-service.cjs`, and Node 24 `storage-worker.cjs` use the exact same schema definition, checksum calculation, and migration runner.
  - Implemented safe legacy upgrade logic (`isVerifiedLegacyFingerprint`): databases created with legacy fingerprint `e3b0c442...` are recognized and safely upgraded without data loss, while tampered or foreign checksums are strictly rejected with `ERR_MIGRATION_TAMPERED`.
- **Verification:** Tested across `packages/storage/tests/r05_schema_cross_engine.test.ts` (`R05-H01`, `R05-H02`, `R05-H03`). 3/3 PASS.

### B. UB-P2-R04-02: Atomic Approval Consumption & Commit
- **Root Cause in R04:** Approval consumption was executed as a separate step outside the envelope transaction, risking orphaned tokens or inconsistent states upon worker crash.
- **Production Architecture Implemented:**
  - Inside `storage-worker.cjs` and `storage-service.cjs`, `insertEnvelope(envelope, { approval: approvalReq })` executes inside a single `BEGIN IMMEDIATE ... COMMIT` SQLite transaction.
  - Checks idempotency key first.
  - Executes atomic CAS update:
    ```sql
    UPDATE approvals
    SET status = 'CONSUMED', consumed_at = ?
    WHERE token_id = ? AND status = 'APPROVED'
    ```
  - Strictly asserts `info.changes === 1`. If already consumed or invalid, rolls back immediately.
  - Inserts into `envelopes`, `events`, and `outbox`, marks idempotency key `COMPLETED`, and commits atomically.
  - If a fault or process termination occurs at any checkpoint (`after_approval_consume`, `before_envelope_insert`, `after_event`, `before_commit`), the entire transaction rolls back cleanly: the approval token remains `APPROVED` with `consumed_at = NULL`, and zero records exist in `envelopes`, `events`, or `outbox`.
- **Verification:** Tested across `packages/storage/tests/r05_approval_atomic_idempotency.test.ts` (`R05-H04` across 4 checkpoints + success case). 5/5 PASS.

### C. UB-P2-R04-03: Durable Idempotency Check BEFORE Approval Gate
- **Root Cause in R04:** Idempotency checks occurred during storage insertion, after action admission and approval validation. Replaying an identical completed action returned `ALREADY_CONSUMED` instead of the cached ACK.
- **Production Architecture Implemented:**
  - Exposed `getIdempotencyRecord(key)` on `StorageServiceClient` and worker.
  - In `apps/desktop/src/orchestrator.cjs` and `packages/orchestrator/src/orchestrator.ts`:
    1. Computes canonical envelope digest `incomingDigest = computeEnvelopeDigest(envelope)`.
    2. Checks durable `getIdempotencyRecord(envelope.id)` **BEFORE** evaluating action parts or touching approval tokens.
    3. If `existingRecord` exists:
       - If `existingRecord.payloadDigest !== incomingDigest`: throws `ERR_PAYLOAD_MISMATCH` fail-closed.
       - If `existingRecord.status === 'COMPLETED'`: returns immediate cached ACK `{ success: true, deduplicated: true }` without touching approval token or creating new events.
       - If `status === 'UNKNOWN_NEEDS_RECONCILIATION'`: returns `ERR_RECONCILIATION_REQUIRED` and strictly prevents auto-resend.
- **Verification:** Tested in `packages/storage/tests/r05_approval_atomic_idempotency.test.ts` (`R05-H06`) and real Electron E2E `tests/e2e/desktop-r05.test.js` (`R05-H05`). All PASS.

---

## 3. Comprehensive Results for 8 Regression Vectors (R05-H01 .. R05-H08)

| Vector | Description | Environment | Result | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| **`R05-H01`** | Worker creates fresh DB -> TypeScript cross-opens without `ERR_MIGRATION_TAMPERED` | Node 24 + SQLite WAL | **PASS** | `r05_schema_cross_engine.test.ts` |
| **`R05-H02`** | TypeScript creates DB -> Worker & Native cross-open and mutate two-way | Node 24 + SQLite WAL | **PASS** | `r05_schema_cross_engine.test.ts` |
| **`R05-H03`** | Upgrades 3 independent legacy DB fixtures with verified legacy fingerprint recognition | Node 24 + SQLite WAL | **PASS** | `r05_schema_cross_engine.test.ts` |
| **`R05-H04`** | Fault injection crash after consume but before commit (4 checkpoints: after_consume, before_env, after_evt, before_commit) -> rollback clean, token remains APPROVED | Node 24 worker subprocess | **PASS** | `r05_approval_atomic_idempotency.test.ts` |
| **`R05-H05`** | Hard kill Electron after approved action commit -> relaunch with same `userData` -> replay returns cached ACK (`deduplicated: true`) without `ALREADY_CONSUMED`, zero duplicate events/outbox | Real Windows Electron + SQLite WAL | **PASS** | `ELECTRON_R05_H05_KILL_REPLAY_EVIDENCE.json` |
| **`R05-H06`** | 7-vector tamper matrix on completed action (`args.path`, `options.overwrite`, `args.content`, `recipient`, `workspaceId`, `roomId`, `policyVersion`) -> all rejected with `ERR_PAYLOAD_MISMATCH` | Native & Worker + Concurrent | **PASS** | `r05_approval_atomic_idempotency.test.ts` |
| **`R05-H07`** | Full production IPC approval flow (`previewDigest === approvedDigest === consumedDigest === recordedDigest`), post-preview tamper blocked fail-closed | Real Windows Electron + Preload API | **PASS** | `ELECTRON_R05_H07_APPROVAL_IPC_EVIDENCE.json` |
| **`R05-H08`** | 4 crash/recovery scenarios verified (tx rollback, post-commit cached ACK, DISPATCH_PREPARED reconciliation, runtime worker death transition to STORAGE_ERROR_BLOCKED) | Real Windows Electron + Worker IPC | **PASS** | `ELECTRON_R05_H08_WORKER_KILL_EVIDENCE.json` |

---

## 4. Carryovers Verification (R04-C01 .. R04-C04)

- **`R04-C01` (Human Approval Intent):** Real preview generated from `ActionIntent` before approval issuance. Approver principal is strictly minted server-side by the main process as `TrustedPrincipal` (`OPERATOR`). Client/renderer cannot forge approval roles.
- **`R04-C02` (ActionIntent Normalization):** `extractActionSemanticInput` strips transport-only fields (`approvalTokenId`, `approval_token_id`) prior to hashing. The token ID itself is outside the canonical digest, while all semantic parameters (`path`, `content`, `options`, `tool`) are strictly hashed.
- **`R04-C03` (Runtime Worker Exit Handling):** `StorageServiceClient` extends `EventEmitter` and emits `worker-exit`. `apps/desktop/src/main.js` catches unexpected worker termination at runtime, transitions `appStatus` to `STORAGE_ERROR_BLOCKED`, emits `union-bot:app-status-changed` to renderer, and fail-closed denies all mutation IPC (`dispatchEnvelope`, `approveToken`) with `ERR_STORAGE_UNAVAILABLE`.
- **`R04-C04` (Phase P3 Boundary & Scope):** All changes maintain the zero-cost (0đ) fail-closed policy. No paid cloud services or API dependencies are used. P3 scope focuses on the Desktop Workspace UI and local orchestrator execution.

---

## 5. Test Suite & Verification Pipeline Summary

```powershell
========================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE (P2 ROUND 5)
========================================================

--- 1. Strict TypeScript Typecheck across Monorepo ---
pnpm typecheck -> 0 errors

--- 2. Building Workspace UI Production Bundle ---
pnpm build -> Built in 1.07s

--- 3. Running TypeScript & Node Unit/Integration Tests (132 tests) ---
pnpm test:ts -> 132 passed, 0 failed, 18 suites (1755ms)

--- 4. Running Python Unit Tests (16 tests) ---
pnpm test:py -> 16 passed, 0 failed (1043ms)

--- 5. Running Real Windows Electron E2E Tests (R04 + R05) ---
pnpm test:e2e -> 6 passed, 0 failed (10987ms)
  - R04-G07: Real Electron startup with storage failure shows recovery screen
  - R04-G08: Real Electron kill/relaunch maintains exactly-once durable state
  - R04-G11: Actual Electron IPC frame boundary permits only trusted main frame
  - R05-H05: Hard kill after approved action commit -> restart -> replay ACKs without ALREADY_CONSUMED
  - R05-H07: Full production IPC approval flow matches digests, blocks post-preview tamper
  - R05-H08: Storage worker runtime termination triggers STORAGE_ERROR_BLOCKED

--- 6. Running Electron Automated GUI Smoke Test ---
pnpm smoke:gui -> PASS (All assertions verified cleanly)

--- 7. Running Strict Secret & Security Audit ---
pnpm secret-scan -> 775 files scanned, 0 leaks, PASS

========================================================
ALL VERIFICATION CHECKS PASSED (Typecheck + Build + 154 Tests + GUI Smoke + Strict Secret Scan)
========================================================
```

---

## 6. Formal Petition for Phase P2 Sign-Off

All conditions and technical directives for Phase P2 have been completely satisfied with concrete, verifiable code and tests committed to the repository.

We respectfully submit this packet to the Technical Leader (ChatGPT Web) and formally request the verdict:
**`APPROVED — GO_P3`**
