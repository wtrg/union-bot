# UNION BOT — CHỈ THỊ KỸ THUẬT PHASE P2, ROUND R04

**Loại tài liệu:** Checklist triển khai + tiêu chí nghiệm thu + 12 regression/integration vectors bắt buộc.  
**Người nhận:** Antigravity (Implementation), Codex (Independent QA/Security).  
**Technical Leader verdict:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_OFFLINE_UI_SCAFFOLD_ALLOWED`.  
**Repository:** https://github.com/wtrg/union-bot  
**Baseline đã thẩm định:** `ec66da8095047f363138ba1003f9fa143488b1fd` (GitHub `main` đã được kiểm tra lại ở thời điểm ban hành chỉ thị).  
**Đầu ra yêu cầu:** `reports/handoff/REVIEW_PACKET_P2_R04.md`, patch tương ứng, raw test logs và bằng chứng Windows thật.  
**Chi phí:** chỉ dùng công cụ/giải pháp 0đ; không gọi API trả phí; không tự push/merge nếu chưa có sự chấp thuận riêng của Product Owner.

## 0. Định nghĩa hoàn thành

**Không chấp nhận** `GO_P3` chỉ dựa vào số lượng unit test. Cần chứng minh: (a) approval thực sự ràng buộc *đúng payload* đã được người dùng xem và phê duyệt; (b) approver là principal được **trusted main process** xác thực chứ không phải trường JSON có thể tự khai; (c) cùng ID nhưng khác payload không thể nhận ACK thành công; (d) native Electron và worker Node dùng cùng schema/migration, gồm `dispatch_prepared`; (e) mất database/worker không được ngụy trang thành desktop LIVE READY; (f) kiểm thử crash/restart là tiến trình thật, không phải chỉ đóng/mở đối tượng SQLite.

### Thứ tự ưu tiên

- **Wave A — Approval Security:** `UB-P2-R03-01`, `UB-P2-R03-02`, `R04-G01..G03`, `R04-G12`.
- **Wave B — Exactly-once & Schema:** `UB-P2-R03-03`, `UB-P2-R03-04`, `R04-G04..G06`, `R04-G09`.
- **Wave C — Runtime + Evidence:** `UB-P2-R03-05`, `UB-P2-R03-06`, `R04-G07..G11`; cuối cùng chạy lại G01..G12 từ clean checkout.

## 1. `UB-P2-R03-01` — S1 — Approval Desktop bỏ qua digest thực tế

**Dẫn chứng nguồn:** `apps/desktop/src/orchestrator.cjs`: `validateAndConsumeApproval(approvalTokenId, part.tool, null, ...)`. `apps/desktop/src/storage-worker.cjs` và `storage-service.cjs`: `if (payloadDigest && row.payload_digest !== payloadDigest)`; conditional UPDATE chưa ràng buộc payload digest.

**Checklist sửa mã**

- [ ] Định nghĩa `ApprovedActionDescriptorV1` **duy nhất**: `workspaceId`, `roomId`, `actorId`, `recipient`, `actionType/tool`, mọi `input`/tham số lồng nhau, `target`, `artifact SHA256`, `policyVersion`, `canonicalizationVersion`. Chỉ loại bỏ trường ephemeral khi có contract/version rõ ràng.
- [ ] Tạo payload preview từ *cùng descriptor* mà executor thực sự dùng; không thay input sau preview/approval. Thay file, tham số, người nhận hoặc profile ⇒ invalidates approval.
- [ ] Đặt canonicalizer/digest ở trusted main/worker; tái sử dụng **một** implementation nguồn chuẩn (hoặc compiled build chung). `canonicalizeJson` phải fail-closed đối với undefined/function/symbol/NaN/Infinity/holes/circular; không đọc digest do renderer tự khai như bằng chứng tin cậy.
- [ ] `validateAndConsumeApproval` từ chối `payloadDigest == null`, `''`, sai định dạng, unsupported version, hoặc mismatch. Chưa xác định được descriptor ⇒ DENY, **không** fallback vào so `tool` đơn thuần.
- [ ] SQL compare-and-swap ràng buộc `status='APPROVED'`, `expires_at > now`, `payload_digest = computedDigest`, đúng `action_type`; scope được xác thực bắt buộc nếu token có binding; `changes === 1`. Nên atomic cả ghi audit. Không tiết lộ payload/secret trong audit.
- [ ] Không tiêu thụ approval **trước** cost/admission check hoặc trước một durable prepared state. Khi thao tác bị deny vì unknown cost/paid API, token không bị âm thầm mất hiệu lực; không gọi external effect trong transaction.
- [ ] Hỗ trợ **cả hai runtime**: Electron native `DatabaseSync` và Node worker fork. Thử thay nested value, không chỉ thay trường root.

## 2. `UB-P2-R03-02` — S1 — Approver identity/role tự khai

**Dẫn chứng:** `packages/storage/src/approval-gate.ts`, `apps/desktop/src/storage-worker.cjs`, `storage-service.cjs` có điều kiện `approver.isTrustedContext === false`, nghĩa là thiếu trường hoặc tự khai `true` có thể qua vòng kiểm tra nếu có `id`/role thích hợp.

**Checklist sửa mã**

- [ ] Không cấp quyền dựa trên `{id,role,isTrustedContext}` lấy nguyên vẹn từ renderer, AI agent hoặc arbitrary caller. `isTrustedContext` là **kết quả server-side**, không phải thuộc tính nhận từ untrusted IPC.
- [ ] Thêm `TrustedPrincipal`/`ApprovalAuthority` được trusted main process xác định từ local authenticated operator/session + current workspace permissions. Tách request data (`tokenId`, `decision`, `nonce`) khỏi trusted caller identity.
- [ ] Trên IPC `approve`: kiểm tra `event.sender`, `senderFrame`, correct main frame, correct window, session/permission; chỉ trao quyền thông qua chính sách ứng dụng. Nếu thiết kế offline single-user, main phải tự xác định `localOperator` và có confirmation challenge do main sinh, không cho caller set `role=LEADER` để leo quyền.
- [ ] `approveToken` **không chấp nhận** principal thiếu sự xác nhận từ trusted boundary; khi role bị thiếu, sai hoặc giả ⇒ DENY. Bắt buộc audit `who`, `what digest`, `workspace`, `when`, `policyVersion`.
- [ ] Ràng buộc approval vào *snapshot* xem trước với one-time challenge, expiry và actual payload digest. Replay challenge và stale approval sau thay đổi payload/recipient bị chặn.
- [ ] Với `rejectToken()`, áp dụng cùng trust boundary; tránh cho renderer/agent tùy ý từ chối token của người dùng khác.

## 3. `UB-P2-R03-03` — S1 — Idempotency Desktop trả ACK cho ID trùng, payload khác

**Dẫn chứng:** `storage-worker.cjs` và `storage-service.cjs` ghi `payload_digest = NULL`; nhánh `existing.status === 'COMPLETED'` trả `{success:true,deduplicated:true}` trước khi đối chiếu payload; `orchestrator.cjs` có `seenEnvelopeIds` in-memory fast path.

**Checklist sửa mã**

- [ ] Tạo `computeEnvelopeDigest()` từ envelope **sau** `EnvelopeSchema.parse`, gồm nội dung text/code/action/artifact, sender/recipient, workspace/room và metadata có ý nghĩa; có version canonicalization. Trong trường hợp retry phải gửi lại cùng normalized bytes.
- [ ] SQL `idempotency_keys.payload_digest` bắt buộc non-null cho hàng mới; thêm `target_id`/scope đã xác minh. Migrate record cũ null theo quy tắc an toàn, **không** tự ACK khi chưa chứng minh tương đương.
- [ ] Nếu ID đã `COMPLETED`: **trước khi** trả cached ACK, đối chiếu stored digest, workspace, target và room; mismatch ⇒ `ERR_PAYLOAD_MISMATCH`; không thêm event/outbox, không broadcast, không thay nội dung cũ.
- [ ] Nếu duplicate y hệt: trả **ACK gốc** (có thể `deduplicated:true`), giữ số lượng envelope=1, event=1, outbox=1. Bỏ đường `seenEnvelopeIds` cho phép skip validation/digest; hoặc sau khi cache hit vẫn đối chiếu digest ở storage.
- [ ] Trong cùng transaction: acquire/reserve key với digest, insert envelope, append event, enqueue outbox **khi thật sự cần dispatch**, mark completed/prepare. Xác định rõ outbox event nội bộ khác side-effect gửi ra bên ngoài, không được phát broadcast lại trên duplicate.
- [ ] TTL không giải phóng dispatch không rõ kết quả; `UNKNOWN_NEEDS_RECONCILIATION` không tự chuyển thành QUEUED.

## 4. `UB-P2-R03-04` — S1 — SQLite schema Electron lệch canonical migrations

**Dẫn chứng:** `packages/storage/src/migrations.ts` có `idempotency_keys.dispatch_prepared`; `apps/desktop/src/storage-worker.cjs` và `storage-service.cjs:initNative` tự `CREATE TABLE` thiếu cột này. Tracking version/checksum tại Electron cũng khác canonical.

**Checklist sửa mã**

- [ ] Chọn **một schema/migration authority**: tốt nhất package `@union-bot/storage` sinh migration SQL + manifest đã kiểm chứng cho cả native và worker; không giữ ba định nghĩa `CREATE TABLE` độc lập.
- [ ] Schema requirement: `idempotency_keys.dispatch_prepared INTEGER NOT NULL DEFAULT 0` (hoặc tương đương), payload digest handling, indexes/events/outbox/approval/audit, migration version/checksum đều có trên native, worker và CLI package.
- [ ] Electron startup dùng `PRAGMA table_info(...)`, `PRAGMA user_version`/migration ledger, checksum, `PRAGMA foreign_key_check`, `PRAGMA integrity_check` theo chính sách. Sai schema ⇒ error/recovery, không âm thầm chuyển sang RAM hoặc tự DROP table.
- [ ] Xây upgrade path cho DB **đã có dữ liệu** được tạo bằng P2 R02/R03: tạo verified backup trước, transaction `ALTER TABLE ... ADD COLUMN dispatch_prepared`, backfill `0` chỉ cho record xác minh là chưa dispatch (otherwise UNKNOWN), cập nhật migration ledger; kiểm tra row counts và digest.
- [ ] Migration checksum cũ không khớp không được đơn giản overwrite để đánh PASS. Phân loại legacy-without-ledger và migrate bằng fingerprint schema nhận diện cụ thể.
- [ ] Không dùng tên DB chung của app Electron demo nếu gây trộn profile; workspace/profile separation vẫn cần được bảo toàn.

## 5. `UB-P2-R03-05` — S2 — Startup fail vẫn mở UI như READY

**Dẫn chứng:** `apps/desktop/src/main.js`: bắt `storage.ready` failure rồi `createWindow()` bình thường; React suy diễn trạng thái LIVE từ sự tồn tại của `window.unionBotAPI`.

- [ ] Startup state machine: `STARTING → READY | STORAGE_ERROR_READONLY | STORAGE_ERROR_BLOCKED`.
- [ ] `StorageServiceClient.ready` reject ⇒ hiển thị error/recovery screen tường minh (có nút Retry, Export safe diagnostic, chọn backup); **tắt mutation IPC**; không báo LIVE READY.
- [ ] Mọi IPC `dispatchEnvelope`, approval và mutation khác gate bằng `storageStatus === READY`; không trả success nếu worker chết hoặc pending operation timeout.
- [ ] Không tự động xóa/sửa user DB khi recover; để lại bằng chứng và thông báo vị trí dữ liệu khi phù hợp.
- [ ] GUI smoke riêng phải kiểm chứng lỗi startup, không chỉ nominal success.

## 6. `UB-P2-R03-06` — S2 — Evidence chưa tương xứng tuyên bố E2E

- [ ] Phân loại đúng `UNIT`, `COMPONENT`, `INTEGRATION`, `WINDOWS_E2E`, `TEAM_EXECUTED`, `REVIEWER_EXECUTED` cho từng test; không gọi recreation của `StorageServiceClient` trong một Node process là Electron kill/restart.
- [ ] Có child-process test gây **kill thật** lúc pending insert, ghi và mở lại DB; phân biệt kết quả `0/1 row` với bất biến all-or-nothing tổng thể của idempotency/envelope/event/outbox.
- [ ] Tạo GUI harness với **temp userData riêng**. Đường send phải đi qua preload/IPC/Orchestrator/SQLite thật, sau đó kill Electron main và khởi động cùng userData, query lại số record và UI.
- [ ] Fault injection phải đặt **trong production worker handler** tại sau từng bước ghi, không phải mô phỏng transaction khác trong file test.
- [ ] Test failure phải spawn `node --test` trên một test cố ý fail và assert exit code nonzero, không chỉ `assert.throws(fn)` trong cùng process.
- [ ] Export logs loại bỏ token/cookie/PII; manifest nêu git SHA, Node/Electron/SQLite versions, Windows build, test command, `PRAGMA journal_mode`, file/suite counts, failures/skips.

---

## 7. 12 regression/integration vectors R04-G01 → R04-G12

### `R04-G01` — Approved action A, submit nested action B
- **Precondition:** token APPROVED cho `write_file` với `args={path:'project/a.txt',overwrite:false,content:'safe'}`, đúng room/workspace/actor/recipient.
- **Attack:** cùng token, actionType và scope nhưng thay `args.path` thành `project/secrets.txt`, `overwrite:true`, hoặc đổi `content`.
- **PASS:** `ERR_APPROVAL_HASH_MISMATCH`, token vẫn APPROVED/chưa consumed, 0 file writes/0 outbox for B. Chạy cả worker + native.

### `R04-G02` — Missing/untrusted digest và stale preview
- **Precondition:** approval cho snapshot A có digest chuẩn do main tính.
- **Attack:** gọi consume với `null`, `undefined`, `''`, digest chỉ do renderer gửi, unsupported version; sửa recipient/attachment SHA/canonical object sau preview.
- **PASS:** tất cả bị từ chối trước consume và trước side-effect; không thể đổi A sang B mà vẫn dùng approval cũ. SQL consume có điều kiện `payload_digest = computedDigest`.

### `R04-G03` — Spoofed approver principal
- **Attack inputs:** `{id:'attacker'}`, `{id:'attacker',role:'USER'}`, `{id:'attacker',role:'LEADER',isTrustedContext:true}` từ untrusted IPC, challenge replay/expired, agent sender fake operator.
- **PASS:** tất cả DENY, zero APPROVED audit/DB; chỉ `TrustedPrincipal` do main/session policy xác thực và thao tác confirm mới được chuyển PENDING→APPROVED.

### `R04-G04` — Exact idempotency replay vs changed message
- **Setup:** envelope E1 đã commit thành công, id `same-123`.
- **Attack:** E2 dùng cùng ID nhưng sửa text, room, sender, recipient, attachment SHA hoặc action arguments.
- **PASS:** E2 bị `ERR_PAYLOAD_MISMATCH`; E1 exact replay nhận cached ACK; envelope/event/outbox vẫn mỗi loại đúng 1, không broadcast lại.

### `R04-G05` — Canonical/electron/worker schema parity
- **Setup:** tạo DB mới lần lượt qua canonical `StorageEngine`, native Electron adapter, forced Node worker adapter.
- **PASS:** `PRAGMA table_info(idempotency_keys)` đều có `dispatch_prepared`; indexes, migration version/checksum, approval/audit tables và WAL/foreign key policy tương thích; `IdempotencyManager` không bị `no such column`.

### `R04-G06` — Upgrade legacy DB không làm mất dữ liệu
- **Setup:** fixture SQLite sinh từ schema Electron R02/R03 trước đó, có 3 rooms, 10 envelopes, 10 events, 2 outbox (QUEUED/UNKNOWN), 2 approvals.
- **Action:** tạo backup verified, boot version mới, migration và reopen lần hai.
- **PASS:** giữ đúng counts/content/checksums/state; `dispatch_prepared` có và được backfill thận trọng; ledger version/checksum chuẩn; migration chạy lại idempotent; không có DROP/duplicate.

### `R04-G07` — Invalid worker/incompatible DB at real Electron startup
- **Setup:** temp userData; forced invalid Node executable, hoặc database schema không tương thích.
- **PASS:** Electron không hiển thị `LIVE READY`; user thấy error/recovery; dispatch/approval IPC DENY; không ghi memory fake success, DB người dùng giữ nguyên; retry chỉ khôi phục khi storage ready.

### `R04-G08` — Real Electron kill/main relaunch
- **Setup:** Electron Windows thật với temp userData + built workspace UI; gửi một envelope qua GUI/preload/IPC (không gọi StorageEngine trực tiếp).
- **Action:** nhận durable ACK; kill Electron main, relaunch cùng userData; query SQLite và UI history.
- **PASS:** đúng 1 envelope + event + outbox (theo contract), đúng room/content; duplicate exact replay không nhân đôi; đổi ID/scope bị chặn; không dữ liệu cross-workspace.

### `R04-G09` — Fault injection inside *production worker* transaction
- **Setup:** injection hooks được phép **chỉ trong test mode** sau `idempotency insert`, `envelope insert`, `event insert`, `outbox insert`, trước COMMIT; production không bật.
- **Action:** mỗi checkpoint spawn worker, inject fault/kill, reopen SQLite.
- **PASS:** all-or-nothing cho cả 4 bảng; không có durable ACK trước COMMIT; UNKNOWN/needs-reconciliation đúng khi không chắc về side effect; không auto-send lại.

### `R04-G10` — Failing child test runner returns nonzero
- **Action:** sinh test file thất bại có chủ ý trong temp dir, chạy bằng child process `node --test <tempfile>`.
- **PASS:** child exit code khác 0; `pnpm verify` hay script CI không nuốt exit code. Không chỉ kiểm tra `assert.throws` trong test đang PASS.

### `R04-G11` — Actual Electron IPC frame boundary
- **Setup:** real Electron host window; thử từ trusted main frame, iframe, data: frame, thứ hai BrowserWindow/webContents, missing frame và navigated URL.
- **PASS:** chỉ trusted main frame được phép read/dispatch theo scope; các nguồn còn lại DENY. Nếu chỉ dùng mock `senderFrame`, ghi nhãn COMPONENT, **chưa đánh** Windows E2E PASS.

### `R04-G12` — Approval không bị burn khi Cost Guard từ chối
- **Setup:** token APPROVED, descriptor valid nhưng provider/action bị `DENY_UNKNOWN_COST` hoặc `DENY_PAID_API_DISABLED`.
- **PASS:** zero side-effect, zero QUEUED external dispatch; token không bị silent CONSUMED. Nếu chính sách chọn REJECTED/EXPIRED, phải có reason/audit rõ và không thể tái sử dụng trái phép. Khi admission pass nhưng commit fail, không có token consumed đơn lẻ ngoài transaction. Sử dụng registry phí trusted main-side, không tin `estimatedCost:0` do renderer khai.

## 8. Regression suite placement & execution matrix

| Test | Recommended file | Layer | Required evidence |
|---|---|---|---|
| G01–G03, G12 | `packages/storage/tests/r04_approval_security.test.ts` + `tests/e2e/desktop-approval` | UNIT + IPC INTEGRATION | Token status/audit, digest, zero effects, native & worker |
| G04–G06 | `packages/storage/tests/r04_idempotency_schema.test.ts` | INTEGRATION | Real SQLite, PRAGMA, migrations, row counts |
| G07–G08, G11 | `tests/e2e/desktop-r04.*` | WINDOWS_E2E | Real Electron process/window, temp userData, restart logs |
| G09 | `packages/storage/tests/r04_worker_faults.test.ts` | SUBPROCESS INTEGRATION | Worker process kill/exit, DB table counts |
| G10 | `tests/verify-failure-propagation.test.*` | SUBPROCESS INTEGRATION | Child exit code != 0 |

## 9. R04 sign-off checklist (gates, not vanity metrics)

- [ ] All `UB-P2-R03-01..06` closed with changed-source links and negative tests.
- [ ] `G01..G12` implemented as distinct executable test cases, no mock mislabeled E2E, 0 unexplained failures/skips.
- [ ] Approval digest computed from exact actual payload; `null` digest/forged approver DENY; no token burn on denied action.
- [ ] Native + worker SQLite schema parity and safe legacy upgrades proven.
- [ ] Same message ID with different content ⇒ DENY, no fake duplicate ACK.
- [ ] Storage-worker death and incompatible DB ⇒ no durable ACK or READY UI.
- [ ] Real Windows Electron process kill/restart and worker fault injection included, with raw evidence.
- [ ] `pnpm install --frozen-lockfile`, `pnpm verify` and independent Codex QA results recorded with exact remote commit SHA.
- [ ] Secret scan clean, logs sanitized; zero paid API usage and no unapproved push/merge.

**Submission filename:** `reports/handoff/REVIEW_PACKET_P2_R04.md`.
