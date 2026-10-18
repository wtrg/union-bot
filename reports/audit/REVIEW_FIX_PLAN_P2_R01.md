# UNION BOT — INDEPENDENT LEADER REVIEW & FIX PLAN P2 R01

**Review verdict:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_DESIGN_AND_NON_MUTATING_SCAFFOLD_ALLOWED`  
**Repo:** https://github.com/wtrg/union-bot  
**Reviewed main HEAD:** `080ab539e2674428c714dae59c5ca381b8b909c4`  
**Baseline:** `d4ea25a818c2796816298128a302eaea68a6c945`  
**Review scope:** 12 P2 tickets, P1 carryovers C01–C06, GitHub source and team handoff `reports/handoff/REVIEW_PACKET_P2_R01.md`.  
**Reviewer:** ChatGPT Web / Technical Leader — source-based static review and targeted independent Node.js reproducer; **no independent full Windows Electron execution**.  
**Status of team evidence:** 95/95 tests PASS, Windows GUI smoke PASS, secret scan PASS **as claimed by Antigravity/Codex**; these claims are not treated as reviewer-executed tests.

## 1. Executive decision

Source code materially progressed: the repository now contains `@union-bot/storage` with SQLite `DatabaseSync`, WAL configuration, migrations, event journal, idempotency, approval tokens, backup, workspace path validation, paging, and additional schema/test files. GitHub HEAD exactly matches the submission SHA.

**P2 gate is not met.** The specific blocking promises — explicit human approval, no duplicate side-effect dispatch, atomic replayable durable state after crash, and safe backup — fail source-level review. The most urgent failures are a `PENDING` approval consumable as if approved and a canonical payload hash that does not bind nested fields. The shipping Electron code still runs a separate in-memory CJS orchestrator with no connected SQLite engine. A green count of unit tests cannot overrule these counterexamples.

**No push, merge, secrets, real-account login, paid API call, or live side-effect execution was performed by the reviewer.** The implementation team must make any source changes and supply the new SHA and evidence.

## 2. Verified baseline and evidence distinctions

- GitHub: `main` = `080ab539e2674428c714dae59c5ca381b8b909c4`; comparison to P1 has 1 additional commit containing actual P2 source; tree has 121 tracked blobs.
- `packages/storage/tests/storage.test.ts` declares **9 test cases**, predominantly single-process positive paths (including orderly `storage.close()` and reopen). It **does not** demonstrate OS kill during an external dispatch, a torn migration, or approval state separation.
- The handoff claims 79 Node/TS + 16 Python = 95 PASS, GUI smoke exit 0, secret scan 751 files. These remain **team-executed evidence**, not reviewer-executed confirmation.
- `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json` is the desktop IPC smoke; it does **not** demonstrate an actual disk-backed app restart.
- The package `scripts/verify.ps1` still prints a stale '75 Unit Tests' summary (and 59 TS in its step header). `package.json` has updated scripts; reconcile both.

## 3. Findings, fixes, and regression contracts

### UB-P2-R01-001 — S0 / BLOCKER: Approval token `PENDING` can be consumed before PO approval

**Evidence:** `packages/storage/src/approval-gate.ts:72–132`. `createToken()` inserts `PENDING` but `validateAndConsume()` allows `PENDING` **or** `APPROVED`. The test at `packages/storage/tests/storage.test.ts:180–215` explicitly creates PENDING then consumes it with no human approve step.

**Fix:** implement an explicit trust-boundary-checked `approve(tokenId, approverIdentity, decisionContext)`, `reject(...)`, and `validateAndConsume()` must accept **only APPROVED**. Bind to verified approver, action type, workspace/project/room, recipient, payload digest, expiry, policy revision; never infer approval from a renderer-supplied flag. Use a conditional single SQL UPDATE `... WHERE status='APPROVED' AND expires_at > current_time AND payload_digest = ...` and assert `changes === 1`; do not allow two workers to consume the same token. Keep audit transitions in the same durable transaction. Allow `PENDING → APPROVED/REJECTED/EXPIRED → CONSUMED` (APPROVED → CONSUMED only).

**Regressions:** Pending token rejects; rejected token rejects; expired token rejects; copied token with different target/recipient rejects; two concurrent consumers yield exactly one winner; crash after consume before side effect becomes reconciliation, never automatic new approval.

### UB-P2-R01-002 — S0 / BLOCKER: Canonical JSON hash collides on nested payload fields

**Evidence:** `packages/storage/src/approval-gate.ts:32–35`: `JSON.stringify(payload, Object.keys(payload as any || {}).sort())` is an **array replacer**, which whitelists property names at every nesting level, not recursive key sorting. In an independent Node.js v22.16.0 reproducer, both `{tool:'write', params:{path:'safe.txt',overwrite:false}}` and `{tool:'write', params:{path:'sensitive.txt',overwrite:true}}` serialize to `{"params":{},"tool":"write"}` and both hash to `c300158a51ced3fd7b268e82512c615bb59d36b8044e7c007d8cc291419d5962`.

**Fix:** implement tested recursive deterministic canonicalization (e.g. stable object-key sorting recursively, preserving arrays and all nested values; reject cycles, NaN, Infinity, unsupported types, prototype pollution/unbounded depth). Hash bytes from a versioned canonicalization algorithm and include the full action intent envelope (tool, exact args, target, approver scope, requested actor, policy version). Use immutable canonical payload for preview, approval, consumption and audit. If existing tokens were issued, expire/invalidate them with a migration-safe version bump.

**Regressions:** Mutating any nested property changes digest; object property reordering does not; arrays remain ordered; nested arrays of objects are covered; `null`, booleans, Unicode, path, and file digest differ appropriately.

### UB-P2-R01-003 — S1 / BLOCKER: Real Electron IPC remains in-memory, not SQLite-backed

**Evidence:** `apps/desktop/src/main.js:29–33` constructs `new Orchestrator({ costGuard })`. `apps/desktop/src/orchestrator.cjs:385–516` manages `roomHistories: Map`, `seenEnvelopeIds: Set`, `approvalTokens: Map`. No persistent `StorageEngine` is passed, unlike `packages/orchestrator/src/orchestrator.ts:64–70` where storage is optional. The Electron GUI smoke tests dispatch/ACK/history **within the same process**, not after restart. This does not close carryover C05 in the product path.

**Fix:** wire one canonical storage service under `app.getPath('userData')` with correct per-workspace isolation, lifetime and cleanup; have desktop main dispatch, history and approval all use the **same durable engine** as canonical modules. Prefer eliminate separately maintained CJS policy/store implementation or generate it from single source. Before declaring persistence, implement restart recovery and compare roundtrip of message ID, origin, parts, status, ordering, session and privacy. Handle migration failure as an actionable UI error; do not silently fall back to `Map` while claiming persistence.

**Regressions:** Windows Electron user types into UI → ACK → close process → relaunch → history exact once. Two rooms isolation; duplicate ID after restart returns cached status; malicious senderFrame blocked; disk-path exists in userData and not repo.

### UB-P2-R01-004 — S1 / BLOCKER: Event, envelope, outbox and idempotency not committed atomically

**Evidence:** `packages/orchestrator/src/orchestrator.ts:130–239` acquires idempotency key, later separately calls `storage.insertEnvelope()` and `eventStore.appendEvent()`, then updates in-memory projection and finally calls `idempotency.complete()`. Each method performs independent SQLite statements. A crash/exception between writes leaves `PENDING` key or envelope/event mismatch. `EventStore` append has no stable external event ID supplied by caller.

**Fix:** a **single transaction** for relevant local durable mutations (idempotency decision + envelope row + append event + outbox record + completion/ack state). Do not hold an SQLite transaction across external network/process side effects. Record `DISPATCH_PREPARED` before sending to provider; if crash after send with unknown ACK, mark `UNKNOWN_NEEDS_RECONCILIATION` with evidence, not FAILED or retryable. Unique `(producer/session/providerEventId)` and deterministic dedupe/constraints should enforce replay safety. Define durable commit boundaries and success vs ACK vs verified result.

**Regressions:** Fault injection after every write step and reopen from disk; all-or-none for local state; no duplicated external dispatch on replay; no “ACK successful” for half-persisted work.

### UB-P2-R01-005 — S1 / BLOCKER: UNKNOWN outbox entries selected as pending retry candidates; idempotency TTL can authorize replay

**Evidence:** `packages/storage/src/idempotency.ts:130–139` selects status `IN ('QUEUED','UNKNOWN_NEEDS_RECONCILIATION')`; generic worker consuming pending records could replay an ambiguous external side effect. `:54–84` deletes an expired key and re-registers as PENDING without checking unresolved external dispatch, and `FAILED` can fall through to re-registration. `complete()/fail()` update with no state precondition/rows-changed verification.

**Fix:** reserve dequeue of new dispatches to `QUEUED` only; create a separate read-only/manual reconciliation query for UNKNOWN. For side effects, expiration must not erase evidence or make a new send eligible. Add durable dispatch attempt identity, `payload_digest`, provider session/turn ID, lease ownership, monotonic state transition and conditional CAS update. Treat ambiguous provider replies and crashes as UNKNOWN until confirmed. Retain tombstone/dedupe for a defined retention policy.

**Regressions:** Mark item UNKNOWN → dispatch polling must not return it; restart after send-before-ACK → no automatic send; same idempotency key with changed payload denied; expired unresolved attempt never resent; parallel workers exactly one claim, and `rowsChanged=1` checked.

### UB-P2-R01-006 — S1 / BLOCKER: Migrations are not transactional and version integrity is not checked

**Evidence:** `packages/storage/src/migrations.ts:175–205` calls `m.up(db)` then inserts migration tracker, with no explicit transaction; DDL can be committed before tracker insert. `schema_migrations` has no checksum despite master contract; future or unknown versions are not explicitly rejected. `rollbackMigration()` also calls `down()` then tracker DELETE without transaction, and migration v1 `down` is destructive.

**Fix:** run each migration and its tracking insert in one SQLite transaction, with known version/name/checksum and reject unknown/future/modified migration definitions. For destructive rollback require an explicit pre-upgrade backup and independent verification; prefer forwards-only compensating migrations for user data. Test real interrupted migration (fail after a few CREATE/ALTER operations). Enforce `PRAGMA foreign_keys=ON` on every DB connection and verify WAL mode.

**Regressions:** Inject throw mid migration → zero partial schema; reopen retries correctly; modified checksum rejected; future DB version opens read-only or refuses; rollback preserves data via verified backup.

### UB-P2-R01-007 — S1 / BLOCKER: Backup/restore and diagnostic assertions overstate guarantees

**Evidence:** `packages/storage/src/backup-manager.ts:39–56` uses `PRAGMA wal_checkpoint(TRUNCATE)` and constructs SQL string `VACUUM INTO '${backupFile.replace(/\\/g,'/')}'`; a destination path containing `'` can break SQL (and string-built SQL must not accept untrusted input). Backup file and manifest are written directly, not through temp+fsync+atomic-rename with recovery. `restore():68–101` verifies hash then `fs.copyFileSync` directly over destination; this is not atomic rollback and may leave partial/overwritten database. `exportRedactedDiagnostics():106–129` returns raw `rooms` IDs/names and a limited regex sanitizer; cannot claim **zero PII**.

