# HƯỚNG DẪN SỬ DỤNG UNION BOT (WINDOWS — BẢN 0 ĐỒNG)

Chào mừng bạn đến với **Union Bot** — Nền tảng điều phối đa AI (6-AI Collaboration: ChatGPT, Gemini, Claude, DeepSeek, Antigravity, Codex) trên môi trường Desktop Windows cục bộ (Local-First).

---

## 1. NGUYÊN TẮC VẬN HÀNH & CAM KẾT 0 ĐỒNG

- **Chi phí bắt buộc:** **0 VND ($0.00)**. Ứng dụng không yêu cầu mua token, không nạp credit, không gọi các API trả phí và chặn hoàn toàn các cổng thanh toán (CostGuard fail-closed).
- **Bảo mật & cô lập ranh giới:** Toàn bộ dữ liệu tác vụ và file tạo ra được bảo vệ trong ranh giới workspace an toàn (`scratch/`). Mọi hành vi path traversal (`../`) đều bị chặn ngay lập tức (*fail-closed* với `ERR_PATH_TRAVERSAL_DENIED`).
- **Thẩm tra mật mã & tính xác thực:** Không có kết quả thành công giả (fake complete). Mọi tệp sinh ra đều được băm mật mã SHA-256 CAS digest và thẩm tra độc lập bởi dịch vụ Codex Native. Huy hiệu `CODEX VERIFIED (0đ)` chỉ hiển thị khi có chứng chỉ thẩm tra hợp lệ.
- **Minh bạch Executor:** 
  - Tác vụ AI Native gọi trực tiếp engine agent (`antigravityService` / `codexService`), không dùng shortcut tạo sẵn dữ liệu.
  - Tiện ích nội bộ (tính toán cục bộ / file mẫu) được gán nhãn trung thực là `LOCAL_UTILITY`, không mạo danh agent để tính đạt chuẩn Native UAT.

---

## 2. CÁCH KHỞI CHẠY ỨNG DỤNG (WORKSPACE RUNNER & ĐÓNG GÓI P11)

### A. Local Workspace Runner (Chạy trực tiếp từ mã nguồn, không installer)
1. **Chạy bằng file Batch:**
   - Mở thư mục gốc `D:\WORK-TEAM`.
   - Nhấp đúp chuột vào tệp **`run-union-bot.bat`**.
   - Launcher sẽ kiểm tra runtime, chuẩn bị vùng cô lập `scratch/` và khởi chạy giao diện Union Bot.
2. **Chạy từ dòng lệnh (PowerShell):**
   ```powershell
   pnpm start
   ```
   *(hoặc: `node apps/desktop/scripts/launch.js`)*
3. **Chạy với Profile kiểm thử độc lập (Không ghi đè dữ liệu cũ):**
   ```powershell
   node apps/desktop/scripts/launch.js --test-user-data=C:/Temp/union-bot-test-profile
   ```

### B. Bản đóng gói độc lập P11 (Standalone Portable Distribution)
- Trong giai đoạn P11, sản phẩm sẽ được xuất xưởng dưới dạng thư mục portable trọn gói nhúng sẵn runtime và binary, người dùng tải về giải nén và nhấp đúp chạy ngay trên bất kỳ máy tính Windows nào mà không cần cài đặt Node.js hay bộ cài installer hệ thống.

---

## 3. HƯỚNG DẪN SỬ DỤNG TÁC VỤ THỰC TẾ (TASKS & EXECUTION)

### Bước 1: Mở giao diện Tác vụ
- Tại thanh điều hướng bên trái (Navigation Bar), chọn mục **Tasks & Execution**.

### Bước 2: Tạo Tác vụ Mới (New Task)
Tại khung **Create New Task**:
1. **Title (Nội dung tác vụ):** Nhập yêu cầu cụ thể.
   - *Tác vụ Native Agent:* `Tạo file scratch/hello.txt chứa nội dung HELLO UNION BOT`
   - *Tác vụ Local Utility:* `UI TEST: Tính 2 + 3 và ghi kết quả 5 (chỉ kiểm tra cục bộ)`
2. **Assign Role (Vai trò):** Chọn vai trò (ví dụ: `Implementer` cho Antigravity hoặc `QA / Security` cho Codex).
   - *Lưu ý:* Hệ thống lưu giữ đúng vai trò đã chọn, không bị tự động đổi thành `CORE`.
3. Bấm nút **Create Task**. Tác vụ được ghi ngay lập tức vào cơ sở dữ liệu SQLite WAL với trạng thái `pending (0%)`.

### Bước 3: Khởi chạy Tác vụ (Start)
- Nhấn nút **Start**:
  - **Khóa Reservation Đồng bộ (Anti-Double-Dispatch):** Hệ thống đặt reservation tức thì trước mọi thao tác bất đồng bộ, loại bỏ triệt để nguy cơ race condition khi nhấn đúp hoặc gọi đồng thời (`Promise.all`).
  - **Tiến trình Phản ánh Thực tế:** Giao diện không sử dụng `setTimeout` hay trạng thái lạc quan giả tạo; tiến trình cập nhật trực tiếp theo sự kiện từ backend:
    - `10%`: Khởi tạo và kiểm tra ranh giới workspace an toàn.
    - `30%`: Executor thực thi (Antigravity/Codex Native hoặc Local Utility) và ghi file vào vùng cô lập `scratch/`.
    - `70%`: Dịch vụ Codex Native tiến hành thẩm tra mật mã (Boundary, Zero-Cost, CAS SHA-256 Digest).
    - `100%`: Hoàn tất và lưu trạng thái bền vững vào SQLite.
