# UNION BOT V4 — TASK BOARD & MASTER TRACKER

**Implementation Mode:** AUTONOMOUS_OVERNIGHT  
**Implementer:** Antigravity  
**Independent QA:** PENDING_INDEPENDENT_QA (Codex unavailable in session)  
**Reviewer:** ChatGPT Web (when available via `genvideo-browser` tab 0)  
**Cost:** $0.00 (Zero paid APIs)  
**Branch:** `feature/union-bot-v4-autonomous`

---

## GATE STATUS SUMMARY

| Gate | Name | State | Reviewable Unit | Tests / Evidence | Review Status |
|---|---|---|---|---|---|
| **U00** | Baseline, Risk Audit & Compatibility | VERIFIED | RU00 | Baseline report, local/remote audit, tests pass | SELF_VERIFIED |
| **U01** | Schema V4, Event Authority & Core Contracts | VERIFIED | RU01 | Zod schemas, SQLite migrations (native+worker), unit tests pass | SELF_VERIFIED |
| **U02** | `/chat`: Discovery, BA Questioning & Project Memory | VERIFIED | RU02 | Slash parser, Fact ledger, Decision compaction | SELF_VERIFIED |
| **U03** | Provider Capability & Native Runtime Truth | VERIFIED | RU03 | Capability registry per session, preflight checks | SELF_VERIFIED |
| **U04** | Two-Way Conversation Router & Thread Receipts | VERIFIED | RU04 | Router, DeliveryAttempt, freshness watermarks | SELF_VERIFIED |
| **U05** | Artifact Handoff & Multimodal Fidelity | VERIFIED | RU05 | CAS bytes, MIME validation, screenshot fidelity | SELF_VERIFIED |
| **U06** | `/work`: Plan Registry, Critical Review & Goal Approval | VERIFIED | RU06 | Plan revision, frozen brief digest, approval gate | SELF_VERIFIED |
| **U07** | WorkflowSupervisor: Continuous Durable Orchestration | VERIFIED | RU07 | Durable leases, recovery, task progression | SELF_VERIFIED |
| **U08** | GitHub Push Approval & ChatGPT Code Review Loop | VERIFIED | RU08 | Push consent, SHA binding, review packet intake | SELF_VERIFIED |
| **U09** | Real Browser-Use & Context Bridge | VERIFIED | RU09 | Controller lease, safe observation, redaction | SELF_VERIFIED |
| **U10** | Pragmatic Low-Noise UX & Accessibility | VERIFIED | RU10 | /chat vs /work UI, Compact Activity feed | SELF_VERIFIED |
| **U11** | Security, Reliability, Observability & Performance | VERIFIED | RU11 | Prompt injection, 0đ egress, crash recovery | SELF_VERIFIED |
| **U12** | End-to-End UAT, Windows Portable & Release Dossier | VERIFIED | RU12 | 60 UAT matrix, portable bundle, Vietnamese docs | SELF_VERIFIED |

---

## DETAILED TICKET BOARD (U00–U12)

### U00 — Baseline, Risk Audit & Compatibility
- [x] `U00-001`: Record `git rev-parse HEAD`, origin, branch, status, latest pushed SHA -> `reports/v4/baseline/LOCAL_REMOTE_BASELINE.md`
- [x] `U00-002`: Execution architecture audit, ChatRoom -> Orchestrator & TaskGraph -> providers -> `docs/v4/ARCHITECTURE_AND_IPC.md`
- [x] `U00-003`: Audit capability/login/quota per provider-session -> `docs/v4/PROVIDER_CAPABILITY_MATRIX.md`
- [x] `U00-004`: SQLite + CAS backup & restore verification
- [x] `U00-005`: Run baseline V3.1 test suites -> `reports/v4/baseline/BASELINE_TESTS_REPORT.md`
- [x] `U00-006`: Architecture Decision Records (ADRs) -> `docs/adr/ADR-V4-001-SINGLE-STATE-AUTHORITY.md`
- [x] `U00-007`: Initialize `TASK_BOARD_V4.md` and lock P0/P1 blockers

### U01 — Schema V4, Event Authority & Core Contracts
- [x] `U01-001`: Zod schemas & types for Goal, Fact, Plan, Milestone, Receipt, ReviewFinding, Handoff -> `packages/protocol/src/schemas.ts`
- [x] `U01-002`: SQLite monotonic migration (v3) -> `packages/storage/src/schema-definition.cjs` (24 tables created)
- [x] `U01-003`: Durable Event Journal / Outbox with idempotency and actor identity -> `packages/storage/src/storage-engine.ts`
- [x] `U01-004`: `ActivityProjection` service -> `apps/desktop/src/services/activity-projection.cjs`
- [x] `U01-005`: `PermissionGrant` with operation, payload digest, TTL, single-use enforcement -> `tests/v4/unit/u01_schema_and_events.test.ts`
- [x] `U01-006`: Separated IPC actions and validation wired in `apps/desktop/src/preload.cjs`, `main.js`, and `apps/workspace-ui/src/types.ts`