**Fix:** use supported SQLite backup facility or safe `VACUUM INTO` with correct SQL escaping/parameter approach; file output to controlled temp path on same volume, manifest schema validation, hash, fsync/rename for final backup; restore to new temp, `PRAGMA integrity_check`, supported schema/version validation, then deliberate replacement with durable rollback plan while original DB is closed/locked appropriately. Export aggregates by default: omit room names, IDs, payloads and provider URLs unless PO explicitly chooses a redacted diagnostic profile. Do not write raw secrets to logs.

**Regressions:** WAL concurrent write during backup; crash mid copy leaves original untouched; target existing DB intact on bad manifest; backup path containing apostrophe works safely; invalid schema hash/version rejects; diagnostics with room name containing email, token-like string and personal name excludes the value.

### UB-P2-R01-008 — S1 / BLOCKER: IPC origin validation permits untrusted data: documents and missing frames

**Evidence:** `apps/desktop/src/main.js:240–272` permits any `senderFrame.url` beginning with `data:text/html`, originally for offline fallback, and **skips rejection altogether** when `event.senderFrame` or URL is absent. The IPC service trusts `context.fromRenderer` but not the actual `event.sender` identity/main frame after validation.

**Fix:** allow only the main Window's expected `webContents.id` plus exact registered UI frame/origin; fail closed on null/missing frame and non-main frame. If offline diagnostic data URL is truly necessary, register one exact one-time internal document token or make it read-only and disable mutation IPC. Restrict `getRoomHistory` per workspace/room trust scope. Prove denial from hostile iframe/data URL, other window, missing frame and after navigation.

