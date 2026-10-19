# Technical Leader Audit Verdict: Phase P8 Round R02

**Date:** 2026-10-20  
**Repository:** `https://github.com/wtrg/union-bot.git`  
**Commit Audited:** `2560282e2aada5fc1a0aff3a1c97477bf4815c4d`  
**Auditor:** Technical Leader (ChatGPT Web - "Ý tưởng AI Workspace")  
**Verdict:** **`CHANGES REQUIRED — P8 ROUND R02 CHƯA ĐƯỢC PHÊ DUYỆT GO_P9`**

---

## 1. Audit Summary & Acknowledgments

The Technical Leader audited commit `2560282`, TS/CJS sources, `REVIEW_PACKET_P8.md`, and Electron P8 E2E evidence.
- **Confirmed Positive Progress:**
  - `runGraph()` remediation state machine is confirmed working properly (`REVIEW` failure transitions to `REMEDIATING`, `FIX` dependencies are satisfied, `FIX` completion resets `REVIEW` to `PENDING`, clears votes, and updates code digest).
  - Synthetic approval has been completely removed from the execution path.
- **Identified Blockers (Round R02):**
  - Two critical trust-boundary blockers remain before Phase P8 can be signed off for `GO_P9`.

---

## 2. Critical Blockers to Resolve in Round R03

### Blocker P8-R02-001 — CRITICAL: Vote có thể tự thiết lập digest trước khi code tồn tại
- **Vấn đề:**
  - `submitVote()` currently allows binding `node.targetDigest = vote.reviewedDigest` if `!node.targetDigest`.
  - Reviewer should never be allowed to dictate `targetDigest`.
  - `targetDigest` must only be produced by completed upstream `IMPLEMENT` or `FIX` nodes.
  - If a `REVIEW` node does not yet have a locked `targetDigest`, any vote submission must be rejected fail-closed (e.g. `ERR_REVIEW_TARGET_NOT_READY`).
  - No pre-approval of non-existent code.

### Blocker P8-R02-002 — CRITICAL: Authorized reviewer registry vẫn tự cấp quyền qua renderer IPC
- **Vấn đề:**
  - `union-bot:task-graph-register-reviewer` allows arbitrary renderer IPC callers to register privileged roles (e.g. `QA_SECURITY`).
  - Fail-closed registry requirement: If a review node's graph has no authorized reviewers, voting is blocked completely (`ERR_UNAUTHORIZED_VOTER`).
  - Renderer cannot self-assign privileged roles (`QA_SECURITY`, `LEADER`) via public renderer IPC without trusted orchestration authority.
  - `submitVote()` should determine voter role directly from the trusted backend registry/session rather than trusting caller input.
  - Mandatory regression test: Self-registering fake QA via renderer IPC must be DENIED fail-closed.

---

## 3. Remediation Directives for Round R03
1. Add `ERR_REVIEW_TARGET_NOT_READY` error code to protocol schemas and CJS parity.
2. In `task-graph.ts` and `task-graph-service.cjs`:
   - In `submitVote()`: If `!node.targetDigest`, throw `ERR_REVIEW_TARGET_NOT_READY`.
   - Never allow `submitVote()` to set `node.targetDigest`.
   - If `authorizedReviewers` is empty or undefined, fail-closed (`ERR_UNAUTHORIZED_VOTER`).
   - Automatically derive `voterRole` from the trusted registry: `const auth = policy.authorizedReviewers.find(r => r.voterId === vote.voterId); vote.voterRole = auth.role;`
3. In Electron main IPC (`main.js`):
   - Protect `union-bot:task-graph-register-reviewer`: deny renderer attempts to register privileged reviewer roles (`QA_SECURITY`, `LEADER`) from untrusted renderer frames (`ERR_UNAUTHORIZED_ACTION`).
4. Update unit tests in `task-graph.test.ts` and E2E in `desktop-p8.test.js`:
   - Test `ERR_REVIEW_TARGET_NOT_READY` when voting before `IMPLEMENT` locks `outputDigest`.
   - Test renderer IPC registration denial for fake `QA_SECURITY`.
   - Test full real flow: create pipeline -> run IMPLEMENT -> locks digest -> authorized QA_SECURITY votes on real digest -> consensus reached -> FIX skipped -> VERIFY pass -> graph COMPLETED.
5. Pass all 7 verification gates in `scripts/verify.ps1`, commit, push, and submit Round R03 for final `APPROVED — GO_P9`.