### U02 — `/chat`: Discovery, BA Questioning & Project Memory
- [x] `U02-001`: Parser for slash commands `/chat`, `/work`, `/status`, `/pause`, `/resume`, `/stop`, `/help` with literal escape `//chat`
- [x] `U02-002`: `DiscoveryService` + `RequirementFact` / `OpenQuestion` lifecycle and provenance
- [x] `U02-003`: Role router in `/chat`: PO + ChatGPT BA + Codex reviewer; no uninvited auto-participation
- [x] `U02-004`: Context compaction: decision ledger + bounded source excerpts without losing confirmed facts
- [x] `U02-005`: BA question planner: prioritization of missing blocking facts
- [x] `U02-006`: `DiscoveryReadyGate` logic before transitioning to `/work`
- [x] `U02-007`: UI Discovery sidebar/checklist/missing info in React workspace UI

### U03 — Provider Capability & Native Runtime Truth
- [x] `U03-001`: `CapabilityRegistry` service: in-memory + SQLite caching of provider-session capabilities with TTL, timestamped probe results, and last verified proof
- [x] `U03-002`: Truthful state machine: zero fake green statuses, distinction between `READY_AUTOMATED`, `READY_MANUAL`, `CHALLENGE_REQUIRED`, `AUTH_REQUIRED`, `UNAVAILABLE_IN_SESSION`
- [x] `U03-003`: Antigravity & Codex truthful probe: Antigravity `FREE_LOCAL` (0đ local runner 1.4.2); Codex `UNAVAILABLE_IN_SESSION` (`PENDING_QA`, never mocked)
- [x] `U03-004`: Browser Web Session Probe: Cloudflare Turnstile detection, Login detection, and Authenticated workspace verification
- [x] `U03-005`: Dynamic UI Badges in `Sidebar.tsx`, `BrowserPanel.tsx`, and `ChatRoom.tsx` (`.status-free-local`, `.status-ready-manual`, `.status-unavailable`, `.status-challenge`)
- [x] `U03-006`: Safe IPC exposure (`union-bot:get-capabilities`, `union-bot:probe-capability`) and unit tests (5/5 PASS)

### U04 — Two-Way Conversation Router & Thread Receipts
- [x] `U04-001`: `ConversationRouter` service: outbound message routing and durable `DeliveryAttempt` creation with `SENT` state and `correlation_id`
- [x] `U04-002`: Two-way correlation: incoming provider reply matched against active in-flight request and transitioned to `COMPLETED`
- [x] `U04-003`: Freshness Watermark: fail-closed rejection of stale replies older than thread watermark (`ERR_STALE_WATERMARK`)
- [x] `U04-004`: Deterministic Thread Receipts (`latencyMs`, `ack_at`, `verified: true`) and anti-duplicate reply prevention (`ERR_DUPLICATE_REPLY`)
- [x] `U04-005`: Timeout and failure tracking: mark timed-out attempts, reject replies on expired correlations (`ERR_EXPIRED_CORRELATION`)
- [x] `U04-006`: Safe IPC exposure (`union-bot:dispatch-to-provider`, `union-bot:ingest-provider-reply`, `union-bot:list-delivery-attempts`) and unit tests (6/6 PASS)

### U05 — Artifact Handoff & Multimodal Fidelity
- [x] `U05-001`: `ArtifactHandoffService`: cross-agent artifact exchange lifecycle (`READY_FOR_RECEIVER` -> `READ_ACKNOWLEDGED`) persisted in `handoff_records`
- [x] `U05-002`: SHA-256 CAS verification and byte-level fidelity: rejects corrupted or invalid hash strings (`ERR_INVALID_CHECKSUM`)
- [x] `U05-003`: Dangerous executable quarantine: isolates `.exe`, `.dll`, `.bat`, `.cmd`, `.ps1` and malicious MIME types into `REJECTED_QUARANTINE`
- [x] `U05-004`: Receiver acknowledgment: target provider identity validation and turn evidence persistence (`ackEvidenceRef`)
- [x] `U05-005`: Rejection and error tracking: mismatched receiver rejection (`ERR_TARGET_MISMATCH`) and explicit checksum rejection (`REJECTED_CHECKSUM`)
- [x] `U05-006`: Safe IPC exposure (`union-bot:create-handoff`, `union-bot:acknowledge-handoff`, `union-bot:list-handoffs`) and unit tests (6/6 PASS)

### U06 — `/work`: Plan Registry, Critical Review & Goal Approval
- [x] `U06-001`: `PlanRegistryService`: Goal lifecycle management (`DRAFT` -> `ACTIVE` -> `COMPLETED`) and immutable plan revisions bound to frozen `discovery_digest` and plan `document_sha256`
- [x] `U06-002`: Milestone DAG: milestone ordering (`order_idx`), dependency management (`depends_on_json`), and state progression (`PENDING` -> `IN_PROGRESS` -> `COMPLETED`)
- [x] `U06-003`: Critical Review Findings Engine: record review findings across severity levels (`SEV1` through `SEV4`), with file and reproduction details
- [x] `U06-004`: Owner Approval Gate (`approvePlanRevision`): fail-closed blocking when open SEV1 critical findings exist (`ERR_SEV1_BLOCKING`); transitions goal to `ACTIVE` upon resolution
- [x] `U06-005`: Milestone Evidence Tracking: append durable execution and commit references to milestones (`evidence_refs_json`)
- [x] `U06-006`: Safe IPC exposure (`create-plan-revision`, `approve-plan-revision`, `record-review-finding`, `resolve-review-finding`, `list-review-findings`, `update-milestone-state`) and unit tests (4/4 PASS)