**Regressions:** Fake event without senderFrame denied; arbitrary `data:text/html` denied; only known UI frame allowed; stale frame navigated away denied; smoke runs in genuine bundle, not only fallback.

### UB-P2-R01-009 — S1 / BLOCKER: Provider/fidelity/schema defaults can fabricate capability and lose attribution

**Evidence:** `packages/protocol/src/schemas.ts:47–55` defines `RAW_BINARY`, `SEMANTIC_INTERACTIVE`, `STRUCTURED_DOC`, `VECTOR_EMBEDDING`, `LOSSLESS_EXPORT`, `LOSSLESS_PREVIEW`, which **do not equal** the agreed six preservation labels from V3.1 (`original_bytes`, `structured_copy`, `rendered_preview`, `screenshot_only`, `external_reference`, `unavailable`). `ProviderIdentitySchema:96–99` defaults `authStatus='AUTHENTICATED'` and `evidenceProvenance='LOCAL_RPC'` with no evidence. `EnvelopeSchema:187–199` accepts arbitrary `schemaVersion: string` and defaults status to acknowledged; P2-001 claims future version rejection.

**Fix:** keep presentation L0–L3 separate from content preservation; introduce the exact six semantic provenance/fidelity outcomes or provide a versioned documented, lossless mapping (cannot call screenshot `LOSSLESS_PREVIEW`). Default provider readiness to `UNKNOWN/NOT_VERIFIED`; provenance to explicit `unverified`/manual origin, never assume authenticated/live. Reject unsupported/future schema versions at ingress and define verified compatibility/migration rules; make ACK dependent on actual durable store success, not schema default. Persist producer/profile/session/correlation/source evidence fields; do not conflate an imported artifact with provider bytes.

**Regressions:** Provider created without auth proof is not ready; screenshot cannot be marked original bytes; each of six fidelity states roundtrips, no missing transfer status; unknown schema version rejected; no fabricated agent response after import.

### UB-P2-R01-010 — S2 / SECURITY: Workspace path validator does not protect multi-level nonexistent descendants or races

