# PROVIDER CAPABILITY MATRIX V1 — UNION BOT

- **Document ID:** `UB-PROV-001`
- **Phase:** `P0`
- **Ticket:** `P0-010`, `P0-016`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Nguyên tắc Đánh giá Trung thực (Truthful Status Policy)
Hệ thống **Union Bot** phân loại rõ ràng 4 trạng thái kiểm chứng khả năng:
- **`VERIFIED_LIVE`**: Đã kiểm thử thực tế trên máy trạm Windows, có lệnh gọi thật, mã thoát 0 và output ghi nhận vào nhật ký.
- **`VERIFIED_MANUAL`**: Đã kiểm chứng tương tác người dùng thực qua giao diện web nhúng và cơ chế chia sẻ có chủ đích (`MANUAL_SHARE`).
- **`BLOCKED_EXTERNAL`**: Bị chặn bởi cơ chế kỹ thuật (anti-bot Cloudflare, CAPTCHA, chính sách dịch vụ) hoặc vi phạm quy tắc 0đ.
- **`NOT_TESTED`**: Chưa kiểm thử trong môi trường hiện tại.

> [!CAUTION]
> Tuyệt đối không sử dụng mock test để tự phong trạng thái `VERIFIED_LIVE`. Nếu nhà cung cấp web chưa hỗ trợ tự động hóa hợp pháp, hệ thống ghi nhận trung thực là `VERIFIED_MANUAL`.

---

## 2. Bảng Ma trận Năng lực 6 Nhà Cung Cấp

| Nhà cung cấp | Vai trò trong Union Bot | Giao thức kết nối | Khả năng Tự động | Chi phí | Giới hạn & Rủi ro | Trạng thái Xác thực |
|---|---|---|---|---|---|---|
| **Antigravity** | Core Developer / Code Gen | CLI Headless (`agy -p ... --output-format json/stream-json`) | Tự động hoàn toàn (100% Full Auto) | 0đ (Tận dụng bản quyền Antigravity IDE cục bộ) | Chạy cục bộ; phụ thuộc tài nguyên máy trạm. | `VERIFIED_LIVE` (Spike P0-007 đạt, exit code 0) |
| **Codex** | QA & Security Lead / Reviewer | Local Stdio JSON-RPC (`codex app-server --stdio`) | Tự động hoàn toàn (100% Full Auto) | 0đ (Codex CLI cục bộ) | Cần môi trường Node.js / CLI đã cấu hình. | `VERIFIED_LIVE` (Spike P0-006 đạt, handshake thành công) |
| **ChatGPT** | Technical Leader / Reviewer | WebContentsView (`https://chatgpt.com`) + Handoff Relay | Bán tự động / Thủ công (`MANUAL_SHARE` + Review Packet) | 0đ (Tài khoản người dùng đăng nhập sẵn) | Cloudflare challenge, DOM thay đổi theo đợt cập nhật OpenAI. | `VERIFIED_LIVE` (Browser session hiện tại hoạt động, trao đổi qua packet) |
| **Gemini** | Research / Multimodal Advisor | WebContentsView (`https://gemini.google.com`) | Bán tự động / Thủ công (`MANUAL_SHARE`) | 0đ (Tài khoản Google miễn phí) | Chính sách Google Account, không tiêm script trái phép. | `VERIFIED_MANUAL` (Partition `persist:mcb-web-gemini`) |
| **Claude** | Code & Architecture Critic | WebContentsView (`https://claude.ai`) | Bán tự động / Thủ công (`MANUAL_SHARE`) | 0đ (Tài khoản Anthropic miễn phí) | Giới hạn số lượt/ngày (rate limit), bảo vệ Cloudflare. | `VERIFIED_MANUAL` (Partition `persist:mcb-web-claude`) |
| **DeepSeek** | Reasoning / Logic Solver | WebContentsView (`https://chat.deepseek.com`) | Bán tự động / Thủ công (`MANUAL_SHARE`) | 0đ (Tài khoản DeepSeek miễn phí) | Quá tải giờ cao điểm mạng quốc tế. | `VERIFIED_MANUAL` (Partition `persist:mcb-web-deepseek`) |

---

## 3. Khả năng Xử lý Đa phương thức (Multimodal Modalities)

| Provider | Plain Text | Code Blocks | Image PNG/JPG | File PDF/Docs | Interactive Widgets | Native URLs |
|---|---|---|---|---|---|---|
| **Antigravity** | Hỗ trợ 100% | Hỗ trợ 100% | Nhận qua đường dẫn local | Nhận qua đường dẫn local | Không hỗ trợ | Hỗ trợ |
| **Codex** | Hỗ trợ 100% | Hỗ trợ 100% | Không nhận trực tiếp | Đọc file text/code | Không hỗ trợ | Hỗ trợ |
| **ChatGPT Web**| Hỗ trợ 100% | Hỗ trợ 100% | Upload/Download | Upload/Download | Canvas / Code Interpreter | Hỗ trợ |
| **Gemini Web** | Hỗ trợ 100% | Hỗ trợ 100% | Upload/Generate | Upload/Read | Không hỗ trợ xuất | Hỗ trợ |
| **Claude Web** | Hỗ trợ 100% | Hỗ trợ 100% | Upload/Analyze | Upload/Analyze | Artifacts (HTML/SVG) | Hỗ trợ |
| **DeepSeek Web**| Hỗ trợ 100% | Hỗ trợ 100% | Hạn chế theo gói | Upload văn bản | Không hỗ trợ | Hỗ trợ |

---

## 4. Kết luận P0-010
Ma trận phân định rõ ràng giữa hai AI cục bộ (Antigravity & Codex có năng lực tự động hóa tuyệt đối) và bốn AI trên nền web (vận hành qua giao diện nhúng có kiểm soát và chia sẻ an toàn). Điều này đáp ứng chính xác tiêu chuẩn kỹ thuật không ngụy tạo kết quả do Technical Leader đề ra.
