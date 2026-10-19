# Review Packet: Phase P4 Gate Review (Round R03)
**Project:** Union Bot (0đ Zero-Cost Desktop AI Workspace on Windows 11)  
**Date:** 2026-10-19  
**Gate:** Phase P4 Gate (Embedded Chromium, Browser Isolation & Native AI Provider Surfaces) — Round R03  
**Commit:** `f7c129e` (origin/main)  
**Roles:** Implementation Lead (Antigravity), Verification Lead (Codex), Technical Leader (ChatGPT Web)  
**Status:** **SUBMITTED FOR FORMAL GATE REVIEW APPROVAL — TARGET: `APPROVED — GO_P5 — P4_ACCEPTED`**

---

## 1. Executive Summary & Verification Metrics

Round R03 systematically resolves all three blocker findings (`UB-P4-R02-001`, `UB-P4-R02-002`, `UB-P4-R02-003`) and verifies all 4 regression vectors (`P4-R03-A01` through `P4-R03-A04`) mandated by Technical Leader in `reports/audit/UNION_BOT_P4_R02_LEADER_VERDICT.md`.

All core invariants remain strictly satisfied:
- **Zero-Cost $0.00 Cloud Egress Invariant:** 100% local Windows 11 desktop execution; all paid API endpoints blocked fail-closed on embedded browser sessions.
- **Fail-Closed Security Invariant:** Insecure HTTP auth schemes, loopback ranges, cloud metadata addresses, and storage write failures fail closed with zero orphan state and zero spurious broadcasts.
- **Process & Partition Isolation:** Providers (ChatGPT, Gemini, Claude, DeepSeek) operate in independent persistent partitions (`persist:mcb-web-*`). Child OAuth popups remain strictly contained within the provider session, and external navigation routes cleanly to dedicated search partitions without contaminating provider state.

### Verification Summary Table

| Metric | Verification Result | Status |
| :--- | :--- | :--- |
| **Monorepo TypeScript Typecheck** | `tsc -b` across monorepo & `apps/workspace-ui` (0 errors) | **PASS (100%)** |
| **Workspace UI Production Bundle** | Vite production bundle built cleanly (`dist/assets/index-*.js`) | **PASS (100%)** |
| **TypeScript / Node Unit & Integration Tests** | 177 tests across 30 suites (including HTTP auth rejection unit tests) | **PASS (177/177)** |
| **Python Unit Tests** | 16 tests in `tests/test_*.py` | **PASS (16/16)** |
| **Real Windows Electron Chromium E2E** | 12 tests across 6 real subprocess suites (P4, P3, R07, R06, R05, R04) | **PASS (12/12)** |
| **Total Automated Tests** | **205 automated tests** (177 TS + 16 Py + 12 Real Electron E2E) | **PASS (205/205)** |
| **P4 R03 Regression Vectors** | All 4 vectors (`P4-R03-A01` .. `P4-R03-A04`) verified in real Electron subprocess | **PASS (4/4)** |
| **Automated GUI Smoke Test** | Real window, anti-spoofing, single instance, zero-cost egress | **PASS (100%)** |
| **Strict Secret Scan Audit** | 819 files scanned, 0 unresolved findings, 0 leaks (`scan-secrets.ps1`) | **PASS (0 Leaks)** |
| **Cost Guard Cloud Egress** | $0.00 cloud egress, 100% local execution | **PASS (0đ)** |

---

## 2. Technical Leader Findings Resolution Matrix