**Evidence:** `packages/storage/src/workspace-validator.ts:52–79` resolves `realpath()` for the target or its **immediate** parent only. If intermediate parents do not yet exist, it validates lexical path without recursively resolving existing ancestors. Separate validate-then-open is susceptible to TOCTOU replacement of path segments. Current tests `storage.test.ts:217–237` cover traversal and null bytes, not an actual Windows junction/symlink scenario.

**Fix:** walk to deepest existing ancestor, canonicalize and verify each component/target against trusted root, reject reparse points/junctions where ownership uncertain. Recheck at the actual file operation using safe open semantics or scoped handles, not only a preliminary string check. Explicitly test NTFS junction/symlink creation, rename-between-check-and-open, UNC, drive-relative, ADS, trailing dots/spaces and reserved names on Windows.

### UB-P2-R01-011 — S2 / QA: Required P2 regressions not supplied; green counters overstate verification

**Evidence:** 9 tests in `packages/storage/tests/storage.test.ts` assert orderly close/reopen, self-issued PENDING token consumption and outbox happy path. There is no adversarial test of post-send crash, intentionally torn multi-write transaction, unknown state, self-approval rejection, or nested digest tampering. `scripts/verify.ps1` still displays 59 and 75 in progress summaries instead of 79 and 95; `lint` is an alias for typecheck + secret scan rather than ESLint/formatter. The GUI smoke currently exercises in-memory desktop state.

**Fix:** introduce scenario-based integration tests with subprocess hard-kill, multiple connections/workers, event-count checks and real Electron persistent IPC. Publish sanitized raw TAP/JUnit, exact test count, Node/SQLite/Electron versions and full SHA. Ensure all ticket acceptance gates map to at least one test. Performance measurements require a reproducible command, platform/hardware and separate insertion/query timings; don't call a single 10k-row query a crash-recovery test.

## 4. Mandatory test matrix for P2 R02 handoff

| Check | Scenario | Passing condition |
|---|---|---|
| P2-T01 | Create token in PENDING; try consume without approval | DENY, 0 effect |
| P2-T02 | Approve once; simultaneous consumptions | Exactly one succeeds, audited |
| P2-T03 | Change nested path/arguments under same approval | Digest differs; replay denied |
| P2-T04 | GUI text message; kill app; restart | Exactly one preserved envelope in history and journal |
| P2-T05 | Fault injection between envelope, event, outbox and ACK | Transaction is all-or-none for local data |
| P2-T06 | Crash after outgoing side-effect before ACK | UNKNOWN; **no** automatic resend |
| P2-T07 | Concurrent consumers & expired idempotency key | One dispatch; unresolved record cannot be recycled |
| P2-T08 | Migration fails mid-way | No partial schema; migration tracker consistent |
| P2-T09 | Unknown future schema/migration version | Explicit rejection (or read-only, never silent write) |
| P2-T10 | Backup during WAL activity; restore with corruption | Consistent recovery; original target intact on failure |
| P2-T11 | Backup path contains apostrophe / unusual Unicode | Safe backup without interpolation issue |
| P2-T12 | Diagnostics room name contains sensitive value | Value absent from exported diagnostics |
| P2-T13 | Renderer arbitrary data URL / missing senderFrame | IPC mutation denied |
| P2-T14 | Six fidelity truth cases incl screenshot-only | Correct origin, transfer limitation, no false bytes |
| P2-T15 | Provider profile without live evidence | Not falsely marked AUTHENTICATED / LIVE |
| P2-T16 | Windows junction/UNC/path race | Escape denied at actual filesystem operation |
| P2-T17 | Two projects/rooms, same user ID, replay | No cross-room/cross-project leakage |
| P2-T18 | Full verify on clean Windows checkout | Typecheck/build/tests/GUI/secret scan all PASS with hashes/logs |

These 18 are **test scenarios**, not assertions that functionality already exists. Implement unit and integration tests as necessary; keep billable external APIs disabled. For live provider tests requiring accounts, use permission-compliant manual or local simulations and label evidence accurately.

## 5. Wave execution plan, minimum change set

**Wave A — Stop-go security blockers (must finish first).** Fix `UB-P2-R01-001`, `002`, `005`, `008`, and `009`. In particular replace nested hash serialization, require explicit human APPROVED state, eliminate UNKNOWN resend route, and stop default-auth/live state. Tests P2-T01–03, T06–07, T13–15 must pass. Until Wave A is verified: **no real external tool execution**, no trusted agent action by renderer and no paid API credentials.

**Wave B — Real product durability.** Fix `003`, `004`, `006`, `007`: integrate Electron with SQLite, transactional event/outbox/idempotency, crash-safe migrations and verified backup/restore. Tests P2-T04–05, T08–12 and T17 mandatory. Do not add outward side effects during this wave.

**Wave C — Windows path and evidence closure.** Fix `010` and `011`, run junction/path tests, clean checkout, full smoke, scan, and reconcile manifest/board. Attach logs without secrets and the exact HEAD SHA.

**P3 parallel work permitted:** non-mutating UI layout, component design and accessibility scaffolding. **Do not** claim offline user journey with persistent rooms/files or authorize real provider actions until P2 gate is signed.

