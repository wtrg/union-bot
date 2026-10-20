# Union Bot Phase P8 Review Packet: Multi-Agent Task Graph & Consensus Engine (Round R04)
**Target Gate:** Phase P8 Formal Sign-off (`APPROVED — GO_P9`)  
**Previous Gate:** Phase P7 Formal Sign-off (`APPROVED — GO_P8`, commit `4cd7369`)  
**Repository:** `https://github.com/wtrg/union-bot.git` (Branch: `main`)  
**Auditor / Technical Leader:** ChatGPT Web ("Ý tưởng AI Workspace")  
**Implementer:** Antigravity Agent  
**Environment:** Windows 11 Electron Desktop (Node 22, SQLite WAL, Chromium WebContentsView)  
**Cost Guard Policy:** Strict $0.00 / 0đ Zero-Cost Enforcement Active  

---

## 1. Executive Summary & Round R04 Remediation Delivery

In Phase P8 Round R03 audit, the Technical Leader confirmed that all previous consensus, anti-pre-approval, and digest binding protections passed audit. However, two IPC trust-boundary regressions were identified:

1. **`P8-R03-004` (CRITICAL - `taskGraphStep` Exposed to Production Renderer):**
   - *Vulnerability:* `preload.cjs` exposed `taskGraphStep` in production `window.unionBotAPI`, and `main.js` executed `executeNode()` directly without checking `getRunnableNodes()` or dependencies. A renderer could bypass the scheduler to run `IMPLEMENT`, `FIX`, or `VERIFY` out of sequence.
   - *Round R04 Remediation:* 
     - `taskGraphStep` is completely removed from the production `api` in `preload.cjs` and isolated strictly inside the test harness block (`UNION_BOT_E2E_HARNESS === '1' && NODE_ENV === 'test'`) as `testTaskGraphStep`.
     - In `main.js`, `union-bot:task-graph-step` strictly fails closed in production mode, returning `ERR_UNAUTHORIZED_ACTION`.
     - Even in test harness mode, `taskGraphStep` strictly enforces `getRunnableNodes(graph)`: if a node's dependencies are not satisfied or its status is not runnable, it throws `ERR_NODE_NOT_RUNNABLE`.
2. **`P8-R03-005` (CRITICAL - Reviewer Registry Writable from Production Renderer):**
   - *Vulnerability:* The IPC channel `taskGraphRegisterReviewer` was exposed in production, allowing renderer scripts to mutate the `authorizedReviewers` registry for non-privileged roles, creating a self-authorizing trust loop.
   - *Round R04 Remediation:*
     - `taskGraphRegisterReviewer` is completely removed from production `preload.cjs` and isolated strictly to test harness as `testTaskGraphRegisterReviewer`.
     - In `main.js`, `union-bot:task-graph-register-reviewer` strictly rejects renderer requests in production mode with `ERR_UNAUTHORIZED_ACTION` ("Mutating authorizedReviewers from renderer IPC is strictly forbidden in production. Reviewers must be pre-configured in trusted backend policies.").
     - In test harness mode, attempts to register privileged roles (`QA_SECURITY`, `LEADER`, `ORCHESTRATOR`) remain strictly blocked fail-closed (`ERR_UNAUTHORIZED_ACTION`).

---

## 2. Implemented Tickets & Security Regressions Matrix

