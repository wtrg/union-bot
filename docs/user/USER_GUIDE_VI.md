# HƯỚNG DẪN SỬ DỤNG UNION BOT (WINDOWS PORTABLE V3.1)

## 1. Giới thiệu tổng quan
**Union Bot** là ứng dụng desktop độc lập (standalone portable) trên Windows x64 hỗ trợ làm việc cộng tác đa AI (Multi-AI Collaboration Desktop Workspace).
Ứng dụng tuân thủ nghiêm ngặt nguyên tắc **Zero-Cost ($0.00)**:
- Không yêu cầu cài đặt Node.js hay pnpm toàn cục trên máy người dùng.
- Không yêu cầu quyền Administrator / can thiệp Registry.
- Không tự động kích hoạt API trả phí hoặc tiêu tốn credit.

---

## 2. Khởi động ứng dụng
1. Giải nén thư mục phát hành `union-bot-portable-win-x64`.
2. Chạy tệp **`union-bot.bat`** (hoặc tạo lối tắt Shortcut ra Desktop).
3. Ứng dụng sẽ tự động mở giao diện người dùng chính (Workspace UI). Toàn bộ dữ liệu phiên làm việc, lịch sử phòng chat, và kho tệp CAS được lưu cục bộ tại thư mục `data/` trong cùng gói phát hành.

---

## 3. Các tính năng cốt lõi

### 3.1. Quản lý Dự án & Workspace Canonical
- Nhấn nút **New Project** hoặc chọn từ danh sách thả xuống trên thanh tiêu đề.
- Hỗ trợ đặt tên tiếng Việt có dấu và khoảng trắng (ví dụ: `Nghiệm thu Việt Nam 21 10`).
- **Chọn thư mục Workspace**: Sử dụng nút **Browse...** để liên kết dự án với thư mục làm việc thực tế trên ổ đĩa.
- Mọi tác vụ của dự án được cách ly nghiêm ngặt bên trong thư mục này; cơ chế bảo vệ ranh giới (Path Traversal Defense) sẽ ngăn chặn fail-closed mọi hành vi ghi file thoát ra ngoài thư mục.

### 3.2. Quản lý Phòng làm việc (Rooms)
- Mặc định gồm 4 phòng chuẩn:
  - `orchestration`: Điều phối chung và theo dõi quyết định của Technical Leader.
  - `agent-dev`: Luồng thực thi và triển khai của Antigravity & Codex.
  - `qa-audit`: Giám sát chi phí 0đ, rà soát an ninh và nhật ký audit.
  - `review-briefing`: Tổng hợp báo cáo và đồng bộ chỉ đạo kỹ thuật.
- Người dùng có thể nhấn **+ Add Room** để tạo thêm phòng mới theo nhu cầu của dự án.

### 3.3. Hộp tác vụ (Tasks Inbox) & Điều phối Tác vụ
- Xem danh sách tác vụ được lọc theo dự án đang kích hoạt (Project Scoping).
- Tạo tác vụ mới với vai trò phân công rõ ràng (`IMPLEMENTER`, `QA_SECURITY`, `LOCAL_UTILITY`).
- Khi nhấn **Execute**:
  - Tác vụ được thực thi với đường dẫn thư mục đã được xác thực từ Dự án (`canonical project root`).
  - Hệ thống ngăn chặn xung đột double-dispatch và ngăn chặn hủy nhầm tiến trình khi chuyển đổi giữa các dự án.

### 3.4. Quản lý Tệp đính kèm & Kho lưu trữ CAS (Content-Addressable Storage)
- Nhấn biểu tượng đính kèm (📎) để gửi tệp (hình ảnh PNG, văn bản, mã nguồn...).
- Tệp được tính mã băm SHA-256 duy nhất và lưu trữ toàn vẹn theo nội dung.
- Thẻ tệp (Artifact Card) hiển thị kích thước chính xác và mã băm SHA-256 đã xác minh.

### 3.5. Sao lưu & Phục hồi toàn vẹn (Export / Import Bundle - UAT-021)
- **Xuất gói sao lưu (📦 Export Bundle)**:
  - Xuất toàn bộ lịch sử trò chuyện (`transcript.md`), dữ liệu phong bì có cấu trúc (`envelopes.json`), và toàn bộ tệp đính kèm thực tế vào thư mục `artifacts/`.
  - Tệp tóm lược `manifest.json` ghi nhận đầy đủ mã băm SHA-256 và kích thước byte.
- **Phục hồi gói sao lưu (📥 Import Bundle)**:
  - Chọn thư mục gói sao lưu cần phục hồi.
  - Hệ thống tự động pre-validate 100% tệp đính kèm và cấu trúc dữ liệu trước khi nạp vào hệ thống.
  - Nếu phát hiện tệp thiếu hoặc sai lệch mã băm/dung lượng, quá trình phục hồi sẽ bị từ chối fail-closed ngay lập tức, không gây ô nhiễm cơ sở dữ liệu.

### 3.6. Bảng điều khiển trình duyệt nhúng (Browser Panel)
- Nhấn nút **AI Web Hub** trên Header để mở bảng điều khiển 4 tab AI web: ChatGPT, Gemini, Claude, DeepSeek.
- Sử dụng phân vùng biệt lập (isolated partitions), hỗ trợ chia sẻ thông tin thủ công (Manual Handoff) an toàn vào phòng trò chuyện.

---

## 4. Xử lý sự cố thường gặp
- **Ứng dụng không mở cửa sổ**: Kiểm tra xem có phiên bản trước đang chạy nền hay không. Tệp `union-bot.bat` có cơ chế Single Instance Lock để tránh xung đột dữ liệu.
- **Lỗi từ chối đường dẫn khi thực thi tác vụ**: Đảm bảo tệp mục tiêu nằm trong thư mục Workspace của dự án; không sử dụng đường dẫn tương đối trỏ ra ngoài thư mục cha (`..`).
- **Phục hồi gói thất bại (ERR_CHECKSUM_MISMATCH)**: Kiểm tra lại các tệp trong thư mục `artifacts/` của gói sao lưu xem có bị chỉnh sửa nội dung bên ngoài hay không.
