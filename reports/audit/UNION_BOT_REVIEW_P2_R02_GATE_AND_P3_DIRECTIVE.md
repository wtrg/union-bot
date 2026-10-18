# UNION BOT — INDEPENDENT TECHNICAL LEADER REVIEW
## Phase P2, Round R02 — Quyết định gate và chỉ thị vòng sửa R03

**Repository:** https://github.com/wtrg/union-bot  
**Branch/HEAD đã xác minh:** `main` / `a628cf002c9ed06cdb16cdbaf4ed45fc9c1fd858`  
**So với baseline:** `080ab539e2674428c714dae59c5ca381b8b909c4`; 1 commit, 24 file thay đổi  
**Nguồn báo cáo:** `reports/handoff/REVIEW_PACKET_P2_R02.md`  
**Quyết định:** **`CHANGES_REQUIRED — GO_P3_NOT_YET — P3_UI_SCAFFOLD_ALLOWED`**  
**Người review:** ChatGPT Web — độc lập, qua GitHub connector. Không tự nhận đã chạy full test/GUI trên Windows.

### 1. Phân biệt bằng chứng

- **SOURCE_VERIFIED:** SHA ở remote HEAD; các bản vá có mặt trong source; đã đọc mã và test được commit lên repo.
- **TEAM_REPORTED:** `97/97` Node/TS, `16/16` Python, smoke GUI và secret scan PASS — được ghi trong review packet; **không phải test do reviewer độc lập chạy**.
- **NOT_YET_PROVEN:** cold-start/kill/restart Electron với worker thật; worker crash/fail-closed; atomicity đủ envelope+event+idempotency+outbox trên desktop; authenticated approval workflow; side-effect reconciliation; clean-checkout Windows.
- GitHub combined commit status hiện không cung cấp CI statuses. Test name hoặc comment `P2-Txx` không đủ chứng minh một E2E scenario đã thực sự chạy.

### 2. Những phần có tiến triển thực chất

- `packages/storage/src/approval-gate.ts` từ chối tiêu thụ `PENDING`, có `approveToken()` và CAS khi tiêu thụ.
- `packages/storage/src/canonical-json.ts` có thuật toán duyệt nested object, digest kèm prefix version trong hash input.
- `packages/storage/src/idempotency.ts` tách hàng `QUEUED` khỏi `UNKNOWN_NEEDS_RECONCILIATION`.
- `packages/storage/src/migrations.ts` dùng transaction và theo dõi checksum; protocol đã có sáu nhãn fidelity V3.1 và auth/provenance mặc định chưa kiểm chứng.
- `apps/desktop/src/main.js` có `isAuthorizedSenderFrame()` kiểm tra main window ID, top-level frame và URL chính xác.
- `apps/desktop/src/storage-service.cjs` và `storage-worker.cjs` xây đường lưu SQLite mới.

**Các bản sửa trên được chấp nhận ở mức source. Không làm lại khi không có regression ngược.**

### 3. Các vấn đề còn chặn gate P2

#### UB-P2-R02-001 — S1 — StorageWorker FAIL-OPEN qua in-memory fallback
**Source:** `apps/desktop/src/storage-service.cjs:96–110, 158–188, 271–289`. `handleFallback('insertEnvelope')` đưa tin vào `Map` và trả `{success:true}`. `sendRequest()` dùng fallback khi worker vắng hoặc `worker.send()` lỗi. Sự cố process `exit` không reject toàn bộ `pending` promises. Điều này mâu thuẫn trực tiếp với điều kiện durable ACK.

**Sửa:** Với mode production, worker/init/SQLite unavailable => `STORAGE_UNAVAILABLE`, **không ACK**, không ghi giả bền vững. Nếu có demo-memory mode, phải opt-in riêng và hiển thị `NON_DURABLE_DEMO`; cấm trộn với profile sản phẩm. Có ready promise/init ACK, timeout, reject all pending on `exit`, `error`, `disconnect`, giới hạn queue; fail-closed khi phiên Node sai. Không tự kill worker đang commit mà không drain trên shutdown.

**Test:** (a) system Node 24 không có, (b) worker chết trước init, (c) chết giữa insert, (d) `send()` throw, (e) DB read-only/disk full; tất cả không trả ACK thành công. Verify `fallbackEnvelopes` không dùng trong production.

