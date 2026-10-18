# PROVIDER POLICY & AUTOMATION PERMISSION MATRIX — UNION BOT

- **Document ID:** `UB-PROV-003`
- **Phase:** `P0`
- **Ticket:** `P0-016`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu & Nguyên tắc Pháp lý / Kỹ thuật
Bản ma trận này tách biệt rõ ràng giữa:
1. **Khả năng kỹ thuật (Technical Availability):** Việc một tác tử có thể dùng code để tương tác với trang web.
2. **Quyền & Chính sách dịch vụ (Legal / Terms of Service Permission):** Điều khoản dịch vụ của nhà cung cấp về việc tự động hóa, truy cập giao diện web qua script và bảo vệ tài khoản người dùng.
3. **Quy tắc An toàn Dữ liệu:** Tuyệt đối không lưu mật khẩu, session tokens hay cookies của người dùng vào log, file cấu hình hoặc cơ sở dữ liệu chung.

---

## 2. Bảng Ma trận Đánh giá Chính sách 6 Nhà Cung Cấp

| Nhà cung cấp | Chế độ Tài khoản | Trạng thái Đăng nhập Nhúng | Tự động hóa Prompt (Automation Status) | Khả năng Xuất dữ liệu (Export) | Truy cập Tool / Plugin | Đánh giá Chi phí & Rủi ro | Phân loại Kênh Gửi |
|---|---|---|---|---|---|---|---|
| **Antigravity** | Local Developer License | N/A (Chạy CLI cục bộ) | `APPROVED_FOR_AUTOMATION` (Chính thức qua CLI flags) | Full File System & JSON Stream | Hỗ trợ MCP Tools & Shell Tools | 0 VNĐ (Không phát sinh cước gọi ngoài) | `APPROVED_FOR_LIVE` |
| **Codex** | Local CLI / App Server | N/A (Chạy Stdio JSON-RPC) | `APPROVED_FOR_AUTOMATION` (Chính thức qua App Server stdio) | Full JSON-RPC Responses & Code Diffs | Stdio Tools & Filesystem | 0 VNĐ (Tiến trình cục bộ) | `APPROVED_FOR_LIVE` |
| **ChatGPT** | Web Plus / Free (Giao diện web) | Cho phép nhúng Chromium (Cần xử lý Cloudflare) | `BLOCKED_FOR_DIRECT_DOM_AUTOMATION` (Chính sách chống bot) | Copy tay / Review Packet / Sandbox Download | Code Interpreter, Canvas (Chỉ xem native) | 0 VNĐ (Tài khoản sẵn có). Nguy cơ khóa tài khoản nếu spam DOM script. | `MANUAL_SHARE_ONLY` |
| **Gemini** | Web Google Account | Cho phép nhúng Chromium (OAuth Google có kiểm tra trình duyệt) | `BLOCKED_FOR_DIRECT_DOM_AUTOMATION` (Google Account Policy) | Copy text / Lưu Drive | Google Workspace Extensions (Chỉ native) | 0 VNĐ (Tài khoản Google). Nguy cơ bị văng OAuth nếu can thiệp DOM. | `MANUAL_SHARE_ONLY` |
| **Claude** | Web Free / Pro | Cho phép nhúng Chromium (Bảo vệ Cloudflare Turnstile) | `BLOCKED_FOR_DIRECT_DOM_AUTOMATION` (Anthropic ToS chống bot) | Copy markdown / Tải code block | Artifacts (HTML/React Preview trong iframe) | 0 VNĐ (Tài khoản cá nhân). Giới hạn tần suất gắt gao. | `MANUAL_SHARE_ONLY` |
| **DeepSeek** | Web Free | Cho phép nhúng Chromium | `BLOCKED_FOR_DIRECT_DOM_AUTOMATION` (Chính sách dịch vụ web) | Copy text / Code | Web Search cục bộ | 0 VNĐ (Tài khoản cá nhân). Quá tải giờ cao điểm. | `MANUAL_SHARE_ONLY` |

---

## 3. Khóa Toàn diện Các Điểm cuối Tính cước (Billing Endpoints Blocked)
Đã xác minh và cấu hình trong `packages/cost-guard`:
- `api.openai.com` -> `BLOCKED_PERMANENT`
- `generativelanguage.googleapis.com` -> `BLOCKED_PERMANENT`
- `api.anthropic.com` -> `BLOCKED_PERMANENT`
- `api.deepseek.com` -> `BLOCKED_PERMANENT`

---

## 4. Kết luận P0-016
Hệ thống Union Bot tôn trọng 100% điều khoản dịch vụ của các nhà cung cấp AI. Việc tự động hóa chỉ diễn ra trên các kênh được hỗ trợ chính thức (Antigravity CLI & Codex App Server). Bốn web providers hoạt động trên nền tảng nhúng an toàn với cơ chế `MANUAL_SHARE`, loại trừ triệt để rủi ro bị khóa tài khoản người dùng và bảo đảm không phát sinh bất kỳ chi phí nào.