## 6. Required `REVIEW_PACKET_P2_R02.md`

Include exactly: GitHub HEAD (40 hex), base SHA, diff/changed paths, table mapping `UB-P2-R01-001..011` → code change → failing-before regression → passing-after result, one-command clean verify, reproducible crash-kill scripts, sanitized SQLite `PRAGMA integrity_check`, WAL/foreign-keys evidence, IPC origin tests, approval state/digest evidence, outbox reconciler evidence, byte-level backup manifest, full test inventory, true evidence labels (`SOURCE_VERIFIED` vs `TEAM_EXECUTED` vs `REVIEWER_EXECUTED`), and updated TASK_BOARD. Never describe 0 leaked secrets/0 cost as universal proof when only local tests scanned.

**GO_P3 acceptance:** Approval token cannot be fabricated/consumed from PENDING; hash covers complete immutable action; no duplicate side-effect dispatch in crash/restart scenario; desktop actually persists data via the intended SQLite engine; journal and outbox satisfy transactional consistency; migrations are atomic; safe backup/restore works; unsafe IPC origins rejected; fidelity/provenance truth preserved; the full clean verify is supported by evidence.

## 7. Official gate

`CHANGES_REQUIRED — P2_GATE_OPEN — P3_NON_MUTATING_SCAFFOLD_ALLOWED — GO_P3_NOT_ISSUED`

This is a source-grounded rejection of the *current* P2 acceptance claims, not an instruction to restart P2 from scratch. Keep working modules, address the concrete blockers and submit P2 R02 for independent re-review. Do not push/merge on behalf of the PO absent authorization.


---

# PHỤ LỤC A — REGRESSION VECTORS CHI TIẾT CHO ANTIGRAVITY & CODEX

**Phụ lục bắt buộc cho `REVIEW_PACKET_P2_R02.md`.** Các test dưới đây kiểm chứng *hành vi* tại ranh giới đúng (SQLite thật, Electron thật khi yêu cầu), không coi số lượng test PASS là bằng chứng thay cho invariant. Dữ liệu kiểm thử là synthetic, lưu trong `fs.mkdtemp`/workspace tạm, không sử dụng tài khoản AI thật, không phát lệnh có tác động ra Internet. Mọi kịch bản phải có ID ổn định, lệnh tái hiện, log thất bại-trước/sửa-xong (khi khả thi) và commit SHA.

## A0. Contract dùng chung và quy định độ tin cậy

- Dùng **một nguồn schema và chính sách** cho TS và Electron; nếu vẫn phải xuất CJS, bundle từ source và test parity. Kiểm tra đúng runtime Electron thực tế: việc CLI Node 24 hỗ trợ `node:sqlite` **không tự chứng minh** Electron 33 nhúng Node tương thích. Smoke phải load `StorageEngine` trong Electron main, hoặc dùng quy trình sidecar được kiểm soát với hợp đồng API rõ ràng.
- Phân biệt `ACK_PERSISTED`, `DISPATCH_PREPARED`, `DISPATCHED`, `UNKNOWN_NEEDS_RECONCILIATION`, `RESULT_VERIFIED` và `FAILED`. ACK gửi tin vào DB không phải bằng chứng hành động đã thực thi.
- Payload phê duyệt phải là immutable, có `canonicalizationVersion`, `workspaceId`, `roomId`, `actorId`, `tool/actionType`, `target/provider/profile`, `arguments`, `artifactHashes`, `policyVersion` và `expiration`; trường không áp dụng được ghi một cách rõ ràng. Mỗi lần cấp token phải có PO action qua đường tin cậy. Cấm tạo token rồi tự cấp `APPROVED` ở renderer.
- Canonicalization phải có định nghĩa dữ liệu hợp lệ: chỉ JSON value hữu hạn, không `undefined`, `NaN`, `Infinity`, `BigInt`, vòng tham chiếu, class instance không xác định; key sorting đệ quy, Unicode encoding và số theo một quy tắc cố định, giữ thứ tự mảng. Không coi SHA256 là đảm bảo không đụng độ về mặt toán học; test xác minh các thay đổi ngữ nghĩa được bao phủ bởi bytes trước hash.
- Không đưa các hành động mạng hay subprocess side effects vào SQLite transaction. Persist pre-dispatch intent rồi commit; thực thi; persist ACK/evidence; khi nghi ngờ trạng thái sau crash đặt UNKNOWN và chờ reconcile.

## A1. Bộ dữ liệu tiêu chuẩn (synthetic fixtures)

```json
{
  "actor": {"kind": "user", "id": "u-owner", "role": "USER"},
  "scope": {"workspaceId": "ws-a", "roomId": "room-a", "provider": "codex", "profileId": "profile-1"},
  "safeAction": {"tool": "write_file", "args": {"path": "workspace/a.txt", "options": {"overwrite": false, "mode": "utf8"}}},
  "changedAction": {"tool": "write_file", "args": {"path": "workspace/secrets.txt", "options": {"overwrite": true, "mode": "utf8"}}},
  "ids": {"eventId": "evt-fixed-1", "messageId": "msg-fixed-1", "idempotencyKey": "ws-a:room-a:task-1:dispatch-1"}
}
```