| Ticket | Component | Description & Architectural Realization | Verification Status |
| :--- | :--- | :--- | :--- |
| **P8-001** | `task-graph-schema` | Task Graph & DAG Schemas in `@union-bot/protocol` (`StageType`, `ConsensusVote`, `ConsensusPolicy`, `TaskNodeDefinition`, `TaskGraphDefinition`, `NodeExecutionStatus`, `TaskGraphStatus`). | PASS (`pnpm typecheck`) |
| **P8-002** | `dag-cycle-detection` | DAG Dependency Resolver & Cycle Detection: DFS cycle detection throwing `ERR_CYCLE_DETECTED`, dependency validation, and Kahn's topological sort. | PASS (Unit P8-002, P8-003, P8-004) |
| **P8-003** | `5-stage-lifecycle` | 5-Stage Lifecycle Engine: `Plan -> Implement -> Review -> Fix -> Verify` pipeline with automatic stage transitions. | PASS (Unit P8-011, P8-012) |
| **P8-004** | `role-provider-routing` | Dynamic Role Routing: Mappings for `ARCHITECT`, `IMPLEMENTER`, `REVIEWER`, `QA_SECURITY`, `TESTER` across native agent providers (`antigravity`, `codex`). | PASS (Unit P8-011, IPC wiring) |
| **P8-005** | `stale-review-invalidation` | Stale Review Invalidation: Transitive downstream invalidation resetting completed/pending `REVIEW` and `VERIFY` nodes to `STALE` when code or artifacts mutate. | PASS (Unit P8-005) |
| **P8-006** | `consensus-protocol` | Consensus Protocol & Voting: Evaluates `unanimous`, `majority`, `threshold` policies with rationale aggregation and required role approvals (`QA_SECURITY`). | PASS (Unit P8-006, P8-007, P8-008) |
| **P8-007** | `security-boundary-inheritance` | Canonical Boundary & Zero-Cost Security Inheritance: Dual-layer lexical + canonical `fs.realpathSync` path checking with ancestor walk; denying `../`, same-prefix (`workspace-evil`), and Windows junction breakouts fail-closed (`ERR_PATH_TRAVERSAL_DENIED`); Zero-Cost egress enforcement. | PASS (Unit P8-009, P8-010, E2E junction check) |
| **P8-008** | `event-sourcing` | Event Sourcing & SQLite Persistence: Real-time event journal (`TASK_GRAPH_CREATED`, `TASK_NODE_STARTED`, `TASK_NODE_COMPLETED`, `CONSENSUS_DECIDED`, `STALE_REVIEW_INVALIDATED`). | PASS (Unit & IPC event streaming) |
| **P8-009** | `desktop-task-graph-service` | Desktop Main Process Service: `apps/desktop/src/task-graph-service.cjs` with 100% CJS parity for Electron 33 runtime execution. | PASS (CJS parity verified in Electron) |
| **P8-010** | `ipc-preload-wiring` | Desktop IPC Handlers & Preload API: Registered `union-bot:task-graph-*` IPC channels in `main.js` and exposed safe typed APIs in `preload.cjs`. | PASS (Typecheck & Live renderer IPC) |
| **P8-011** | `task-graph-unit-tests` | Comprehensive Unit Test Suite: 20/20 unit tests passing in `packages/orchestrator/tests/task-graph.test.ts`. | PASS (20/20 tests pass 100%) |
| **P8-012** | `real-electron-p8-e2e` | Real Windows Electron E2E Subprocess (`desktop-p8.test.js`): Live subprocess execution with real Windows directory junction test, producing `reports/capability-evidence/ELECTRON_P8_E2E_EVIDENCE.json` (`allPassed: true`). | PASS (24/24 checks pass, code 0) |
| **P8-R02-001** | `consensus-fail-closed` | Enforces missing-vote fail-closed without synthetic approval; zero votes returns `REJECT` + `ERR_NO_VOTES_RECORDED`. | PASS (Unit P8-R02-001) |
| **P8-R02-002** | `voter-authorization-check` | Denies forged `QA_SECURITY` votes via authorized voter lookup (`ERR_UNAUTHORIZED_VOTER`) and caller role binding (`ERR_ROLE_MISMATCH`). | PASS (Unit P8-R02-002, E2E check) |
| **P8-R02-003** | `vote-deduplication` | Deduplicates votes deterministically with single active vote per voter; updates in place. | PASS (Unit P8-R02-003, E2E check) |
| **P8-R02-004** | `stale-digest-rejection` | Denies vote on stale or mismatched digest (`ERR_STALE_VOTE_DIGEST`); binds review vote to exact code state. | PASS (Unit P8-R02-004, E2E check) |
| **P8-R03-001** | `anti-pre-approval` | Rejects vote submission with `ERR_REVIEW_TARGET_NOT_READY` if upstream `IMPLEMENT`/`FIX` has not completed and locked `targetDigest`. Reviewer cannot set `targetDigest`. | PASS (Unit P8-R03-001, E2E check) |
| **P8-R03-002** | `privilege-escalation-defense`| Renderer IPC strictly rejects self-registration of privileged roles (`QA_SECURITY`, `LEADER`, `ORCHESTRATOR`) with `ERR_UNAUTHORIZED_ACTION`. | PASS (Unit P8-R03-002, E2E check) |
| **P8-R03-003** | `authoritative-role-derivation`| `submitVote()` derives voter role authoritatively from backend registry, ignoring voter role claims. | PASS (Unit P8-R03-003, E2E check) |
| **P8-R03-004** | `test-only-task-graph-step` | `taskGraphStep` isolated to test harness (`testTaskGraphStep`); production IPC returns `ERR_UNAUTHORIZED_ACTION`. Test mode strictly enforces DAG scheduler `getRunnableNodes()`. | PASS (Unit P8-R04-001, E2E prematureStepDenied, Prod check) |
| **P8-R03-005** | `test-only-reviewer-registration` | `taskGraphRegisterReviewer` isolated to test harness; production IPC returns `ERR_UNAUTHORIZED_ACTION`. Registry is immutable from production renderer. | PASS (E2E fakeQaRegistrationDenied, Prod check) |

---