#### UB-P2-R02-002 — S1 — Chưa chứng minh Electron restart; hydrate/history race
**Source:** `apps/desktop/src/orchestrator.cjs:447–458, 590–602` hydrate async nhưng constructor không await; `apps/desktop/src/main.js:284–290` vẫn gọi `orchestrator.getRoomHistory(roomId)` **đồng bộ**, không gọi `getRoomHistoryAsync`. `P2-T04` trong test suite chỉ `storage.close()` và tạo lại `StorageEngine` ở cùng tiến trình, **không khởi động lại Electron**. Smoke GUI kiểm tra dispatch/history trong cùng session; không có kill/restart.

**Sửa:** IPC get-history phải await kết quả đọc DB thật; ứng dụng đợi storage.ready trước khi bật dispatch và load histories. Tránh hydrate ghi đè dữ liệu mới; query có paging/dedupe. Smoke phải dùng profile tạm và restart Electron/worker thật rồi verify đủ schema và chính xác một bản tin.

**Test:** chạy Electron vào profile tạm, gửi 2 phòng qua IPC, kill child Electron từ process khác, relaunched same userData, getHistory trả cùng IDs đúng một lần, reload UI hiển thị đúng; đổi profile không chéo phòng.

#### UB-P2-R02-003 — S1 — Approval identity/scope có thể bỏ qua và desktop approval chưa tích hợp
**Source:** `packages/storage/src/approval-gate.ts:110–156, 269–284`: `approveToken()` chỉ nhận `{id}` do caller cung cấp, không tự xác minh một trusted authorization context; `validateAndConsume()` chỉ so scope khi **cả** options và scope trong token tồn tại. `packages/orchestrator/src/orchestrator.ts:173–175` gọi `validateAndConsume(tokenId, tool, input)` **không truyền scope**. `apps/desktop/src/orchestrator.cjs:438–439, 524–530` lại dùng `approvalTokens = new Map()` riêng, không nối tới SQLite ApprovalGateManager.

**Sửa:** Trusted operator/session identity phải cấp bởi main process và xác minh quyền approve; renderer không được tùy ý gửi approver role/id. Required scope trên action ảnh hưởng ngoài: workspace/room/actor/recipient/payload hash/policy version. Khi token có scope thì thiếu request scope là DENY. Có kiểm tra expiry và commit atomic APPROVED→CONSUMED cùng dispatch record. Desktop dùng cùng approval gate SQLite/canonical, không dùng Map không bền vững.

**Test:** caller không có trusted proof, role tự khai, thiếu scope, scope sai, revoked session, token đã tiêu thụ sau restart, hai processes cùng consume => đều deny trừ trường hợp hợp lệ duy nhất; đối chiếu DB và audit.

#### UB-P2-R02-004 — S1 — Desktop transaction vẫn khác Orchestrator canonical
**Source:** `apps/desktop/src/storage-worker.cjs:132–176` và `storage-service.cjs:196–255` transaction chỉ ghi `envelopes` và `events`; không có `idempotency_keys` / outbox / durable `dispatch_records` trong cùng commit. `apps/desktop/src/orchestrator.cjs:495–501, 555–580` dedup bằng `Set` trong RAM. Canonical TS orchestrator `packages/orchestrator/src/orchestrator.ts:130–132` cũng `acquire()` **trước** giao dịch bao ghi envelope/event/complete ở `:222–236`, nên có thể để PENDING mồ côi khi crash.

**Sửa:** Một storage implementation/canonical command handler dùng trên cả desktop và TS; `BEGIN IMMEDIATE` kết hợp dedup key, payload digest, envelope/event/outbox state và completion; unique constraints & state CAS. Ghi dispatch prepared trước I/O bên ngoài, không giữ transaction qua I/O. DB lỗi => rollback; ACK sau commit.

**Test:** inject failures tại after-acquire/after-envelope/after-event/after-outbox/before-commit/after-commit **trên chính handler app dùng**. Assert invariant DB với `SELECT`; crash/kill thật, không tự replay side-effect.

#### UB-P2-R02-005 — S1 — Idempotency PENDING hết hạn vẫn được xóa không có bằng chứng
**Source:** `packages/storage/src/idempotency.ts:102–114`. `PENDING` hết hạn bị DELETE và đăng ký lại, trong khi chưa có bằng chứng rằng tác động bên ngoài chưa xảy ra. `fail()` (`:172–180`) chưa kiểm tra `changes === 1`; `complete()` (`:140–166`) không chặn rõ việc gọi lặp ở state đã hoàn thành.

**Sửa:** TTL chỉ cho phép **reconcile/claim lại với bằng chứng chắc chắn chưa dispatch**. Mọi PENDING có khả năng đã side-effect => UNKNOWN; cấm re-send. Bind key với target/workspace/payload_digest/attempt; CAS complete/fail + kiểm tra changes. Không dùng `ON CONFLICT DO UPDATE` để reset trạng thái không phù hợp.

