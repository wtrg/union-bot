# UNION BOT — CHỈ THỊ KỸ THUẬT PHASE P2 ROUND R05
**Trạng thái cổng:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_OFFLINE_UI_SCAFFOLD_ALLOWED`  
**Reviewer:** Technical Leader / Reviewer (ChatGPT Web)  
**Implementation Owner:** Antigravity  
**QA / Security Lead:** Codex  

---

## I. Ba Bất Biến Kiến Trúc Phải Đạt (3 S1 Blockers)

| Blocker | Mức độ | Bất biến bắt buộc |
| :--- | :--- | :--- |
| **UB-P2-R04-01** | **S1** | **Một nguồn migration chuẩn:** TypeScript (`StorageEngine`), Electron Native SQLite và Node Worker phải mở chéo cùng một file SQLite database mà không lệch checksum hoặc schema (`ERR_MIGRATION_TAMPERED`). Không ghi checksum rỗng `e3b0c442...`. |
| **UB-P2-R04-02** | **S1** | **Atomic Approval Consumption & Commit:** Tiêu thụ token approval (`APPROVED` -> `CONSUMED`) và ghi nhận hành động ủy quyền (envelope, event, idempotency, outbox) phải commit hoặc rollback cùng nhau trong cùng một SQLite atomic transaction. Không được để token biến thành `CONSUMED` khi transaction lưu trữ chưa commit hoặc bị crash. |
| **UB-P2-R04-03** | **S1** | **Durable Idempotency Check Trước Approval Gate:** Replay của action đã hoàn tất phải đối chiếu Idempotency cache/storage TRƯỚC KHI kiểm tra Approval token. Duplicate chính xác trả cached ACK ngay lập tức mà không đòi hỏi unconsumed token hay ném lỗi `ALREADY_CONSUMED`. |

### Thứ tự xử lý chuẩn cho Action Pipeline:
1. **Validate Envelope + ActionIntent**: Kiểm tra schema, cấu trúc intent.
2. **Compute Canonical Digest + CostGuard**: Băm chuẩn hóa payload (`computeCanonicalDigest`), kiểm tra hạn mức chi phí 0đ.
3. **Durable Idempotency Lookup**:
   - Nếu đã `COMPLETED` và cùng digest → trả cached ACK ngay (`deduplicated: true`).
   - Nếu trùng ID nhưng khác digest → từ chối ngay (`ERR_PAYLOAD_MISMATCH`).
4. **SQLite Atomic Transaction**:
   - Approval CAS (`UPDATE approvals SET status = 'CONSUMED' WHERE id = ? AND status = 'APPROVED' AND payload_digest = ?`)
   - Lưu idempotency record (`status = 'COMPLETED'`)
   - Lưu envelope + event + outbox
5. **COMMIT → Durable ACK**:
   - Nếu có tác động ngoại tác, ghi `DISPATCH_PREPARED` trước khi thực thi. Không giữ transaction SQLite mở trong khi gọi browser/CLI/network.

---

## II. Danh Mục 8 Regression Vectors Bắt Buộc (R05-H01 .. R05-H08)

### R05-H01 — Worker tạo database mới, TypeScript mở chéo
- **Mục tiêu:** Chứng minh checksum, migration registry và schema tương thích thực sự.
- **Thiết lập:** Tạo SQLite database mới trong thư mục tạm bằng `StorageServiceClient` với `forceWorker: true`, dùng Node 24.
- **Các bước:**
  1. Worker khởi tạo database và ghi 1 room, 1 envelope.
  2. Đóng worker hoàn toàn.
  3. Mở cùng đường dẫn database bằng `new StorageEngine({ filename: dbPath, wal: true })` trong TypeScript.
  4. Đối chiếu `schema_migrations`, bảng/index, `PRAGMA integrity_check`, `PRAGMA foreign_key_check`.
  5. Thử sửa migration checksum rồi mở lại.
- **Điều kiện PASS:** Không có `ERR_MIGRATION_TAMPERED` trên DB hợp lệ; checksum khớp registry chuẩn; bảng `dag_nodes`, `snapshots` và index cần thiết tồn tại; dữ liệu không mất. Checksum lạ phải bị từ chối, không được âm thầm sửa.

### R05-H02 — TypeScript tạo DB, Electron native và worker cùng mở
- **Mục tiêu:** Chứng minh tương thích hai chiều và không tạo schema rút gọn.
- **Thiết lập:** TypeScript `StorageEngine` tạo database với dữ liệu phòng, event, approval, outbox và DAG/snapshot.
- **Các bước:**
  1. Đóng TS connection.
  2. Mở chính file đó bằng Electron native SQLite.
  3. Đọc và ghi dữ liệu, đóng connection.
  4. Mở lại bằng worker Node 24.
  5. Đọc/ghi rồi quay lại TypeScript kiểm tra lần cuối.
- **Điều kiện PASS:** Toàn bộ dữ liệu còn nguyên; migration version/name/checksum khớp; `journal_mode=WAL`, `foreign_keys=ON`; không mất bảng/index business. Database có future migration version không được ghi bằng runtime cũ.

### R05-H03 — Nâng cấp DB Legacy R02/R03/R04
- **Mục tiêu:** Không đánh đổi dữ liệu cũ để lấy schema mới.
- **Fixtures:** Ba DB legacy độc lập (chứa envelope, event, approval nhiều trạng thái, outbox `QUEUED` và `UNKNOWN_NEEDS_RECONCILIATION`, idempotency có digest cũ hoặc NULL).
- **Các bước:**
  1. Backup DB trước nâng cấp và tính SHA256.
  2. Kiểm tra integrity, nhận diện đúng schema legacy đã biết (fingerprint).
  3. Chạy migration bổ sung bằng transaction.
  4. Restart, chạy migration lần hai.
  5. Mở chéo bằng TS, native và worker.
  6. Gây lỗi giữa migration và xác nhận rollback.
- **Điều kiện PASS:** Không mất bản ghi hay trạng thái; `UNKNOWN` không chuyển thành `QUEUED`; approval `CONSUMED` không bị làm mới; migration chạy lại không lỗi; checksum mới đúng registry. Với checksum không nhận diện được, hệ thống phải DENY. Không đơn giản thay chuỗi `e3b0c442...` bằng checksum chuẩn cho mọi DB bừa bãi.

### R05-H04 — Crash sau approval consume nhưng trước commit
- **Mục tiêu:** Triệt tiêu lỗi token đã `CONSUMED` nhưng hành động chưa được ghi.
- **Thiết lập:** Token `APPROVED` cho action A; database tạm; bộ đếm side effect = 0.
- **Fault injection bắt buộc:**
  - `after_approval_consume`
  - `before_envelope_insert`
  - `after_event`
  - `before_commit`
- **Các bước:** Gây exception hoặc kill worker tại từng checkpoint, mở lại SQLite và kiểm tra `approvals`, `idempotency_keys`, `envelopes`, `events`, `outbox`.
- **Điều kiện PASS:** Nếu chưa COMMIT, token vẫn có trạng thái có thể phục hồi an toàn, không có bản ghi hoàn thành mồ côi, không ACK giả và không side effect. Nếu đã COMMIT, toàn bộ bản ghi liên quan phải cùng tồn tại. FAIL ngay nếu `approval.status='CONSUMED'` nhưng không có durable authorization/dispatch record tương ứng.

### R05-H05 — Replay chính xác action sau khi restart
- **Mục tiêu:** Replay không tiêu thụ lại token hoặc gửi thêm tác vụ.
- **Thiết lập:** Action A có approval hợp lệ đã được lưu thành công bằng Electron IPC.
- **Các bước:**
  1. Gửi A và nhận ACK sau commit.
  2. Hard kill Electron main process.
  3. Khởi động lại với cùng `userData`.
  4. Gửi lại đúng envelope ID và ActionIntent A.
  5. Đếm envelope/event/outbox và kiểm tra token.
- **Điều kiện PASS:** Trả `success: true`, `deduplicated: true` cùng kết quả đã lưu; không tiêu thụ thêm token; không có event/outbox mới và không thực thi lại. FAIL nếu trả `ALREADY_CONSUMED` cho một action đã hoàn tất và replay giống hệt.

### R05-H06 — Cùng action ID nhưng thay đổi nested payload
- **Mục tiêu:** Chặn replay với nội dung đã bị thay đổi.
- **Thiết lập:** Action A đã `COMPLETED`.
- **Các trường phải thử sửa lần lượt:**
  - `args.path`
  - `args.options.overwrite`
  - `args.content`
  - `recipient`
  - `workspaceId`
  - `roomId`
  - `policyVersion`
- **Điều kiện PASS:** Mỗi thay đổi có ý nghĩa đối với action đều khiến request cùng ID bị `ERR_PAYLOAD_MISMATCH`; không phát sinh thêm approval consumption, event, outbox hoặc side effect. Kiểm tra cả native và worker, bao gồm hai request cạnh tranh.

### R05-H07 — Action được phê duyệt thành công qua Electron IPC thật
- **Mục tiêu:** Xác nhận luồng approval hoạt động ở production path, không chỉ trong unit test.
- **Thiết lập:** ActionIntent A có nested args và recipient cụ thể. Renderer hiển thị preview; người dùng xác nhận qua luồng trusted confirmation. Sử dụng fake local tool miễn phí (0đ).
- **Các bước:**
  1. Hiển thị preview A với tool, args, đích, dữ liệu và policy.
  2. Tính digest từ ActionIntent A.
  3. Main process xác thực người duyệt và phát hành quyết định.
  4. Renderer gửi request qua `window.unionBotAPI`.
  5. Worker xác minh cùng digest và commit.
  6. Thay recipient hoặc nested args sau preview rồi thử lại token cũ.
- **Điều kiện PASS:** `previewDigest === approvedDigest === consumedDigest === recordedDigest`; action A được ghi đúng một lần; sửa dữ liệu sau preview phải DENY. Approval token ID nằm ngoài phần semantic input được băm.

### R05-H08 — Crash/restart và recovery đầy đủ
- **Mục tiêu:** Chứng minh hệ thống không nhầm trạng thái sau các điểm crash khác nhau.
- **4 trường hợp kiểm thử:**
  1. *Crash khi transaction chưa commit*: Rollback sạch; token không mất oan.
  2. *Crash sau COMMIT nhưng trước IPC ACK*: Đọc lại committed record và trả cached result; không gửi lại.
  3. *Crash sau DISPATCH_PREPARED khi chưa rõ ngoại tác*: `UNKNOWN_NEEDS_RECONCILIATION`; tuyệt đối không auto-resend.
  4. *Worker chết sau khi app đã READY*: UI chuyển `ERROR`/read-only; mutation IPC DENY.
- **Điều kiện PASS:** Sau mỗi trường hợp, reopen SQLite, chạy integrity check và ghi lại số lượng event/outbox, trạng thái approval, PID/exit code và trạng thái UI.

---

## III. Bốn Carryover (R04-C01 .. R04-C04)
- **R04-C01**: Phê duyệt phải thể hiện ý định thật của con người (preview đầy đủ, xác nhận tin cậy).
- **R04-C02**: Chuẩn hóa hợp đồng ActionIntent (tách biệt semantic fields với transport metadata).
- **R04-C03**: Worker chết khi ứng dụng đang hoạt động (main bắt sự kiện worker exit lúc runtime, chuyển UI sang `ERROR_BLOCKED`, từ chối mutation).
- **R04-C04**: Giữ đúng phạm vi Phase P3 (Desktop Workspace UI offline, không claim multi-agent autonomous runtime).

---

## IV. Tiêu Chuẩn Nghiệm Thu R05
- Bộ test mới bổ sung, không thay thế 142 bài test cũ.
- Tất cả các bài test phải chạy thực tế trên Windows (Node 24, SQLite, Electron, Playwright).
- Tạo hồ sơ `reports/handoff/REVIEW_PACKET_P2_R05.md`.
- Đẩy commit mới lên GitHub `main`.
- Gửi packet vào ChatGPT Web để xin sign-off chính thức `APPROVED — GO_P3`.
