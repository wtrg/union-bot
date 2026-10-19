# Union Bot Phase P7 Review Packet: Native Antigravity Agent Integration & Orchestration (Round R02 / Blocker P7-R01 Resolved)
**Target Gate:** Phase P7 Formal Sign-off (`APPROVED — GO_P8`)  
**Previous Gate:** Phase P6 Formal Sign-off (`APPROVED — GO_P7`, commit `5dc569a`)  
**Submission Commit:** `999dee2` (`fix(agent-antigravity): resolve blocker P7-R01 with canonical filesystem realpath boundary defense and real junction e2e verification`)  
**Repository:** `https://github.com/wtrg/union-bot.git` (Branch: `main`)  
**Auditor / Technical Leader:** ChatGPT Web ("Ý tưởng AI Workspace")  
**Implementer:** Antigravity Agent  
**Environment:** Windows 11 Electron Desktop (Node 20/24, SQLite WAL, Chromium WebContentsView)  
**Cost Guard Policy:** Strict $0.00 / 0đ Zero-Cost Enforcement Active  

---

## 1. Executive Summary & Resolution of Blocker P7-R01

Phase P7 ("Native Antigravity Agent Integration & Orchestration") has been fully hardened and verified against the Technical Leader's Blocker P7-R01 audit findings.

### A. Resolution of Blocker P7-R01 (Canonical Filesystem Boundary Defense):
1. **Filesystem Canonicalization with `fs.realpathSync`:**
   - Replaced shallow lexical path normalization with `AntigravityClient.getCanonicalPath()`.
   - Resolves physical `fs.realpathSync` on both `workspaceRoot` and `targetPath`.
   - For non-existent target paths (e.g., creating files/directories), recursively walks up ancestor directories until the nearest existing ancestor is found, resolves its `fs.realpathSync`, and reconstructs the target path before checking containment.
   - Fail-closed if `workspaceRoot` or any ancestor cannot be resolved canonically.
2. **Elimination of `cwd -> cwd` Check:**
   - In `AntigravityClient.executeTurn()`, replaced the self-comparison check with strict `workspaceRoot -> cwd` containment verification using the trusted workspace root (`options.workspaceRoot || options.cwd`).
   - `AntigravityAdapter.execute()` passes `workspaceRoot` down into `executeTurn()` options.
   - `AntigravityService.verifyWorkspaceBoundary()` directly invokes `AntigravityClient.verifyWorkspaceBoundary(this.workspaceRoot, targetPath)`.
3. **Comprehensive Defense Against Symlinks / Reparse Points:**
   - Blocks Windows junctions and directory symlinks inside the workspace pointing to outside directories (`ERR_PATH_TRAVERSAL`).
   - Blocks symlink chains (`link-a -> link-b -> outside`).
   - Blocks non-existent targets nested within escaping symlinks/junctions.
   - Blocks same-prefix escapes (`C:\workspace-evil` vs `C:\workspace`) and lexical `../` escapes.
   - Permits valid internal symlinks and non-existent targets that stay strictly within the canonical workspace boundary.
4. **Real Filesystem Windows Junction Escape in Electron E2E Subprocess:**
   - `apps/desktop/src/main.js` (`--p7-e2e`) dynamically creates a real cross-drive Windows directory junction pointing from `D:\WORK-TEAM\scratch` to an outside temporary directory on `C:`.
   - Confirms via IPC that both the junction itself and non-existent files nested within the junction are strictly denied fail-closed with `ERR_PATH_TRAVERSAL` (`results.junctionEscapeDenied = true`).

---

## 2. Implemented Tickets (P7-001 through P7-010 + P7-R01)

| Ticket | Component | Description & Architectural Realization | Verification Status |
| :--- | :--- | :--- | :--- |
| **P7-001** | `agent-antigravity` | Workspace Package Architecture & Config: Created `packages/agent-antigravity/` with dual TS/CJS entrypoints, types, and dependencies on `@union-bot/protocol`, `@union-bot/cost-guard`, `@union-bot/artifact-store`. | PASS (`pnpm typecheck`, `pnpm build`) |
| **P7-002** | `antigravity-discovery` | Local Executable Discovery: Probes Windows paths (`LOCALAPPDATA\agy\bin\agy.exe`, `PATH` via `where.exe`), parses CLI semantic version (`1.4.2`), and returns status. | PASS (Unit + Live E2E detection) |
| **P7-003** | `antigravity-client` | Headless CLI Transport & NDJSON Protocol: Spawns `agy.exe` with `-p` and `--output-format stream-json`, streams NDJSON chunks (`init`, `step_update`, `result`), and supports pluggable `MockAntigravityTransport`. | PASS (Unit: 9/9 tests pass) |
| **P7-004** | `antigravity-adapter` | Union Bot Protocol Adapter: Converts Union Bot prompts to Antigravity execution requests, bridges streaming deltas, and stores CAS output artifacts with full provenance. | PASS (Unit + Monorepo integration) |
| **P7-005** | `boundary-guard` | Canonical Workspace Boundary & Safety Enforcement: Enforces dual-layer lexical + canonical realpath checks on all root paths (`ERR_PATH_TRAVERSAL`), and denies dangerous flags (`ERR_FORBIDDEN_FLAG`). | PASS (E2E `invalidBoundaryDenied: true`, `junctionEscapeDenied: true`, `forbiddenFlagDenied: true`) |
| **P7-006** | `artifact-cas` | Artifact CAS Integration & Zero-Cost Egress: Stores resulting text/files in CAS via `ArtifactStore.storeBytes` with original bytes fidelity, and verifies egress is strictly $0.00 via `CostGuard`. | PASS (E2E `artifactCreated: true`, `costIsZero: true`) |
| **P7-007** | `agent-antigravity.cjs` | CommonJS Main Process Parity: Created CommonJS bundle with identical `getCanonicalPath` and boundary verification logic for direct loading into Electron 33 main process. | PASS (CJS parity verified in Electron runtime) |
| **P7-008** | `desktop-service` | Electron Service Integration: `apps/desktop/src/antigravity-service.cjs` wrapping discovery, execution, cancellation, boundary checks, and event forwarding. | PASS (Electron runtime parity) |
| **P7-009** | `ipc-preload` | Desktop IPC Handlers & Renderer Preload: `union-bot:antigravity-discover`, `union-bot:antigravity-execute`, `union-bot:antigravity-cancel`, `union-bot:antigravity-verify-boundary`. | PASS (Typechecked & E2E tested) |
| **P7-010** | `e2e-evidence` | Real Windows Electron E2E Suite: `tests/e2e/desktop-p7.test.js` validating all P7 flows including real Windows junction escape in live Chromium subprocess. | PASS (`ELECTRON_P7_E2E_EVIDENCE.json`) |

