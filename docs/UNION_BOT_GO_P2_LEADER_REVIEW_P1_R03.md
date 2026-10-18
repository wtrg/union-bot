# UNION BOT — INDEPENDENT LEADER REVIEW P1 R03 & GO_P2 DIRECTIVE

**Dự án:** Union Bot | **Reviewer:** ChatGPT — Technical Leader / Independent Reviewer  
**Repository:** https://github.com/wtrg/union-bot  
**Branch:** `main`  
**Reviewed HEAD:** `d4ea25a818c2796816298128a302eaea68a6c945`  
**Fix commit:** `b63e6227fc090f6aba6e061094ea4a8764d418d2`  
**Baseline reviewed:** `319a873ddd630fc329df43115e293af3b8162509`  
**Decision:** **`P1_ACCEPTED_WITH_CARRYOVER → GO_P2`**  
**Scope of authorization:** May implement P2. Not a production-security approval; do not enable live high-privilege tools or unattended multi-provider automated posting based on this approval.

## 1. Verification provenance

- Independently accessed GitHub commit history, tree (107 tracked files), exact sources, diff metadata, tests and handoff packet at reviewed SHA. Both HEAD and fix SHA are valid and reachable; main points at reviewed HEAD at review time.
- **Source-verified** means source assertions and test code read, **not** code execution on Windows.
- Team reports `59/59` Node/TS + `16/16` Python unit tests, typecheck/build, Electron Windows smoke and strict secret scan passed. Reviewed the source definitions and checked the test breakdown, but **did not independently execute the whole suite or GUI** in this session. `ELECTRON_GUI_SMOKE_EVIDENCE.json` is team-generated evidence; GitHub combined commit status supplies no independent CI status.
- No remote write, push, merge, release, account login or change to source was performed by the reviewer.

## 2. P1 R02 issue closure audit

| Ticket | Source evidence at `d4ea25a` | Assessment |
|---|---|---|
| `P1-R02-01` | `apps/workspace-ui/src/App.tsx` adds `traceId`, sender kind `user`, recipient and stops optimistic append on rejected IPC; `src/types.ts` updated | **PASS P1**; duplicate render path remains carryover C01 |
| `P1-R02-02` | `scan_secrets.py` has only entries with SHA256 lists and `is_allowlisted_fixture` rejects empty/missing digest; added Python test | **PASS** for specified allowlist weakness; scanner still heuristic rather than proof of no secrets |
| `P1-R02-03` | `apps/desktop/src/orchestrator.cjs` denies renderer-submitted sender kinds other than `user` / `human`, or non-USER roles; desktop tests cover attempted `LEADER` and `QA_SECURITY` impersonation | **PASS P1**; source WebContents validation and sender binding belong to P2 |
| `P1-R02-04` | `orchestrator.cjs` no longer hardcodes cost 0 and invokes `AdmissionPolicyGate` with declared/unknown cost; test asserts missing cost is denied | **PASS** for unknown cost; do not trust sender-declared zero cost to authorize execution (C02) |
| `P1-R02-05` | `tests/cross_compatibility.test.ts` covers 5 enum comparisons, 7 envelope vectors and 4 admission vectors | **PASS for measured vectors**; not a proof of 100% semantic parity (C04) |
| `P1-R02-06` | `apps/desktop/src/main.js` smoke uses `webContents.executeJavaScript` to call preload IPC, confirms ACK, history and spoof rejection; generated JSON has `ipcRoundtripVerified: true`, `rendererSpoofingBlocked: true` | **PASS P1 with team-executed evidence**; test does not click React composer (C01/C03) |

## 3. Bắt buộc đưa vào P2 — carryover and acceptance tests

### C01 — S2 — Duplicate chat display from successful send

**Evidence:** `apps/desktop/src/main.js` IPC handler publishes `union-bot:envelope-received` to the renderer after successful dispatch. `apps/workspace-ui/src/App.tsx` adds the same envelope inside `onEnvelopeReceived` and again after the `dispatchEnvelope()` promise resolves. The same message may be rendered twice in Electron. `ChatRoom.tsx` also clears the input before the async ACK resolves, so a failed send loses the visible draft.

