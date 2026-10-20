# HƯỚNG DẪN SỬ DỤNG UNION BOT (WINDOWS PORTABLE — BẢN 0 ĐỒNG)

Chào mừng bạn đến với **Union Bot** — Nền tảng điều phối đa AI (6-AI Collaboration: ChatGPT, Gemini, Claude, DeepSeek, Antigravity, Codex) trên môi trường Desktop Windows cục bộ (Local-First).

---

## 1. NGUYÊN TẮC VẬN HÀNH & CAM KẾT 0 ĐỒNG

- **Chi phí bắt buộc:** **0 VND ($0.00)**. Ứng dụng không yêu cầu mua token, không nạp credit, không gọi các API trả phí và chặn hoàn toàn các cổng thanh toán.
- **Bảo mật & cô lập ranh giới:** Toàn bộ dữ liệu tác vụ và file tạo ra được bảo vệ trong ranh giới workspace an toàn (`scratch/`). Mọi hành vi path traversal (`../`) đều bị chặn ngay lập tức (*fail-closed*).
- **Thẩm tra mật mã & tính xác thực:** Không có kết quả thành công giả (fake complete). Mọi tệp sinh ra đều được băm mật mã SHA-256 CAS digest và thẩm tra độc lập bởi dịch vụ Codex Native.
- **Bản Portable:** Chạy trực tiếp từ thư mục, **không yêu cầu cài đặt hệ thống (installer)**, không sửa registry, không yêu cầu quyền Administrator.

---

## 2. CÁCH KHỞI CHẠY ỨNG DỤNG (PORTABLE RUNNER)

Ứng dụng đã được cấu hình sẵn để mở tức thì trên Windows bằng một trong các cách sau:

### Cách 1: Chạy bằng file Batch (Khuyên dùng cho người dùng)
1. Mở thư mục gốc `D:\WORK-TEAM`.
2. Nhấp đúp chuột vào tệp **`run-union-bot.bat`**.
3. Cửa sổ giao diện Union Bot sẽ tự động mở lên.

### Cách 2: Chạy từ dòng lệnh (Terminal / PowerShell)
Mở PowerShell tại thư mục `D:\WORK-TEAM` và gõ:
```powershell
pnpm start
```
*(hoặc: `node apps/desktop/scripts/launch.js`)*

### Cách 3: Chạy với Profile kiểm thử độc lập (Không ghi đè dữ liệu cũ)
Nếu muốn mở ứng dụng trong một hồ sơ người dùng tạm thời:
```powershell
node apps/desktop/scripts/launch.js --test-user-data=C:/Temp/union-bot-test-profile
```

---

## 3. HƯỚNG DẪN SỬ DỤNG TÁC VỤ THỰC TẾ (TASKS & EXECUTION)

Đây là luồng tính năng cốt lõi cho phép người dùng giao việc cho các AI Agent thực thi thật, tạo file thật và thẩm tra độc lập.

### Bước 1: Mở giao diện Tác vụ
- Tại thanh điều hướng bên trái (Navigation Bar), chọn mục **Tasks & Execution**.

### Bước 2: Tạo Tác vụ Mới (New Task)
Tại khung **Create New Task**:
1. **Title (Nội dung tác vụ):** Nhập yêu cầu cụ thể.
   - *Ví dụ kiểm tra file:* `Tạo file scratch/hello.txt chứa nội dung HELLO UNION BOT`
   - *Ví dụ tính toán cục bộ:* `UI TEST: Tính 2 + 3 và ghi kết quả 5 (chỉ kiểm tra cục bộ)`
2. **Assign Role (Vai trò):** Chọn vai trò (ví dụ: `Implementer` hoặc `QA / Security`).
   - *Lưu ý:* Hệ thống giữ nguyên vai trò đã chọn, không bị tự động đổi thành `CORE`.
3. Bấm nút **Create Task**.
   - Tác vụ được ghi ngay lập tức vào cơ sở dữ liệu SQLite WAL với trạng thái `PENDING (0%)`.

### Bước 3: Khởi chạy Tác vụ (Start)
- Nhấn nút **Start**:
  - Hệ thống áp dụng cơ chế **Anti-Double-Dispatch**: Nút Start chuyển trạng thái xử lý, chống bấm lặp lại hoặc dispatch trùng.
  - Tiến trình (Progress) cập nhật theo sự kiện thực tế từ backend:
    - `10%`: Khởi tạo môi trường và kiểm tra ranh giới an toàn.
    - `30%`: Sinh nội dung / tính toán kết quả và ghi file vào vùng cô lập `scratch/`.
    - `70%`: Dịch vụ Codex Native tiến hành thẩm tra mật mã (Boundary, Zero-Cost, CAS SHA-256 Digest).
    - `100%`: Hoàn tất và lưu trạng thái bền vững vào SQLite.
- Thẻ tác vụ hiển thị đầy đủ bằng chứng thực thi:
  - **Huy hiệu:** `COMPLETED` và `CODEX VERIFIED (0đ)`.
  - **Artifact Path:** Đường dẫn file đã ghi (ví dụ: `scratch/hello.txt`).
  - **Kích thước & Mã băm:** Số bytes thực tế (ví dụ: `15 bytes`) và mã SHA-256 CAS digest.
  - **Preview:** Bản xem trước nội dung tệp.

### Bước 4: Hủy Tác vụ (Cancel)
- Khi tác vụ đang chạy, nút **Cancel** có hiệu lực:
  - Ngắt tín hiệu thực thi tới executor.
  - Chuyển trạng thái tác vụ thành `CANCELLED`, ghi rõ lý do người dùng hủy, không tạo artifact giả mạo.

### Bước 5: Kiểm tra tính Bền vững (Durability)
- Nhấn phím `Ctrl + R` để tải lại giao diện (Reload) hoặc đóng mở lại ứng dụng:
  - Toàn bộ danh sách tác vụ, tiến trình, thông số SHA-256 và chứng chỉ Codex vẫn hiển thị nguyên vẹn từ SQLite WAL.

---

## 4. KẾT NỐI WEB AI & QUY TẮC TRUNG THỰC

Union Bot tích hợp sẵn các phiên duyệt Chromium độc lập cho các mô hình Web AI (ChatGPT, Gemini, Claude, DeepSeek):

1. **Phân vùng biệt lập (Partitions):** Mỗi nhà cung cấp chạy trong phân vùng bộ nhớ và cookie riêng biệt, không đọc trộm dữ liệu chéo.
2. **Trạng thái an toàn WAITING_INPUT:**
   - Khi người dùng chưa đăng nhập tài khoản Web AI trên tab duyệt, hoặc mô hình web chưa hoàn thành câu trả lời: Hệ thống hiển thị rõ ràng nhãn **`WAITING_INPUT`** hoặc **`BLOCKED`**.
   - Tuyệt đối không tự động gắn nhãn `ACTIVE` giả tạo, không điền dữ liệu giả lập cho kết quả web.
3. **Đăng nhập:** Người dùng tự chủ động đăng nhập vào tài khoản cá nhân của mình trên giao diện trình duyệt nhúng khi cần. Ứng dụng không lưu mật khẩu của người dùng.

---

## 5. BỘ LỆNH KIỂM TRA CHẤT LƯỢNG (QA & VERIFICATION)

Dành cho kiểm thử viên hoặc khi cần xác minh toàn bộ các cửa chất lượng:

| Lệnh | Mục đích kiểm tra | Kết quả chuẩn |
|---|---|---|
| `pnpm uat` | Chạy bộ kiểm thử UAT Desktop P10 tự động trên Windows Electron thật | `PASS (19/19 checks)` |
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