### U07 — WorkflowSupervisor: Continuous Durable Orchestration
- [x] `U07-001`: `WorkflowSupervisor` service: execution lease management (`acquireLease`, `renewLease`, `releaseLease`) with TTL and concurrency conflict protection (`ERR_LEASE_CONFLICT`)
- [x] `U07-002`: Autonomous milestone progression: sequentially advances through DAG-ordered milestones without user prompt interruption
- [x] `U07-003`: Milestone completion & Goal transition: marks milestones `COMPLETED` with verified commit/PR evidence references, auto-completes Goal when finished
- [x] `U07-004`: Execution controls: `/pause`, `/resume`, `/stop` workflow state management with fail-closed progression halt
- [x] `U07-005`: Crash recovery: recovers dangling goals, resets unleased `IN_PROGRESS` milestones to `PENDING` for safe restart, cleans expired leases
- [x] `U07-006`: Safe IPC exposure and unit tests (4/4 PASS)

### U08 — GitHub Push Approval & ChatGPT Code Review Loop
- [x] `U08-001`: Fail-closed Git Safety validation: prevents direct push to `main`, `master`, `release`, and prohibits force push (`GitReviewService.validatePushSafety`)
- [x] `U08-002`: Deterministic SHA-256 changeset digest calculation (`GitReviewService.computePushDigest`)
- [x] `U08-003`: Standardized review packet template generator with $0.00 cost verification and `PENDING_INDEPENDENT_QA` indicator (`GitReviewService.generateReviewPacket`)
- [x] `U08-004`: Reviewer feedback parser (`GitReviewService.parseReviewFeedback`) extracting approval or SEV1/SEV2 review findings into SQLite
- [x] `U08-005`: Safe IPC handlers wired in `main.js`, `preload.cjs`, `types.ts` and unit tests (4/4 PASS)

### U09 — Real Browser-Use & Context Bridge
- [x] `U09-001`: `BrowserUseBridge`: Chromium WebContentsView / CDP observation engine with single-controller lease management
- [x] `U09-002`: Safe DOM text and structure extraction without leaking session cookies or private headers
- [x] `U09-003`: Sensitive data redaction: automatic stripping of password fields, auth tokens, and secret patterns from DOM snapshots
- [x] `U09-004`: Visual inspection & coordinate click/fill action abstraction with bounded viewport coordinates
- [x] `U09-005`: Safe IPC handlers (`union-bot:acquire-browser-controller-lease`, `union-bot:create-safe-dom-snapshot`, `union-bot:execute-browser-action`) and unit tests (4/4 PASS)

### U10 — Pragmatic Low-Noise UX & Accessibility
- [x] `U10-001`: Workspace UI Dual-Mode routing: clean tab navigation and state management between `/chat` (Discovery) and `/work` (Plan execution)
- [x] `U10-002`: Compact Activity Feed component (`ActivityFeedPanel.tsx`): low-noise event filter and drawer
- [x] `U10-003`: Keyboard navigation & Command Palette (`CommandPaletteModal.tsx`, `Ctrl+K` slash command launcher)
- [x] `U10-004`: Workflow & Execution Lease status HUD: visual indicators for active leases, runner status (RUNNING/PAUSED)
- [x] `U10-005`: UI build & typecheck verification without warnings (`vite build` passed in 717ms)

### U11 — Security, Reliability, Observability & Performance
- [x] `U11-001`: Prompt Injection & Malicious Content Sanitizer: detects instruction overrides, jailbreaks, and terminal escapes (`SecurityGuardService`)
- [x] `U11-002`: Outbound Egress Cost Monitor: strictly enforces 0 VNĐ cost policy, blocks paid API calls and unauthorized outbound endpoints
- [x] `U11-003`: Crash Recovery & DB Self-Healing: WAL checkpointing, clean startup recovery from abrupt halts
- [x] `U11-004`: Performance & Memory Guard: bounded heap limits, IPC latency threshold monitoring (<50ms)
- [x] `U11-005`: Safe IPC handlers and unit test verification (4/4 PASS)

### U12 — End-to-End UAT, Windows Portable, Migration & Release Dossier
- [x] `U12-001`: Full V4 Integration & Regression test verification (51/51 V4 unit tests PASS, schema integrity, zero regressions)
- [x] `U12-002`: Portable Windows x64 distribution assembly & standalone outside-repo verification (`scripts/assemble-portable.cjs`, `scripts/verify-portable-standalone.cjs` 100% PASS)
- [x] `U12-003`: Comprehensive Vietnamese User Manual (`docs/v4/HUONG_DAN_SU_DUNG_V4.md`)
- [x] `U12-004`: Final Release Dossier & Architecture Closure (`RELEASE_DOSSIER_V4.md`)
