# ZERO-COST (0 VNĐ) POLICY & COST MANIFEST — UNION BOT

- **Document ID:** `UB-COST-001`
- **Phase:** `P0`
- **Ticket:** `P0-009`, `P0-016`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `ENFORCED_IN_CODE`

---

## 1. Tuyên ngôn Chi phí 0 VNĐ (Zero-Cost Pledge)
Dự án **Union Bot** cam kết tuyệt đối:
> **KHÔNG MẤT MỘT ĐỒNG PHÍ NÀO (0 VNĐ).**  
> Tuyệt đối không sử dụng bất kỳ API trả phí theo token/credit, không thuê cloud server, không đăng ký trial yêu cầu thẻ tín dụng, không tự động nâng cấp gói dịch vụ.

Hệ thống hoạt động dựa trên:
1. **Các tác tử cục bộ miễn phí:**
   - Antigravity CLI (chạy trên máy trạm thông qua tài khoản bản quyền IDE hiện có).
   - Codex CLI / App Server (chạy cục bộ trên máy trạm).
2. **Các dịch vụ Web AI người dùng tự sở hữu:**
   - ChatGPT Web (giao diện web chính thức, người dùng tự đăng nhập tài khoản của mình).
   - Gemini Web (giao diện web chính thức).
   - Claude Web (giao diện web chính thức).
   - DeepSeek Web (giao diện web chính thức).
3. **Môi trường cục bộ:**
   - Cơ sở dữ liệu SQLite cục bộ (0đ).
   - Content-Addressable Storage cục bộ trên ổ cứng máy trạm (0đ).
   - Đóng gói ứng dụng desktop Windows cục bộ (0đ).

---

## 2. Bảng Danh sách Phê duyệt & Chặn Mạng (Network Rules)

### 2.1. Danh sách Cho phép (Allowlist)
- `localhost`, `127.0.0.1`, `::1` (Giao tiếp nội bộ giữa desktop shell, UI, Codex app server, MCP tools).
- `https://chatgpt.com`, `https://*.chatgpt.com`, `https://*.openai.com` (Duyệt web ChatGPT).
- `https://gemini.google.com`, `https://*.google.com`, `https://*.gstatic.com` (Duyệt web Gemini).
- `https://claude.ai`, `https://*.claude.ai`, `https://*.anthropic.com` (Duyệt web Claude).
- `https://chat.deepseek.com`, `https://*.deepseek.com` (Duyệt web DeepSeek).
- `https://github.com`, `https://api.github.com` (Đẩy mã nguồn và tạo PR khi có sự đồng ý trực tiếp của Product Owner).

### 2.2. Danh sách Chặn Nghiêm ngặt (Denylist - Paid API Endpoints)
Mọi yêu cầu gửi đến các địa chỉ sau sẽ bị **Cost Guard ngắt kết nối ngay lập tức**:
- `api.openai.com` (OpenAI Developer Platform API - tính tiền per token).
- `generativelanguage.googleapis.com` (Google Gemini Developer API tính phí).
- `api.anthropic.com` (Anthropic Developer API tính phí).
- `api.deepseek.com` (DeepSeek Platform API tính phí).
- Mọi domain chứa từ khóa billing, payment, checkout, stripe, paypal.

---

## 3. Cơ chế Thực thi Kỹ thuật (Technical Enforcement)
Mô-đun `@union-bot/cost-guard` được hiện thực hóa và kiểm chuẩn tự động qua **14/14 unit tests**:
1. **Tầng Electron Main:** Cung cấp `installElectronCostGuardInterceptor(session, costGuard)`. Hàm này gắn vào `session.webRequest.onBeforeRequest` trên mọi partition của Electron (`persist:mcb-web-*`). Bất kỳ yêu cầu nào hướng đến Paid API (như `api.openai.com`) hoặc trang thanh toán đều bị hủy ngay lập tức (`callback({ cancel: true })`).
2. **Tầng Node.js Process:** Cung cấp `installNodeCostGuardInterceptor(costGuard)`. Hàm này thiết lập bộ chắn toàn diện tại runtime:
   - Ghi đè an toàn `globalThis.fetch`.
   - Ghi đè `http.Agent.prototype.addRequest` và `https.Agent.prototype.addRequest` (chặn toàn bộ HTTP/1.1 requests qua mọi module CJS/ESM).
   - Ghi đè `net.Socket.prototype.connect` và `http2.connect` (chặn toàn bộ HTTP/2 egress và raw TCP/TLS socket connections đến paid APIs và domain ngoài allowlist).
   - Khi bất kỳ mã nguồn nào gọi fetch/request/connect đến domain bị cấm, hệ thống chặn đứng tức thì và ném lỗi `CostGuardViolationError`.
3. **Audit Log:** Mọi vi phạm đều kích hoạt sự kiện `COST_GUARD_VIOLATION` được ghi vào danh sách vi phạm (`getViolations()`) và thông báo qua callback kiểm toán.

---

## 4. Kết luận P0-009 & R03 Resolution
Chính sách chi phí 0đ được bảo vệ nghiêm ngặt ở cả 2 tầng: tầng phân tích URL tĩnh/động và tầng interceptor mạng runtime (Node.js fetch/Agent/Socket/HTTP2 + Electron session onBeforeRequest). 14/14 bài kiểm thử tự động xác nhận chặn 100% egress tính tiền và ném biệt lệ kiểm toán chính xác.