Mọi test có điều kiện `assert` cần chứng minh cả **kết quả API** và **trạng thái DB sau reopen**. Không dùng `Math.random()` trong test so trùng lặp; truyền định danh cố định. Tái hiện crash bằng child process/subprocess khác với tiến trình test mẹ, không dùng `storage.close()` để giả lập kill.

## A2. 18 kịch bản bắt buộc với input, hành động, assertion

### P2-T01 — Không được tiêu thụ PENDING (S0)
- **Setup:** Tạo token cho `safeAction`; DB `approvals.status='PENDING'`; không có decision của PO.
- **Action:** Gọi `validateAndConsume(tokenId, 'write_file', safeAction)` từ worker và thử bằng IPC untrusted renderer.
- **Assert:** cả hai `DENY_NOT_APPROVED`; status vẫn `PENDING`; không có `tool.call.dispatched`/outbox gửi; audit deny có token ID nhưng không lộ nội dung nhạy cảm.
- **Phụ:** Gửi `REJECTED`/`EXPIRED` hoặc token không tồn tại phải từ chối; không sửa thành APPROVED do role/flag do renderer khai.

### P2-T02 — PO APPROVED và one-time CAS (S0)
- **Setup:** Đăng ký token bằng workflow yêu cầu phê duyệt; quyết định approve đến từ trusted main UI với xác thực user/scope.
- **Action:** Hai worker/connection riêng đồng thời gọi `validateAndConsume` cùng token bằng synchronization barrier.
- **Assert:** chỉ **một** `UPDATE ... WHERE status='APPROVED' ...` thay đổi `changes=1`; bên còn lại `ALREADY_CONSUMED`; chỉ một event dispatch; audit chỉ một approval consumed; restart vẫn từ chối token đã dùng.
- **Phụ:** Token của `ws-a/room-a` không dùng cho `ws-b/room-b` dù cùng action ID.

### P2-T03 — Digest bao phủ nested payload và phạm vi (S0)
- **Input:** `safeAction` và `changedAction` trong A1; thêm case thay nested `options.mode`, `artifactHashes[0]`, `profileId`, `target`, `recipient`; hoán đổi thứ tự key của object; đảo thứ tự mảng.
- **Action:** Compute digest bằng canonicalizer phiên bản đã khóa, rồi thử consume bằng token tạo từ payload cũ.
- **Assert:** các thay đổi làm digest khác và token bị từ chối; chỉ đổi thứ tự property của object thì digest giữ nguyên; đảo thứ tự mảng cho digest khác. `null`, boolean, Unicode được nhất quán; unsupported input fail-closed. Không chấp nhận legacy token chưa có canonicalizationVersion.
- **Mẫu lỗi cũ để chứng minh:** `JSON.stringify({tool:'write_file',args:{path:'a'}},['args','tool'])` và biến thể path khác đều bỏ qua nested `path`.

### P2-T04 — Electron GUI lưu thật qua kill/restart (S1)
- **Setup:** Bản Electron chạy bằng đường khởi động sản phẩm, một `userData`/workspace tạm; ghi đường DB thực tế; tạo 2 phòng.
- **Action:** Gõ/gửi một tin qua React composer, đợi ACK persist, kill **Electron main process**, chạy lại cùng profile.
- **Assert:** đúng 1 envelope và đúng 1 `ENVELOPE_RECORDED` từ ổ đĩa, không nhân đôi trên UI; `parts`, `origin`, `schemaVersion`, room, thời gian và thứ tự giữ nguyên. Đổi profile/userData không nhìn thấy lịch sử cũ. Không chứng nhận chỉ bằng unit test `StorageEngine`.

### P2-T05 — Transaction envelope/event/idempotency/outbox nguyên tử (S1)
- **Setup:** DB tạm, định danh cố định, fault-injection checkpoints: `after_acquire`, `after_envelope`, `after_event`, `after_outbox`, `before_commit`, `after_commit`.
- **Action:** Inject throw hoặc kill process tại từng checkpoint; reopen DB và query các bảng.
- **Assert:** trước commit thì cả nhóm write rollback (không có `PENDING` mồ côi); sau commit thì tất cả tương ứng có mặt; checksum/event ID/correlation nhất quán; không ACK `success` trước khi commit. Kiểm thử cả exception và abrupt process termination.

### P2-T06 — Crash sau side effect trước ACK (S1)
- **Setup:** Fake adapter local viết dấu hiệu `effect_count` vào nơi quan sát riêng; outbox đã được commit `DISPATCH_PREPARED`.
- **Action:** Adapter ghi effect một lần rồi child process bị kill trước khi nhận ACK; restart worker.
- **Assert:** trạng thái `UNKNOWN_NEEDS_RECONCILIATION`; `getPendingOutboxEntries()` trả **không** có record này; `effect_count===1` kể cả sau startup/retry scheduler. Chỉ reconcile dựa evidence/provider turn ID mới được thay trạng thái; không suy diễn FAILED rồi retry.