## 3. Real Windows Electron E2E Evidence (24/24 Checks)

From `reports/capability-evidence/ELECTRON_P8_E2E_EVIDENCE.json`:
```json
{
  "timestamp": "2026-10-19T20:49:04.915Z",
  "environment": "Real Windows Electron (Phase P8 Multi-Agent Task Graph & Consensus Engine)",
  "nodeEnv": "test",
  "results": {
    "pipelineCreateSuccess": true,
    "nodeCountIs5": true,
    "hasPlanNode": true,
    "hasImplementNode": true,
    "hasReviewNode": true,
    "hasFixNode": true,
    "hasVerifyNode": true,
    "validBoundaryAllowed": true,
    "invalidBoundaryDenied": true,
    "junctionEscapeDenied": true,
    "cycleDetectionEnforced": true,
    "fakeQaRegistrationDenied": true,
    "preApprovalDenied": true,
    "forgedVoteDenied": true,
    "prematureStepDenied": true,
    "staleDigestVoteDenied": true,
    "authenticVoteAccepted": true,
    "duplicateVoteDeduplicated": true,
    "runGraphSuccess": true,
    "graphStatusCompleted": true,
    "all5NodesCompleted": true,
    "consensusVotesRecorded": true,
    "requiredRoleApprovalVerified": true,
    "eventsEmitted": true
  },
  "allPassed": true
}
```

### Production Security Isolation Evidence (from `ELECTRON_R07_PROD_EVIDENCE.json`)
```json
{
  "suite": "UNION_BOT_ELECTRON_R07_PROD_EVIDENCE",
  "vectors": {
    "R07-A03": {
      "productionTestKillDisabled": true,
      "productionConfirmationDisabled": true,
      "productionTaskGraphStepDisabled": true,
      "productionTaskGraphRegisterReviewerDisabled": true
    }
  },
  "result": "PASS"
}
```

---

## 4. Comprehensive Verification Matrix

```text
========================================================================================
UNION BOT COMPREHENSIVE VERIFICATION SUITE — PHASE P8 GATE (ROUND R04)
========================================================================================
1. Monorepo TypeScript & Project Typecheck : PASS (0 errors across all workspaces)
2. Workspace UI Production Bundle (Vite)   : PASS (dist/index.html, 0.72 kB gzip: 0.44 kB)
3. Monorepo Unit & Integration Test Suites : PASS (223 TS tests + 16 Python tests)
   - packages/orchestrator/tests           : PASS (32/32 tests: 12 orchestrator + 20 task-graph)
   - packages/agent-codex tests            : PASS (9/9 tests pass)
   - packages/agent-antigravity tests      : PASS (9/9 tests pass)
   - tests/cross_compatibility.test.ts     : PASS (4/4 tests: 100% CJS/TS Schema Parity)
4. Windows Real Electron Subprocess E2E    : PASS (16 suites / tests pass, 0 failed):
   - R04 Gate Recovery & Frame Boundary    : PASS (3/3 tests)
   - R05 Gate Hard Kill & Replay Recovery  : PASS (3/3 tests)
   - R06 Gate Human Confirmation & Workers : PASS (1/1 test)
   - R07 Gate Atomic Consumption & Prod Mode: PASS (2/2 tests: prod isolation verified)
   - P3 Gate Live Dynamic Room & CAS       : PASS (2/2 tests)
   - P4 Gate Browser & Multi-session       : PASS (1/1 test)
   - P5 Gate Artifacts & MCP ToolHost      : PASS (1/1 test)
   - P6 Gate Native Codex Agent            : PASS (1/1 test)
   - P7 Gate Native Antigravity Agent      : PASS (1/1 test)
   - P8 Gate Task Graph & Consensus Engine : PASS (1.7s live subprocess, 24/24 checks)
5. Automated GUI Smoke Test Mode (--smoke) : PASS
6. Strict Secret Scanner Audit             : PASS (857 files scanned, 0 leaks, 0 unresolved)
========================================================================================
OVERALL STATUS: ALL 7 GATES PASS (Exit Code 0)
========================================================================================
```

---

## 5. Formal Request for Gate Sign-off

With all trust-boundary regressions from Round R03 (`P8-R03-004` and `P8-R03-005`) completely resolved, test capabilities strictly isolated from production, DAG scheduler runnable status enforced, 24/24 Electron capability checks verified, all 7 gates passing with exit code 0, and zero security or cost violations:

We respectfully submit this packet to the Technical Leader and request formal sign-off:

**`APPROVED — GO_P9`**

to authorize immediate commencement of **Phase P9: Web Provider Extensions & 6-AI Collaboration Integration** (ChatGPT, Gemini, Claude, DeepSeek web provider extensions, multi-account session management, and live collaboration orchestration).
