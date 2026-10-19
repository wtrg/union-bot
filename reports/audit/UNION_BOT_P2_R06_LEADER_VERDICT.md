# UNION BOT — Independent Technical Leader Gate Review: P2 R06
**Date:** 2026-10-19 (Asia/Ho_Chi_Minh)  
**Repository:** https://github.com/wtrg/union-bot  
**Reviewed commit:** `c928507ffccbb81cceaa769db1b2962aaf0f5d7a` (main)  
**Previous commit:** `e5d37b0c2442442b61995c5775ac5ec1b2c85677`  
**Review type:** Independent GitHub source-and-test review; not an independent local Windows/Electron test execution.  
**Verdict:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_OFFLINE_UI_SCAFFOLD_ALLOWED`.

---

## 1. Evidence and Accepted Fixes
Diff covers 19 changed files. `R05-F01` (multi-action rejection) is implemented in the Electron CJS and TS orchestrators, `R05-F02` performs checksum/version checks before DDL, and `R05-F05` now returns `ERR_STORAGE_UNAVAILABLE` on a durable idempotency lookup failure. The R06 test file and an actual Electron subprocess E2E harness exist. 162/162 PASS is **TEAM_EXECUTED**, not **REVIEWER_EXECUTED**. Connected GitHub checks returned no statuses or PR-triggered workflow runs for this commit; no independent Windows verification was carried out here.

---

## 2. Release-Blocking Findings

### UB-P2-R06-001 — S1: Renderer-controlled confirmation is not authenticated human consent
- **Source:** `apps/desktop/src/main.js`, lines 1260–1299; `apps/desktop/src/preload.cjs`, lines 32–45.
- **Finding:** Main tests `decisionContext.confirmedByUser === true || userConfirmed === true` from untrusted renderer input. Any script allowed to invoke `window.unionBotAPI` can set that flag itself. Main then mints `local-operator` / `OPERATOR` / `isTrustedContext: true`. This is not evidence of a human reviewing or approving the action. The R06 Electron test proves this: it invokes `approveToken(tokenId, { confirmedByUser: true })` from `executeJavaScript` with no user click (`main.js`, lines 898–918). The unit B03 test uses a duplicate/simulated handler rather than a real user gesture.
- **Remediation:** Never accept renderer-supplied confirmation as authorization. For P2, use a main-process-owned native confirmation (e.g. Electron `dialog.showMessageBox` or native modal) or a genuine trusted OS-bound interaction. Main must load the canonical pending `ActionIntent` and scope from durable storage, independently compute/verify digest, display specific tool/target/args/workspace/cost, present default Cancel, and issue approval only on affirmative native user interaction; log authenticated decision and digest. Do not mint `OPERATOR` solely in response to renderer boolean. A P3 custom approval UI may be developed later, but action mutation must stay disabled until its confirmation security is real.
- **Required regression R07-A01:** Renderer `executeJavaScript` creates token and invokes `approveToken(tokenId, { confirmedByUser: true })` without interacting with the native confirmation; status MUST remain `PENDING`, no approval audit, no action dispatch. Separately test an actual user confirmation -> `APPROVED` with displayed action digest matching consumed digest. Stale/changed intent, Cancel, and closed dialog -> `DENY`.

---

### UB-P2-R06-002 — S1: NULL digest can still get cached completed ACK in Desktop orchestrator
- **Source:** `apps/desktop/src/orchestrator.cjs`, lines 502–525.
- **Finding:** The digest comparison uses `if (existingRecord.payloadDigest && existingRecord.payloadDigest !== incomingDigest)`. Consequently an existing idempotency row with `status='COMPLETED'` but `payload_digest=NULL` skips comparison and returns `{ success: true, deduplicated: true }` before reaching the worker, which has a stricter comparison. Nullable `payload_digest` is supported by the database schema/legacy fixtures. This bypasses the invariant that cached ACK is authoritative only when same-action content is proved.
- **Remediation:** `COMPLETED` replay MUST require a valid stored digest of expected format and equality to the incoming digest. A null/empty/malformed digest is `ERR_IDEMPOTENCY_UNVERIFIED` / `ERR_RECONCILIATION_REQUIRED`, never a success ACK. Only backfill a digest from an independently trusted canonical stored envelope after consistency verification; no user-payload-derived backfill to force matching. Same rule in CJS, TypeScript, native and worker.
- **Required regression R07-A02:** Seed real SQLite `idempotency_keys(key='same', status='COMPLETED', payload_digest=NULL)` plus valid rows where relevant. Call actual Desktop orchestrator with same ID but changed action; expect no success, no dedup ACK, no event/outbox/approval mutation, and no RAM fallback. Repeat with malformed digest, matching digest and mismatching digest; check native and worker.

---

### UB-P2-R06-003 — S1/S2: Test-only kill IPC can be enabled by generic runtime flags
- **Source:** `apps/desktop/src/main.js`, lines 1316–1343; `preload.cjs`, lines 70–72.
- **Finding:** The kill-worker IPC remains exposed in the renderer preload on production builds; main treats `--headless`, `--test`, a `--test-*` prefix, `--smoke`, `NODE_ENV=test`, etc. as sufficient test mode. These are caller-configurable launch conditions, not a robust production/security boundary. `desktop-r06.test.js` runs with `--r06-e2e` and proves only test-mode allowed, not production-mode denied.
- **Remediation:** Remove test-only mutation channels from packaged production entirely (or compile/test-only code path with a non-production invariant), with no generic `--headless`/environment toggle enabling them. Deny all direct renderer attempts in a packaged production build. Use private test harness injection for E2E worker kills.
- **Required regression R07-A03:** Launch genuine packaged/production configuration (also `--headless` if supported), assert `testKillWorker` unavailable/denied, check worker alive and no side effects; in isolated test build, verify dedicated instrumented mechanism works. Assert launcher flags alone cannot enable test mutation API.

---

## 3. Carryovers and Hardening (Not to Misrepresent as Closed)

### C01 — TypeScript Orchestrator Atomic Parity
- **Source:** `packages/orchestrator/src/orchestrator.ts`, lines 212–267 still runs `approvalGate.validateAndConsume()` outside and before `storage.transaction()`, unlike Electron worker. If this TS path is currently callable for actions, treat as S1; otherwise hard-disable it for effectful actions and retain as named carryover before any P6/P8 integration.
- **Required regression R07-A04:** Fault inject between consume and storage write using TS orchestrator, verify rollback and approval remains `APPROVED`, or verify runtime explicitly denies effectful actions.

### C02 — Legacy Migration Recognition
- **Source:** `schema-definition.cjs`, lines 167–191 recognizes legacy checksum by generic 7-table presence and `PRAGMA integrity_check`, not a precise structural fingerprint. Add versioned schema-shape signatures (columns, constraints, indices) for explicitly supported legacy variants; reject unknown structures.
- **Required regression R07-A05:** Malformed core schema with seven expected table names and spoofed old checksum must reject with no migration writes.

### C03 — Evidence Fidelity
`R06-B03`'s unit test reimplements the IPC condition instead of exercising real trusted confirmation. `R06-B06`'s Electron test asserts test-mode allowed; its production-mode deny is simulated in unit tests. Update vector descriptions and attach tests of actual production boundary.

### C04 — Verification Metrics
`reports/handoff/REVIEW_PACKET_P2_R06.md` states 162/162, whereas the final PowerShell success banner quoted therein says 142 Tests; correct stale counter and supply raw log/CI jobs where feasible.

---

## 4. Narrow Next Handoff
Do **not** redo already-supported R05/R06 test suites. Implement focused vectors `R07-A01`..`A03` plus `R07-A04` and `R07-A05` as appropriate, rerun the full baseline, and submit `reports/handoff/REVIEW_PACKET_P2_R07.md` with SHA, negative-test results, actual production Electron evidence, and source-linked changes.

**Gate:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_OFFLINE_UI_SCAFFOLD_ALLOWED`.  
Phase P3 remains offline Desktop Workspace UI, not live multi-provider adapters or DAG execution. No repository mutation has been performed by this reviewer.