**Test:** acquire PENDING→ghi external-dispatch marker→expire→acquire trùng, MUST deny/UNKNOWN; concurrency hai connection, payload mismatch, FAILED/COMPLETED cache, UNKNOWN survive restart.

#### UB-P2-R02-006 — S2 — Bằng chứng E2E chưa khớp tên test
**Source:** `packages/storage/tests/p2_regression_vectors.test.ts`: T04 dùng đóng/mở `StorageEngine` thay Electron; T05 inject exception trong transaction ví dụ, không gọi đường desktop; T06 chỉ lọc queue, không kill sau side-effect; T13 dùng hàm `checkAuth()` **viết lại trong test**, không chạy chính `isAuthorizedSenderFrame()` production; T16 không chứng minh junction/TOCTOU; T18 chỉ so schema constants, không chạy clean checkout/verify. `apps/desktop/src/main.js` smoke không restart và chưa chứng minh durable DB. `scripts/verify.ps1` test counter đã cập nhật nhưng kết quả chưa có CI independent status.

**Sửa:** Tách unit tests đã đạt với Windows integration tests thật. Đổi tên test nếu không đo điều đã claim; thêm harness điều khiển Electron/worker subprocess, chạy fault injection và thu SQLite evidence. Giữ kết quả 113 team-run là team-run; không gọi test E2E độc lập nếu không có.

**Test:** clean checkout `pnpm install --frozen-lockfile && pnpm verify`, collect exit code, raw logs, SHA, Node/Electron/SQLite versions, Windows OS; intentionally break a check and assert pipeline nonzero.

#### UB-P2-R02-007 — S2 — Canonical payload input và chính sách thiết kế chưa fail-closed hoàn toàn
**Source:** `packages/storage/src/canonical-json.ts:65–99` object properties `undefined/function/symbol` bị bỏ qua và trong arrays thành `null`; code comments chỉ từ chối undefined **root**. Như vậy hai JS payload khác nhau ở trường unsupported có thể cho cùng canonical bytes. `approveToken()` cho caller tự khai thông tin, cần cùng canonical byte stream từ preview tới execution.

**Sửa:** Với action/approval payload, reject toàn bộ giá trị JSON không chuẩn ở mọi tầng (kể cả arrays) hoặc chuẩn hóa bắt buộc **trước preview** và loại bỏ giá trị unsupported; không chấp nhận payload khác với bản người duyệt đã xem. Phải cố định `canonicalizationVersion` được hỗ trợ và kiểm tra phiên bản lưu DB. `v1:` nên được mô tả chính xác: code `computeCanonicalDigest()` hiện trả 64 ký tự hex, prefix `v1:` nằm ở chuỗi đem băm, version nằm riêng trong record — sửa báo cáo hoặc đổi hợp đồng và migration có test.

**Test:** nested undefined, sparse arrays, function/symbol, -0, Unicode, non-finite, circular, nested tamper, preview/execute byte parity và old-version rejection.

### 4. Các khoản nợ bổ sung (không biến thành vòng review vô tận)

- `backup-manager.ts` đã cải thiện path escaping, checksum, integrity checks, nhưng restore target SQLite **đang mở với WAL sidecars** không có workflow exclusive close/lock; backup `VACUUM INTO` + `wal_checkpoint(TRUNCATE)` cần concurrency tests. Yêu cầu kiểm tra trước P3 data-management release; không khẳng định phục hồi atomic đối với DB đang mở.
- `StorageWorker` hiện dùng schema copy thủ công, không chạy `runMigrations()` canonical hoặc kiểm tra migration checksum giống package `storage`; chỉ khớp tên bảng, không bảo đảm upgrade từ DB cũ. Khi tích hợp lại canonical storage, đóng vấn đề này trong `UB-P2-R02-004`.
- `package.json` cho phép Node >=22, nhưng worker phụ thuộc vào system Node hỗ trợ `node:sqlite`; khóa version runtime hoặc kiểm tra preflight rõ ràng, tránh phải cài Node thủ công vào máy khách ở bản release.
- Với 0đ, approval/`estimatedCost:0` từ renderer không phải chứng cứ chi phí. Cần trusted cost manifest, provider capability evidence trước khi bật external execution; tuyệt đối không kích hoạt paid adapters trong P3.

### 5. Gate R03 — các test tích hợp bắt buộc bổ sung (không buộc viết lại mọi unit test)

