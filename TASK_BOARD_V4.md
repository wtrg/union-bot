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
| **U06** | `/work`: Plan Registry, Critical Review & Goal Approval | IN_PROGRESS | RU06 | Plan revision, frozen brief digest, approval gate | PENDING_REVIEW |
| **U07** | WorkflowSupervisor: Continuous Durable Orchestration | QUEUED | RU07 | Durable leases, recovery, task progression | PENDING_REVIEW |
| **U08** | GitHub Push Approval & ChatGPT Code Review Loop | QUEUED | RU08 | Push consent, SHA binding, review packet intake | PENDING_REVIEW |
| **U09** | Real Browser-Use & Context Bridge | QUEUED | RU09 | Controller lease, safe observation, redaction | PENDING_REVIEW |
| **U10** | Pragmatic Low-Noise UX & Accessibility | QUEUED | RU10 | /chat vs /work UI, Compact Activity feed | PENDING_REVIEW |
| **U11** | Security, Reliability, Observability & Performance | QUEUED | RU11 | Prompt injection, 0đ egress, crash recovery | PENDING_REVIEW |
| **U12** | End-to-End UAT, Windows Portable & Release Dossier | QUEUED | RU12 | 60 UAT matrix, portable bundle, Vietnamese docs | PENDING_REVIEW |

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