**Fix:** Make the renderer's view derived from one authoritative event/history stream. Use `envelope.id` deduplication in the projection, and ensure the ACK is a receipt, **not** a second message event. Preserve or restore the draft on NACK, timeout or process failure; show explicit `pending/acknowledged/failed/unknown` states. Store idempotency keys across restarts as part of `P2-005`.

**Regression:** Send one message using actual composer; exactly one visible item and one durable event after ACK. Repeat `envelope-received`, return an ACK, switch rooms while ACK pending, double-click Send, restart process and replay event; still no duplicates or hidden losses. NACK retains/restores the draft.

### C02 — S1 BEFORE TOOL EXECUTION — Untrusted action payload and estimatedCost

**Evidence:** `apps/desktop/src/orchestrator.cjs` reads `part.input.estimatedCost` or `part.estimatedCost` from an inbound action and passes it to AdmissionPolicyGate. Sender-controlled `estimatedCost: 0` can pass an admission decision if schema/provider also match. This **does not mean tools execute today**; the current dispatcher only records messages. It becomes dangerous when execution is connected later. `part.input` is untrusted.

**Fix:** Until approved tool execution architecture exists, **reject `action` parts from ordinary renderer messages** (or record them solely as untrusted user text/requests, never `completed` events). Let only a trusted local action registry set cost/authorization policy from authoritative metadata. Bind permission token to normalized action payload hash, expiry, origin and consumption; require explicit user approval for side effects. Implement `P2-002`, `P2-006`, `P2-008` before enabling agent tools. Never treat UI claim `status=completed` as a verified tool result.

**Regression:** Forged renderer action with `estimatedCost: 0`, `status: completed` and malicious tool name must not be recorded as a trusted completed event or dispatched. Unknown-cost/local/paid tools denied. Tampered/stale/consumed approvals denied.

### C03 — S2 — IPC origin, renderer identity binding, full user-flow smoke

**Evidence:** `apps/desktop/src/main.js` IPC `dispatch-envelope` and `get-room-history` handlers do not presently check `event.senderFrame`/expected webContents identity or bind sender ID to app context. The current smoke uses injected JavaScript to call the preload API; it does not click/type in the React composer.

**Fix:** Implement an explicit channel registry, sender-frame URL/origin allowlist and webContents association. Assign local user identity **in main**, not from renderer-supplied IDs. Keep preload exposure minimal. Add a Chromium/Electron UI action test of typing and pressing Send and receiving one authoritative reply/receipt. This is `P2-002` and P3 UI QA.

**Regression:** Unknown frame/window/origin IPC denied; fake `sender.id` normalized/rejected; valid UI send accepted; room history correctly isolated.

### C04 — S2 — Duplicate CJS/TS business logic and parity scope

**Evidence:** Desktop `apps/desktop/src/orchestrator.cjs` duplicates the schemas and policy/dispatch implementation in `packages/protocol` and `packages/orchestrator` instead of importing the canonical package. The 3 parity tests cover finite vectors but cannot establish behavioral equivalence for all inputs or future changes.

**Fix:** P2 should build and load a **single canonical protocol/orchestrator distribution** from Electron main where feasible, or generate CJS from a single maintained source. Keep parity tests as regression; add sender-context, action policy and malformed message vectors. Maintain one versioned `Envelope` contract (`P2-001`).

### C05 — S2 — Exactly-once event and crash recovery gate

**Evidence:** Both current orchestrators store room histories in memory, and `dispatchEnvelope` appends every accepted envelope; same ID replay duplicates state. This is not a P1 failure but is central to P2.

**Fix:** `P2-003` SQLite WAL + migrations, `P2-004` append-only event journal/rebuild, `P2-005` idempotent outbox + correlation. On ambiguous dispatch after crash classify `UNKNOWN/REVIEW_REQUIRED` rather than replay external side effects automatically. Prove kill/restart and 10k-event paging.