| ID | Thực nghiệm thật | PASS bắt buộc |
|---|---|---|
| R03-E01 | Worker không khởi động, sai version Node, timeout init | Không ACK, không RAM fallback mạo danh durable |
| R03-E02 | Worker kill trong request insert | Promise reject/UNKNOWN, không treo; DB all-or-nothing |
| R03-E03 | Electron gửi → kill main → mở lại cùng userData | Đúng envelope/event 1 lần; UI/get-history nhất quán |
| R03-E04 | Hai room/profiles reload đồng thời | Không trộn, không hydrate race/lost update |
| R03-E05 | Approval PENDING/role giả/approverId tự khai | Không thực thi, không audit APPROVED giả |
| R03-E06 | Token scope thiếu, sai workspace/room/actor/recipient | DENY; trạng thái token không tiêu thụ |
| R03-E07 | APPROVED two-worker CAS + restart | Tối đa một consume; digest/scope không đổi |
| R03-E08 | Desktop transaction fault after each write | Không partial idempotency/event/envelope/outbox |
| R03-E09 | External side-effect → kill before ACK | UNKNOWN; zero auto resend; reconcile riêng |
| R03-E10 | PENDING expired after dispatch prepared | Không reset/reuse vô chứng cứ |
| R03-E11 | IPC frame thật: iframe/data URL/second window/null frame | Chỉ trusted main UI frame được phép |
| R03-E12 | Canonical unsupported nested types and preview parity | Reject or normalize before preview, never silent different operation |
| R03-E13 | Restore with active WAL, damaged backup, failed rename | Original target remains valid; no mixed sidecars |
| R03-E14 | Fresh Windows clone → pnpm verify → forced failure | Green suite reproducible, injected failure nonzero |

**Mỗi test phải ghi `TEST_IMPL` và bằng chứng subprocess/log/SQLite; test tự viết lại hàm production chỉ là logic unit test, không thay E2E.**

### 6. Chính sách triển khai cho Phase P3

**Không cấp `GO_P3` chính thức lúc này.** Có thể triển khai UI-only scaffold, Storybook-like static mock gắn nhãn, layout và accessibility song song, nhưng không bật action dispatch không qua gate hoặc che lỗi storage.

Master Plan V3.0 định nghĩa **P3 = Desktop UI dùng được OFFLINE**, gồm:

- `P3-001` onboarding và workspace path selector
- `P3-002` project CRUD với xác nhận và backup
- `P3-003` room CRUD + participant assignments
- `P3-004` message composer Markdown/attachments/drag-drop/@mentions
- `P3-005` timeline chuẩn actor/status/provenance/attachments
- `P3-006` task inbox, steps, dependency, evidence UI
- `P3-007` approval inbox với preview/reject/expiry
- `P3-008` notifications + provider readiness đúng evidence
- `P3-009` search/filter room/message/artifact metadata
- `P3-010` settings có lưu bền và zero-cost indicator
- `P3-011` keyboard/screen reader/high DPI
- `P3-012` empty/loading/error/offline states
- `P3-013` 3-pane resizable layout, persist widths
- `P3-014` help/onboarding demo clearly marked
- `P3-015` (V3.1) context preview trước gửi AI, recipient/file/byte count/egress/consent

**Gate P3:** User mới offline `workspace → project → room → message + PNG/PDF → close/reopen → preview/export`; UI truthful (không giả live AI), không cần web account.

**Các tính năng user nêu đặt đúng roadmap:** Browser Worker Pool, WebContentsView, 4 web providers và cô lập session thuộc **P4** (P4-001…014); artifact bridge/MCP **P5**; Codex local **P6**; Antigravity local **P7**; DAG execution, scheduler, 6-AI coordination **P8**; web-provider extensions và capability verification **P9**. Chỉ định nghĩa schema/placeholder/UI liên quan ở P3, không chuyển những implementation lớn này vào P3.

### 7. Hướng dẫn nộp hồ sơ

Nộp `reports/handoff/REVIEW_PACKET_P2_R03.md`, HEAD commit thực tế, bảng disposition của 7 finding, bằng chứng R03-E01…E14, log/checksum DB, bằng chứng Windows real Electron + worker mode, `pnpm verify` clean checkout và hướng dẫn reproduction; phân biệt `[SOURCE_VERIFIED]`, `[TEAM_EXECUTED]`, `[REVIEWER_EXECUTED]`.

**Không tự push/merge trên danh nghĩa reviewer. Không claim AI integration đã chạy live; không sử dụng API tính phí.**

**Quyết định:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_UI_SCAFFOLD_ALLOWED`.