### Finding 1: `UB-P4-R02-001` (Severity S1 - OAuth Boundary & HTTPS Enforcement)
- **Issue:** `isAllowedForProvider` matched hostname without enforcing HTTPS (`http://accounts.google.com/` was not rejected). Child popup windows lacked navigation and redirect guards.
- **Resolution:**
  1. **Strict HTTPS Protocol Enforcement:**
     - In `packages/browser-manager/src/url-policy.ts` and `src/browser-manager.cjs`, `isAllowedForProvider(providerId, targetUrl)` strictly verifies `targetParsed.protocol === 'https:'`. Any insecure `http:` auth URL (e.g. `http://accounts.google.com/signin`) is rejected fail-closed.
     - In `apps/desktop/src/browser-service.cjs`, `navigate()` checks if the target host matches a provider auth origin; if protocol is not `https:`, it immediately returns `{ success: false, error: 'Insecure HTTP authentication is prohibited' }`.
  2. **Child Window (Popup) Navigation Guards:**
     - In `apps/desktop/src/browser-service.cjs`, registered `view.webContents.on('did-create-window', (childWindow) => { ... })`. Both `will-navigate` and `will-redirect` on the child window enforce `validateUrl` and `isAllowedForProvider(tab.providerId, targetUrl)`. Any navigation or redirect outside allowed provider auth domains is blocked (`event.preventDefault()`) and safely delegated to the OS default browser via `safeOpenExternal`.

### Finding 2: `UB-P4-R02-002` (Severity S1 - Strict SQLite Failure Fault-Injection)
- **Issue:** T06 in R02 only tested passing a non-existent `tabId`. `shareSelection` did not verify if storage returned `{ success: false }`.
- **Resolution:**
  1. **Storage Return Verification:**
     - In `apps/desktop/src/browser-service.cjs`, `shareSelection` captures `insertRes = await storageService.insertEnvelope(envelope)`. If `insertRes && insertRes.success === false`, it aborts, logs the failure, and returns `{ success: false, error: 'STORAGE_WRITE_FAILED: ...' }` without emitting the `union-bot:envelope-received` IPC broadcast.
  2. **Fault-Injection Test Harness:**
     - Added `union-bot:test-set-storage-share-mode` IPC handler in `apps/desktop/src/main.js` and `apps/desktop/src/preload.cjs` (active only when `UNION_BOT_E2E_HARNESS === '1'`).
     - E2E harness explicitly tests:
       - Mode `'throw'`: Storage throws an exception during insert -> returns `{ success: false, error: 'STORAGE_WRITE_FAILED: ...' }`.
       - Mode `'return_false'`: Storage returns `{ success: false, error: '...' }` -> returns `{ success: false, error: 'STORAGE_WRITE_FAILED: ...' }`.
       - Room history inspection: Verified that neither snippet is persisted into SQLite WAL history and no phantom envelopes are broadcast.

### Finding 3: `UB-P4-R02-003` (Severity S2 - "+ Add Tab" Button & Default URL Fallback)
- **Issue:** In `BrowserPanel.tsx`, "+ Add Tab" only sent `providerId: 'search'` without `url`. Backend rejected empty URL before checking provider defaults.
- **Resolution:**
  1. **Default URL Resolution Before Validation:**
     - In `apps/desktop/src/browser-service.cjs`, `createTab(providerId, url, title)` checks if `url` is omitted or empty. If so, it resolves `candidateUrl = PROVIDER_REGISTRY[providerId]?.defaultUrl || 'about:blank'` before executing URL policy validation.
  2. **Real DOM Button Interaction in E2E:**
     - In `apps/desktop/src/main.js` (`--p4-e2e`), the test clicks `document.querySelector('[data-testid="browser-add-tab-btn"]')`.
     - Verifies that a new Search tab is created in `state.tabs` with `url === 'https://duckduckgo.com/'` in partition `persist:mcb-web-search`, and renders in the tab strip DOM.

---

## 3. Regression Vector Evidence Table (P4-R03-A01 through A04)

Executed via real Windows Electron Chromium E2E subprocess in `tests/e2e/desktop-p4.test.js`:

