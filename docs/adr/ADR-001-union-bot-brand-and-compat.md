# ADR-001: UNION BOT BRAND MIGRATION & BACKWARD COMPATIBILITY

- **Status:** `ACCEPTED`
- **Date:** 2026-10-18
- **Deciders:** Product Owner (User), ChatGPT (Technical Leader), Antigravity (Implementation Owner)
- **Ticket:** `P0-013`

---

## 1. Bối cảnh & Yêu cầu Đổi Tên (Context)
Người dùng (Product Owner) đã chính thức chọn tên thương hiệu mới cho hệ thống: **`Union Bot`**.  
Tên gọi tiền nhiệm trong lịch sử phát triển là `MUTI CHAT BOT` (hoặc `WT Team` / `AI Operating Workspace`).

Theo chỉ đạo bắt buộc từ Technical Leader tại Phụ lục V3.1:
1. Tên thương hiệu hiển thị (Display Name), giao diện UI, tài liệu hướng dẫn, tên bộ cài đặt Windows (`.exe`), thanh tiêu đề cửa sổ, khay hệ thống (tray) phải sử dụng **`Union Bot`**.
2. **Không được phép phá vỡ tương thích dữ liệu cũ:** Không được tự tiện đổi tên các database keys, định danh phân vùng SQLite, hay đường dẫn lưu trữ cấu hình người dùng nếu chưa có cơ chế migration có kiểm thử sao lưu bảo toàn.

---

## 2. Chiến lược Phân nhóm Định danh (3-Tier Classification)

Mọi chuỗi định danh trong toàn bộ hệ thống được chia thành 3 nhóm rõ ràng:

### Nhóm 1: `DISPLAY_ONLY` (Chuyển đổi 100% sang "Union Bot")
- Tiêu đề cửa sổ ứng dụng: `Union Bot — Multi-AI Collaboration Workspace`
- Tên sản phẩm trên giao diện người dùng: `Union Bot`
- Tên bộ cài Windows / Installer: `Union-Bot-Setup-<version>.exe`
- Mục Start Menu & Desktop Shortcut: `Union Bot`
- Bảng About / Giới thiệu phiên bản: `Union Bot v1.0.0 (Core Engine)`
- Tài liệu hướng dẫn sử dụng, Release Notes, Handoff Reports: Dùng `Union Bot`.

### Nhóm 2: `IDENTIFIER_STABLE` (Giữ nguyên hoặc tạo bí danh để bảo vệ tương thích)
- Application ID trên Windows (AppId): `com.unionbot.desktop` (đăng ký alias cho `com.mutichatbot.desktop` để không làm mất pin taskbar của người dùng).
- Local storage prefix: `union-bot:` (hỗ trợ đọc fallback `mcb:`).
- Header giao thức nội bộ: `X-Union-Bot-Version` (hỗ trợ alias `X-MCB-Version`).
- Partition nhúng trình duyệt: `persist:mcb-web-<provider>` (giữ nguyên để người dùng không bị mất phiên đăng nhập cookies đang có khi nâng cấp app).

### Nhóm 3: `MIGRATION_REQUIRED` (Chuyển đổi kèm sao lưu và kiểm thử)
- File cơ sở dữ liệu: Tạo cơ sở dữ liệu mới `union_bot.sqlite`. Nếu phát hiện `muti_chat_bot.sqlite` từ phiên bản cũ, ứng dụng tự động sao lưu bản cũ vào `backups/`, đọc chuyển đổi bản ghi sang `union_bot.sqlite` và ghi log kiểm toán.
- Thư mục dữ liệu người dùng: Chuyển dữ liệu từ `%APPDATA%\muti_chat_bot` sang `%APPDATA%\UnionBot` bằng symlink an toàn hoặc copy có verify SHA256 checksum.

---

## 3. Hệ quả & Tiêu chuẩn Nghiệm thu (Acceptance Criteria)
- Giao diện người dùng sạch sẽ, đồng nhất 100% thương hiệu **Union Bot**.
- Không xảy ra hiện tượng mất phiên đăng nhập các dịch vụ web AI khi người dùng cập nhật từ bản cũ sang bản mới.
- Bộ cài đặt Windows nâng cấp đè mượt mà không tạo ra 2 icon rác trên hệ thống.