---

## 3. Real Windows Electron E2E Evidence

From `reports/capability-evidence/ELECTRON_P7_E2E_EVIDENCE.json`:
```json
{
  "timestamp": "2026-10-19T19:07:13.754Z",
  "environment": "Real Windows Electron (Phase P7 Native Antigravity Agent Integration)",
  "nodeEnv": "test",
  "results": {
    "antigravityDiscoverSuccess": true,
    "antigravityAvailable": true,
    "antigravityVersion": "1.4.2",
    "antigravityExecutablePath": "C:\\Users\\Lenovo\\AppData\\Local\\agy\\bin\\agy.exe",
    "antigravityVersionMatches": true,
    "validBoundaryAllowed": true,
    "invalidBoundaryDenied": true,
    "junctionEscapeDenied": true,
    "forbiddenFlagDenied": true,
    "executeSuccess": true,
    "providerIsAntigravity": true,
    "deltasReceived": true,
    "fullTextMatch": true,
    "artifactCreated": true,
    "costIsZero": true,
    "cancelSucceeded": true
  },
  "allPassed": true
}
```

---

## 4. Comprehensive Verification Matrix

```text
========================================================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE — PHASE P7 (ROUND R02)
========================================================================================
1. Monorepo TypeScript & Project Typecheck : PASS (0 errors across all workspaces)
2. Workspace UI Production Bundle (Vite)   : PASS (dist/index.html, 0.72 kB gzip: 0.44 kB)
3. Monorepo Unit & Integration Test Suites : PASS (203 TS tests + 16 Python tests)
   - packages/agent-codex tests            : PASS (9/9 tests pass)
   - packages/agent-antigravity tests      : PASS (9/9 tests pass including P7-R01 realpath regression)
4. Windows Real Electron Subprocess E2E    : PASS (15 suites / tests pass, 0 failed):
   - P3 Gate Live Dynamic Room & CAS       : PASS (31.8s)
   - P3-C03 Close & Reopen SQLite/CAS       : PASS (22.9s)
   - P4 Embedded Browser Isolation & Bounds  : PASS (12.2s)
   - P5 CAS, Previews, ToolHost & Local MCP  : PASS (23.4s)
   - P6 Native Codex Agent Integration Gate  : PASS (2.6s)
   - P7 Native Antigravity Integration Gate  : PASS (2.7s - including real Windows junction escape)
   - P2-R04 Storage Error Recovery Smoke     : PASS (1.6s)
   - P2-R04 Durable Kill / Relaunch          : PASS (14.0s)
   - P2-R04 Frame Boundary Isolation         : PASS (2.4s)
   - P2-R05 Hard Kill & Identical Replay     : PASS (24.3s)
   - P2-R05 Production Approval IPC Flow     : PASS (2.4s)
   - P2-R05 Worker Termination Recovery      : PASS (2.0s)
   - P2-R06 Human Confirmation & Multi-action: PASS (1.8s)
   - P2-R07 Live Human Confirmation & Digest : PASS (2.1s)
   - P2-R07 Production Test Channel Denial   : PASS (7.2s)
5. Production GUI Smoke Launch Test        : PASS (Electron GUI launches cleanly)
6. Strict Zero-Secret Leak Scanner Audit   : PASS (0 unresolved findings, strict exit code 0)
========================================================================================
OVERALL STATUS: ALL 7 VERIFICATION STAGES PASSED (EXIT CODE 0)
========================================================================================
```

---

## 5. Gate Transition Request

Blocker P7-R01 is completely resolved with verified realpath filesystem canonicalization, real Windows junction escape defense, ancestor directory resolution, and full regression testing across live Windows Electron 33 and local `agy.exe` 1.4.2.

We formally request the Technical Leader's final review and approval:
**`APPROVED — GO_P8`**
to authorize immediate commencement of **Phase P8: Multi-Agent Task Graph & Orchestration** (DAG task flow, Plan -> Implement -> Review -> Fix -> Verify, role routing, consensus, and stale review invalidation).