| Vector ID | Test Objective & Condition | Expected Behavior | Automated Evidence | Status |
| :--- | :--- | :--- | :--- | :--- |
| **`P4-R03-A01`** | Popup OAuth & redirect controlled in same partition; HTTP auth rejected | `http://accounts.google.com/` rejected fail-closed; `https://accounts.google.com/signin` allowed; popup protected via `did-create-window` | `evidence.regressionVectors['P4-R03-A01'] === true` | **PASS** |
| **`P4-R03-A02`** | SQLite write failure simulated (storage throws & storage returns `{ success: false }`) | Returns `{ success: false }` for both; zero envelopes persisted in SQLite room history; no phantom events | `evidence.regressionVectors['P4-R03-A02'] === true` | **PASS** |
| **`P4-R03-A03`** | Real DOM click on `[data-testid="browser-add-tab-btn"]` | Creates new search tab with default URL `https://duckduckgo.com/` in `persist:mcb-web-search`; rendered in DOM | `evidence.regressionVectors['P4-R03-A03'] === true` | **PASS** |
| **`P4-R03-A04`** | Provider navigation to external destination (`https://news.ycombinator.com/` on ChatGPT tab) | Routes to dedicated search partition tab; ChatGPT tab URL & partition remain completely unpolluted | `evidence.regressionVectors['P4-R03-A04'] === true` | **PASS** |
| **`P4-R02-T01`** | Create tab with malicious schemes (`javascript:`) or private IPs (`127.0.0.2`, `169.254.169.254`) | Denied fail-closed; returns `{ success: false }`; no view created | `evidence.regressionVectors['P4-R02-T01'] === true` | **PASS** |
| **`P4-R02-T05`** | Selection share dispatched from background tab | Persisted envelope source URL, title, and provider strictly match background tab | `evidence.regressionVectors['P4-R02-T05'] === true` | **PASS** |

Full evidence artifact persisted: `reports/capability-evidence/ELECTRON_P4_E2E_EVIDENCE.json` (`"allPassed": true`).

---

## 4. Architectural Documents & File Changes

### Modified Files:
- `packages/browser-manager/src/url-policy.ts`: Strictly enforces HTTPS on provider auth origins.
- `packages/browser-manager/src/browser-manager.cjs`: Mirrored CJS exports for Desktop Main process runtime.
- `packages/browser-manager/tests/url-policy.test.ts`: Added unit tests asserting rejection of HTTP auth URLs.
- `apps/desktop/src/browser-service.cjs`:
  - Added `did-create-window` listener for OAuth child window protection.
  - Added default URL fallback in `createTab`.
  - Added explicit `{ success: false }` storage failure check in `shareSelection`.
  - Added clean view recreation on reload when recovering from renderer process crashes.
  - Added `_testStorageFaultMode` support for deterministic fault-injection.
- `apps/desktop/src/preload.cjs`: Exposed `testSetStorageShareMode` in dedicated test harness.
- `apps/desktop/src/main.js`: Added IPC handler for `test-set-storage-share-mode` and updated `--p4-e2e` with vectors `P4-R03-A01` through `P4-R03-A04`.
- `tests/e2e/desktop-p4.test.js`: Updated assertions for `P4-R03-A01` .. `A04`.

### Reference Documents:
- `reports/audit/UNION_BOT_P4_R02_LEADER_VERDICT.md`: Full archive of Technical Leader's Gate R02 verdict.
- `docs/providers/AUTHENTICATION_COMPATIBILITY_MATRIX.md`: Complete matrix of partition boundaries and OAuth origins.

---

## 5. Formal Request for Gate Approval

With all 3 blocker findings (`UB-P4-R02-001`, `UB-P4-R02-002`, `UB-P4-R02-003`) fully resolved, all 4 regression vectors (`P4-R03-A01` through `P4-R03-A04`) 100% verified in real Windows Electron runtime, 205 automated tests green, clean build and typecheck, zero secret leaks, and $0.00 cloud egress preserved:

We formally request Technical Leader's final review and approval:
**Verdict Requested:** `APPROVED — GO_P5 — P4_ACCEPTED`