- Thẻ tác vụ hiển thị đầy đủ bằng chứng thực thi:
  - **Huy hiệu:** `COMPLETED` và `CODEX VERIFIED (0đ)` (chỉ khi thẩm tra đạt).
  - **Artifact Path:** Đường dẫn file đã ghi (ví dụ: `scratch/hello.txt`).
  - **Kích thước & Mã băm:** Số bytes thực tế (ví dụ: `15 bytes`) và mã SHA-256 CAS digest.
  - **Preview:** Bản xem trước nội dung tệp.

### Bước 4: Hủy Tác vụ (Cancel)
- Khi tác vụ đang chạy, nút **Cancel** có hiệu lực:
  - Hệ thống chuyển trạng thái sang **`cancel_requested`** trong khi đợi executor xác nhận dừng.
  - Khi executor dừng hẳn, tác vụ chuyển sang trạng thái **`cancelled`**, ghi rõ lý do người dùng hủy, không tạo artifact giả mạo.

### Bước 5: Kiểm tra tính Bền vững (Durability)
- Nhấn phím `Ctrl + R` để tải lại giao diện (Reload) hoặc đóng mở lại ứng dụng:
  - Toàn bộ danh sách tác vụ, tiến trình, thông số SHA-256 và chứng chỉ Codex vẫn hiển thị nguyên vẹn từ SQLite WAL.

---

## 4. KẾT NỐI WEB AI & QUY TẮC TRUNG THỰC

Union Bot tích hợp sẵn các phiên duyệt Chromium độc lập cho các mô hình Web AI (ChatGPT, Gemini, Claude, DeepSeek):

1. **Phân vùng biệt lập (Partitions):** Mỗi nhà cung cấp chạy trong phân vùng bộ nhớ và cookie riêng biệt, không đọc trộm dữ liệu chéo.
2. **Trạng thái an toàn WAITING_INPUT & BLOCKED:**
   - Khi người dùng chưa đăng nhập tài khoản Web AI trên tab duyệt, hoặc mô hình web chưa hoàn thành câu trả lời: Hệ thống hiển thị rõ ràng nhãn **`WAITING_INPUT`** hoặc **`BLOCKED`**.
   - Tuyệt đối không tự động gắn nhãn `ACTIVE` giả tạo, không điền dữ liệu giả lập cho kết quả web.
3. **Đăng nhập:** Người dùng tự chủ động đăng nhập vào tài khoản cá nhân của mình trên giao diện trình duyệt nhúng khi cần. Ứng dụng không lưu mật khẩu của người dùng.

---

## 5. BỘ LỆNH KIỂM TRA CHẤT LƯỢNG (QA & VERIFICATION)

Dành cho kiểm thử viên hoặc khi cần xác minh toàn bộ các cửa chất lượng:

| Lệnh | Mục đích kiểm tra | Kết quả chuẩn |
|---|---|---|
| `pnpm uat` | Chạy bộ kiểm thử UAT Desktop P10 tự động trên Windows Electron thật | `PASS (23/23 checks)` |
| `node --test tests/e2e/desktop-p9.test.js` | Chạy kiểm thử hồi quy Phase P9 (E2E & Prod E2E) | `PASS (2/2 tests)` |
| `pnpm smoke:gui` | Khởi chạy giao diện và kiểm tra IPC, CostGuard, Orchestrator | `PASS` |
| `pnpm typecheck` | Kiểm tra tính nhất quán TypeScript monorepo | `0 errors` |
| `pnpm secret-scan` | Quét chống rò rỉ secret / API token / dữ liệu nhạy cảm | `0 leaks` |

---

## 6. XỬ LÝ SỰ CỐ THƯỜNG GẶP (TROUBLESHOOTING)

1. **Ứng dụng báo lỗi "Single Instance Lock":**
   - *Nguyên nhân:* Có một tiến trình Electron cũ đang chạy ngầm.
   - *Khắc phục:* Mở PowerShell và chạy lệnh đóng tiến trình treo:
     ```powershell
     taskkill /F /IM electron.exe
     ```
2. **Không thấy kết quả tệp trong thư mục `scratch/`:**
   - *Nguyên nhân:* Thư mục chưa được cấp quyền hoặc đường dẫn bị thoát khỏi workspace.
   - *Khắc phục:* Ứng dụng đã tự động bảo vệ tạo thư mục `D:\WORK-TEAM\scratch`. Bạn có thể mở trực tiếp thư mục này trong Windows Explorer để xem các tệp kết quả.
3. **Màn hình trắng hoặc không kết nối được giao diện:**
   - *Khắc phục:* Chạy `pnpm build` để cập nhật gói phân phối giao diện `apps/workspace-ui/dist`.