### P2-T07 — Idempotency cùng khóa, hết hạn và FAILED (S1)
- **Setup:** 2 connection đến cùng DB; khóa cố định, target/payload digest rõ ràng; mô phỏng TTL hết hạn trên PENDING/UNKNOWN.
- **Action:** Hai `acquire()` đồng thời; gọi `acquire()` sau TTL và sau trạng thái FAILED/UNKNOWN.
- **Assert:** 1 worker sở hữu, không cấp lại khóa cho ngoại tác chưa xác minh; nếu cùng key nhưng payloadDigest khác phải `DENY_PAYLOAD_MISMATCH`; `complete/fail` chỉ chuyển đúng state bằng CAS và `changes===1`; retention/tombstone giữ bằng chứng chống replay.

### P2-T08 — Migration fail giữa up và tracker (S1)
- **Setup:** Clone DB schema v1; migration v2 tạo bảng/index rồi chủ động throw trước `schema_migrations INSERT`.
- **Action:** Chạy migration với `BEGIN IMMEDIATE`/transaction chuẩn; throw/killed; reopen.
- **Assert:** không xuất hiện nửa schema v2; tracker chưa ghi v2; chạy lại v2 thành công duy nhất một lần. Rollback migration sau thao tác lỗi cũng nguyên tử; có checksum định danh migration và kiểm tra sửa nội dung migration đã áp dụng.

### P2-T09 — Version/schema không tương thích (S1)
- **Setup:** Event/Envelope `schemaVersion='999.0.0'`, `contentFidelity='UNKNOWN_FAKE'` và DB chứa migration version cao hơn mã hỗ trợ.
- **Action:** Deserialize ingress, reopen DB.
- **Assert:** schema không hỗ trợ bị từ chối/chặn write; DB tương lai chuyển sang chế độ read-only với lý do rõ ràng (hoặc từ chối mở); không silently default về v1, không tự rollback phá dữ liệu. Test migration checksum mismatch.

### P2-T10 — Backup WAL hoạt động đồng thời và restore an toàn (S1)
- **Setup:** Hai SQLite connection; writer tạo transaction/WAL; dữ liệu gồm event, approval, outbox.
- **Action:** Dùng API backup nhất quán/`VACUUM INTO` an toàn, có SHA/size/version, restore sang **file mới**; sau đó cố tình làm hỏng backup hoặc manifest và thử restore vào target đã có data.
- **Assert:** `PRAGMA integrity_check='ok'`, foreign key check sạch, journal/event projection khớp, restore từ backup lỗi không phá target; không copy một DB live WAL bằng `copyFile` thuần.

### P2-T11 — Backup destination đặc biệt và injection (S1)
- **Input:** Đường dẫn temp Windows có dấu nháy đơn (`O'Brien`), Unicode tiếng Việt, dấu cách và ký tự dài hợp lệ.
- **Action:** Backup/restore ở các path này; test bad input dùng trong SQL nếu có.
- **Assert:** backup thành công hoặc từ chối có kiểm soát, tuyệt đối không thực thi SQL ngoài ý muốn; không interpolate untrusted path trực tiếp trong SQL; file temp dọn khi lỗi.

### P2-T12 — Diagnostic redaction/PII (S1)
- **Input:** Room name như `Alice alice@example.com token=abc123`, value chứa token pattern khác, filename/private path, provider thread URL.
- **Action:** Gọi `exportRedactedDiagnostics()` và xuất JSON thực tế.
- **Assert:** raw room name, email, tên và đường dẫn riêng tư không có trong output; chỉ count/opaque ID và known-safe enum; báo số mẫu bị redact, không khẳng định tuyệt đối “0 PII” chỉ vì regex pass. `UnionBotError.toJSON()` không phát tán payload/cookie.

### P2-T13 — IPC senderFrame trust-boundary (S1)
- **Setup:** Electron main with app UI; tạo thử sender từ `data:text/html`, iframe/child WebContents, second window, senderFrame rỗng, frame đã navigate.
- **Action:** Gọi `dispatch-envelope`, `get-room-history`, `approve-token` và mọi IPC mutation có quyền.
- **Assert:** chỉ allow exact trusted window + `webContents.id` + main-frame/origin; tất cả trường hợp còn lại deny; thiếu `senderFrame` phải deny. Test legacy fallback data URL read-only, không có mutation APIs.

### P2-T14 — Sáu fidelity ngữ nghĩa đúng và CAS (S1)
- **Input:** `original_bytes`, `structured_copy`, `rendered_preview`, `screenshot_only`, `external_reference`, `unavailable`; các part ảnh/PDF/widget từ nguồn synthetic/manual/live-labelled.
- **Action:** Serialize → SQLite → reopen → deserialize; thử chuyển sang recipient chỉ nhận text/URL.
- **Assert:** sáu loại vòng về không mất; `screenshot_only` không thể được gọi `original_bytes`; `external_reference` không tự hiển thị SHA file có thật; metadata về transfer_state và evidence provenance luôn hiện hữu. Nếu lưu 6 enum khác tên, phải có mapping lossless versioned được test cả hai chiều.

