# HƯỚNG DẪN CÀI ĐẶT & TRIỂN KHAI WINDOWS PORTABLE

## 1. Yêu cầu hệ thống
- **Hệ điều hành**: Windows 10 (Build 19041+) hoặc Windows 11 x64.
- **Dung lượng đĩa trống**: Tối thiểu 500 MB.
- **Quyền hạn**: Người dùng thông thường (Standard User), **hoàn toàn không cần quyền Administrator**.
- **Môi trường bổ trợ**: **Không yêu cầu** cài đặt sẵn Node.js, pnpm, Python, hay Git. Gói phát hành đã tích hợp sẵn runtime Node 24 và Electron engine.

---

## 2. Các bước triển khai bản Portable
1. Tải về hoặc sao chép thư mục:
   ```
   release/union-bot-portable-win-x64/
   ```
2. Thư mục này có thể đặt tại bất kỳ vị trí hợp lệ nào trên ổ đĩa (ví dụ `D:\UnionBotPortable`, `C:\Users\<Tên_User>\Desktop\UnionBot`).
3. Cấu trúc thư mục phát hành:
   ```
   union-bot-portable-win-x64/
   ├── union-bot.bat          <- Trình khởi chạy chính (Launcher có chuyển mã lỗi an toàn)
   ├── union-bot.exe          <- Ứng dụng Electron
   ├── runtime/
   │   └── node.exe           <- Runtime Node.js 24 cục bộ khép kín
   ├── resources/app/         <- Mã nguồn backend, thư viện và giao diện UI tĩnh
   ├── MANIFEST.sha256        <- Bảng mã băm SHA-256 CAS của toàn bộ tệp trong bản phát hành
   └── data/                  <- Thư mục dữ liệu người dùng (tự tạo khi khởi chạy)
   ```

---

## 3. Khởi chạy và Kiểm tra
- **Khởi chạy ứng dụng**:
  Nhấp đúp chuột vào tệp `union-bot.bat`. Cửa sổ giao diện Union Bot sẽ hiển thị.
- **Chạy kiểm thử khói (Smoke Test)**:
  Để kiểm tra độ toàn vẹn của ứng dụng trên máy mới mà không cần mở giao diện đồ họa, mở Command Prompt hoặc PowerShell tại thư mục ứng dụng và chạy:
  ```cmd
  union-bot.bat --smoke --headless
  ```
  Nếu màn hình hiển thị:
  ```
  [SmokeTest] Smoke test PASS! All assertions verified cleanly.
  ```
  thì bản phát hành đã hoạt động hoàn hảo và sẵn sàng phục vụ công việc.

---

## 4. Gỡ bỏ & Sao lưu dữ liệu
- Vì đây là bản portable khép kín:
  - Khi muốn sao lưu dữ liệu: Sao chép thư mục `data/` sang nơi an toàn.
  - Khi muốn gỡ bỏ hoàn toàn: Chỉ cần đóng ứng dụng và xóa toàn bộ thư mục `union-bot-portable-win-x64`. Không để lại rác trong Windows Registry hay thư mục hệ thống.
