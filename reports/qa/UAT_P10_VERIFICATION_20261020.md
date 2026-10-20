# BÁO CÁO NGHIỆM THU UAT THỰC TẾ & KHẮC PHỤC TRIỆT ĐỂ (PHASE P10 / T1+T2)

- **Thời điểm thực hiện:** 2026-10-20
- **Mục tiêu:** Xử lý triệt để lỗi UAT trong `reports/qa/USER_UI_SIMPLE_TASK_20261020.md`: Nút Start chỉ gọi `updateTask(running, 50)`, không dispatch engine; nút Complete giả tạo; vai trò hiển thị `CORE` thay vì vai trò người dùng chọn; thiếu thẩm tra artifact thật.
- **Cam kết chi phí:** $0.00 (Zero Cost), hoàn toàn cục bộ, không dùng API trả phí.

---

## 1. CÁC HẠNG MỤC ĐÃ KHẮC PHỤC (PRIORITY 1)

1. **Kết nối trực tiếp UI vào Engine Native hiện có:**
   - Đã nối `TasksInbox.tsx` thông qua Preload IPC `window.unionBotAPI.executeTask` và `cancelTask` tới `union-bot:task-execute` trong `apps/desktop/src/main.js`.
   - Loại bỏ hoàn toàn nút `Complete` giả mạo cho các tác vụ tự động.
   - Thêm cơ chế **Anti-Double-Dispatch**: Khóa tiến trình bằng map `activeTaskExecutions` và trạng thái `executingTasks` trên React UI để ngăn bấm lặp lại hoặc dispatch trùng.

2. **Bảo tồn đúng Vai trò (Role Preservation):**
   - Đã sửa logic hiển thị vai trò trong `TasksInbox.tsx`: Ưu tiên `t.metadata?.role || t.role || 'IMPLEMENTER'`.
   - Vai trò người dùng chọn (ví dụ: `Implementer`) được lưu trữ chuẩn xác vào SQLite WAL và hiển thị đúng trên giao diện, không bị biến thành `CORE`.

3. **Cập nhật Tiến trình phản ứng (Real-Time Reactive Updates):**
   - Bổ sung kênh sự kiện hai chiều `union-bot:task-updated` giữa Electron main và renderer UI.
   - Giao diện cập nhật tiến trình thực tế (`10% -> 30% -> 70% -> 100%`) và thông điệp trạng thái chi tiết theo thời gian thực.

4. **Thực thi Thật & Thẩm tra Mật mã Codex Native:**
   - Khi giao tác vụ `"Tạo file scratch/hello.txt chứa nội dung HELLO UNION BOT"`:
     - Tệp vật lý được tạo trong thư mục cô lập an toàn `scratch/hello.txt`.
     - Số byte đếm được: chính xác 15 bytes.
     - Tính mã băm mật mã SHA-256 CAS digest: `b275211559074a35071190c102df0142e0d37e6f8a42767abac9074b62db49d7`.
     - Dịch vụ Codex Native tự động thẩm tra: `securityBoundaryVerified: true`, `zeroCostConfirmed: true`, `digestVerified: true`.
     - Giao diện hiển thị trực quan huy hiệu `CODEX VERIFIED (0đ)`, đường dẫn tệp, kích thước bytes, mã băm SHA-256 và xem trước nội dung.
   - Hỗ trợ tính toán cục bộ (ví dụ: `UI TEST: Tính 2 + 3 và ghi kết quả 5 (chỉ kiểm tra cục bộ)` -> ghi kết quả 5 an toàn, băm và thẩm tra).

5. **Phòng thủ Ranh giới An toàn (Boundary Containment Defense):**
   - Kiểm tra đường dẫn thông qua `TaskGraphEngineCJS.verifyWorkspaceBoundary`.
   - Nếu tác vụ yêu cầu đường dẫn vượt ranh giới (ví dụ: `../../escaped.txt`), hệ thống từ chối ngay lập tức (*fail-closed*) với mã lỗi `ERR_PATH_TRAVERSAL_DENIED`, cập nhật trạng thái `failed`, tuyệt đối không ghi file ngoài workspace.

6. **Tính Bền vững (Durability & Reload):**
   - Kết quả thực thi `executionResult` được ghi bền vững vào cơ sở dữ liệu SQLite WAL trong trường `metadata`.
   - Khi tải lại trang (`Ctrl+R`) hoặc mở lại app, toàn bộ lịch sử tác vụ, số bytes, mã băm và chứng chỉ Codex vẫn được truy xuất nguyên vẹn.

---

## 2. BÀN GIAO BẢN PORTABLE WINDOWS & TÀI LIỆU (PRIORITY 2)

1. **Khởi chạy Portable không cần cài đặt hệ thống:**
   - Tạo tệp batch chạy tức thì: `run-union-bot.bat` tại thư mục gốc `D:\WORK-TEAM`.
   - Thêm lệnh `pnpm start` vào `package.json` trỏ trực tiếp tới launcher Electron.
   - Không cần chạy bộ cài đặt hệ thống (installer), không chỉnh sửa registry, không cần quyền Administrator.

2. **Tài liệu Hướng dẫn Tiếng Việt:**
   - Biên soạn hoàn chỉnh tệp `docs/HUONG_DAN_SU_DUNG_VIETNAMESE.md` hướng dẫn chi tiết từ cách mở app, các bước tạo/chạy tác vụ, kiểm tra thẩm tra Codex, quản lý phân vùng Web AI đến bảng lệnh kiểm thử và xử lý sự cố.

---

## 3. BẰNG CHỨNG KIỂM THỬ THẬT (TEST EVIDENCE)

1. **Bộ kiểm thử UAT Desktop P10 (`tests/e2e/desktop-p10-uat.test.js`):**
   - Lệnh: `pnpm uat`
   - Kết quả: **PASS (19/19 checks)** trong 2.39 giây.
   - Bằng chứng JSON: `reports/capability-evidence/ELECTRON_P10_UAT_EVIDENCE.json`.
     - `taskCreated: true`
     - `rolePreservedAsImplementer: true`
     - `execSuccess: true`
     - `execStatusCompleted: true`
     - `reactiveUpdateReceived: true`
     - `doubleDispatchBlocked: true`
     - `persistedCompleted: true`
     - `traversalDenied: true`
     - `calcSuccess: true`
     - `diskFileCreated: true`
     - `diskContentMatches: true (HELLO UNION BOT)`
     - `diskByteSizeMatches: true (15 bytes)`
     - `diskDigestMatches: true (SHA-256 khớp)`
     - `verifiedByCodex: true`
     - `codexZeroCostConfirmed: true`
     - `codexBoundaryVerified: true`
     - `codexDigestVerified: true`
     - `escapedFileBlocked: true`

2. **Kiểm tra Hồi quy GUI Smoke Test (`pnpm smoke:gui`):**
   - Kết quả: **PASS** (Cửa sổ Electron mở thành công, CostGuard chặn API trả phí, IPC hoạt động bình thường).

3. **Kiểm tra An toàn Mật mã (`python scan_secrets.py --strict`):**
   - Kết quả: **PASS** (906 tệp được quét, 0 rò rỉ bí mật).

4. **Kiểm tra Kiểu dữ liệu & Biên dịch (`pnpm typecheck` & `pnpm build`):**
   - Kết quả: **0 errors, build thành công 100%**.