### C06 — S3 — Verification/toolchain and dashboard bookkeeping

**Evidence:** Root scripts include `typecheck`, `build`, `test`, `smoke:gui`, and `secret-scan`; no independent `lint` script in checked `package.json`, although original P1 gate references lint. `TASK_BOARD.md` overview still says 33/159 (20.8%) and the P2 table says 10 tickets, while the V3.0 P2 matrix contains at least `P2-001` through `P2-012`. The round-specific team test count, 75, is consistent with declared suites; CI checks were not independently observed.

**Fix:** Add fail-closed lint/static security checks and, ideally, GitHub Actions verification on commits/PRs (without secrets). Reconcile board with actual scope, mark P1 gate approved at reviewed SHA, and distinguish raw ticket count, acceptance and overall product readiness. Preserve historical baselines rather than overwriting them.

**Regression:** Clean clone `pnpm install --frozen-lockfile`; typecheck/build/lint/test + Windows smoke pass. An intentionally invalid lint/test fails CI. TASK_BOARD totals reconcile with canonical plan after change.

## 4. P2 scope and sequencing

Prioritize order:

1. **Security/contract preflight:** freeze versioned `Envelope` and IPC registry; sender binding, origin checks, reject untrusted tool actions by default; source parity, no silent `any` at boundaries.
2. **Persistent core:** SQLite WAL/foreign keys/migrations, append-only journal with durable writes, snapshot/projection rebuild, back up and restore, storage isolation/realpath checks.
3. **Reliable delivery:** event IDs and correlation, outbox/idempotency, receipt and recovery state machine; duplicate UI and double-send regression.
4. **Policy & authorization:** action registry with trusted cost metadata, user approval token and user confirmation, quotas and cost denial before actual execution.
5. **QA gate:** clean-install Windows GUI flow (actual composer), restart/kill replay, migration rollback/corruption tests, 10k events/paging, hostile IPC and renderer input tests, security/secret scan, recorded true exit codes.
6. **P2 handoff:** `REVIEW_PACKET_P2_R01.md` with exact SHA, diff, test commands/raw output, Windows GUI evidence, accepted/failed UAT, issue cross-references and unresolved risks. Codex runs independent QA; ChatGPT review follows.

**Scope warning:** The user-facing P2 briefing mentions 10 tickets; V3.0 has `P2-001`–`P2-012`. Reconcile this discrepancy in the task board; do not silently delete `P2-011` error taxonomy or `P2-012` event paging unless a Product Owner-approved scope change is documented.

## 5. Acceptance criteria for GO_P3

- Fresh-install database opens in WAL; versioned upgrade+rollback/backup verified.
- After simulated hard kill, room history projections rebuild identically; no duplicate final result or external dispatch on replay.
- Renderer-origin/user identity cannot be forged into system, agent or trusted tool output; unknown IPC channels denied.
- Zero-cost policy defaults deny unknown cost; billing API and unauthorized tool execution cannot occur in test.
- Duplicate client events and ACKs render once; NACK and unknown state visibly distinguished; drafts retained on failure.
- Backup/restore and diagnostic exports omit credentials/cookies/raw session values; negative security tests included.
- Typecheck/build/lint/tests pass on clean environment; Windows Electron UI integration evidence is reproducible.

## 6. Final decision

**`GO_P2` is granted at `d4ea25a818c2796816298128a302eaea68a6c945` with carryovers C01–C06.** Six P1 R02 findings have corresponding source fixes suitable for P1 closure. Outstanding issues, especially C02/C03, **must be closed before enabling real agent/tool execution or before GO_P3**. No claim of complete security, live six-provider automation, paid API total egress prevention or finished Windows product is authorized by this decision.

*This document is issued in the current conversation only. No GitHub files were created, changed, pushed, merged or released by the reviewer.*