### P2-T15 — Provider profile không tự nhận đã login/live (S1)
- **Setup:** Tạo provider identity cho chatgpt/gemini/claude/deepseek/codex/antigravity mà chưa chạy probe, thiếu evidence.
- **Action:** Parse schema, lưu/khôi phục profile, render readiness.
- **Assert:** mặc định `UNKNOWN/NOT_VERIFIED` và provenance `UNVERIFIED`, không `AUTHENTICATED` hoặc `LOCAL_RPC` giả; `MANUAL_SHARE` không hiển thị `AUTOMATED_READY`; hai profile cùng provider không dùng chung cookie/session by default.

### P2-T16 — Windows path, junction và TOCTOU (S2)
- **Setup:** NTFS temp workspace, ngoài root tạo file marker; tạo symlink/junction tới ngoài root (nếu quyền không cho tạo phải ghi `BLOCKED_EXTERNAL`, không tự đánh PASS).
- **Action:** Validate đường dẫn xuyên junction, đường dẫn có ancestor chưa tồn tại; sau validate hoán đổi parent thành junction trước actual write; thử UNC, drive-relative `C:foo`, ADS `file:stream`, tên reserved/trailing dot.
- **Assert:** deny hoặc guarded safe-open chặn ngay tại thao tác thật; marker ngoài root nguyên vẹn; test chứng minh đường dẫn an toàn vẫn hoạt động. Phân biệt `validate path` với `secure filesystem operation`.

### P2-T17 — Project/room isolation và stale approval (S1)
- **Setup:** workspace A/B, mỗi workspace room `general`; cùng user ID, task/correlation/idempotency key trùng phần suffix.
- **Action:** Dispatch room A, cố đọc qua IPC session B; copy approval token từ A sang B; replay sự kiện có provider event ID trùng.
- **Assert:** không rò message/part/artifact; approval/token/key có scope; event ordering và unique provider event ID đúng theo session; stale review gắn source commit SHA A không được phép phê duyệt đầu ra SHA B.

### P2-T18 — Clean-checkout verify và release evidence (S2)
- **Setup:** Clone sạch ở Windows runner không có node_modules/dist, khóa pnpm lockfile, Node/Electron versions ghi rõ.
- **Action:** `pnpm install --frozen-lockfile` → `pnpm verify` → GUI crash/restart tests → strict secret scan; test một đường failure để xác nhận verify exit nonzero.
- **Assert:** typecheck/lint/build/Node tests/Python tests/GUI persistence/recovery/secret scan exit 0; nhật ký có start/end/commit SHA/OS/Node/pnpm/Electron/native SQLite runtime/DB PRAGMAs. Báo `lint` đúng công cụ thực, không gọi alias `tsc + scanner` là style linter; không báo “100% zero egress” chỉ vì URL guard unit test.

## A3. Bản đồ issue → test bắt buộc

| Issue | Regression chính |
|---|---|
| `UB-P2-R01-001` | T01, T02, T17 |
| `UB-P2-R01-002` | T03, T17 |
| `UB-P2-R01-003` | T04, T17, T18 |
| `UB-P2-R01-004` | T05, T06, T17 |
| `UB-P2-R01-005` | T06, T07 |
| `UB-P2-R01-006` | T08, T09 |
| `UB-P2-R01-007` | T10, T11, T12 |
| `UB-P2-R01-008` | T13, T17 |
| `UB-P2-R01-009` | T09, T14, T15 |
| `UB-P2-R01-010` | T16 |
| `UB-P2-R01-011` | T18 + inventory T01–T17 |

## A4. Quy trình nghiệm thu R02

**Antigravity (Implementation Owner):** sửa code theo Wave A/B/C; mỗi issue phải có test fail-before/pass-after khi khả thi; bổ sung wiring Electron thật và tránh hai nguồn logic TypeScript/CJS trôi nhau. Không ghi vào `main`/push remote nếu PO chưa cấp phép cụ thể cho thao tác đó.

**Codex (QA Lead):** chạy test độc lập trên checkout sạch; kiểm tra SQL state sau crash; thực hiện fault injection và test Windows real; phân biệt `TEAM_EXECUTED`/`REVIEWER_EXECUTED`; kiểm tra số PASS là test có assert thực chất, không chỉ test API return.

**Reviewer GO_P3 gate:** `REVIEW_PACKET_P2_R02.md` phải gồm SHA thật, diff, migration/schema version, log mỗi vector T01–T18, screenshot/video/log đã che thông tin nhạy cảm, approval state/digest samples, outbox UNKNOWN query, Electron restart witness, `PRAGMA integrity_check`, và bảng cập nhật của 11 issue. **Không cần hoàn thiện P3 UI hay 6 AI adapter để đóng P2**; chỉ cần các ranh giới và persistence thật, an toàn đã được xác nhận.

**Official status:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_NON_MUTATING_SCAFFOLD_ALLOWED`.
