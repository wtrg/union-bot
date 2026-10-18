# LEGACY CODE MODULE INVENTORY — UNION BOT

- **Document ID:** `UB-AUDIT-002`
- **Phase:** `P0`
- **Ticket:** `P0-002`
- **Date:** 2026-10-18
- **Source Examined:** `D:\muti_chat_bot_package`
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Tổng quan Khảo sát Mã nguồn Tiền nhiệm
Qua phân tích tự động bằng `audit_legacy.py` trên 177 tệp mã nguồn Python, giao diện web HTML/CSS/JS, và tài liệu kiểm thử tại `D:\muti_chat_bot_package`, nhóm Implementation tiến hành phân loại toàn bộ thành phần theo 4 quyết định kỹ thuật bắt buộc:
1. **`KEEP`**: Giữ nguyên tài liệu kiến trúc, test fixtures không vi phạm, dữ liệu kiểm chuẩn.
2. **`WRAP`**: Bọc lại làm reference adapter hoặc test vectors cho bộ kiểm thử hồi quy mới.
3. **`REFACTOR`**: Chuyển đổi logic cốt lõi (envelope, durable queue, approvals, task transitions) từ Python sang TypeScript/Node.js theo chuẩn monorepo V3.0.
4. **`RETIRE`**: Khai tử hoàn toàn các giải pháp chắp vá (DOM scraping trực tiếp, extension injection mỏng manh, server monolothic cũ, browser profile nhúng không an toàn).

---

## 2. Bảng Phân loại Chi tiết Các Module

| Phân hệ / Module | Đường dẫn tiền nhiệm | Ngôn ngữ / Công nghệ | Quyết định | Lý do kỹ thuật & Hướng xử lý |
|---|---|---|---|---|
| **Envelope & Data Schema** | `bridge/models/envelope.py` | Python (Pydantic/Dataclass) | `REFACTOR` | Chuyển đổi sang `packages/protocol/src/envelope.ts` dùng Zod validation; đảm bảo tính tương thích với JSON Schema V3.0 và V3.1. |
| **Durable Task Queue** | `bridge/queue/durable_queue.py` | Python / SQLite | `REFACTOR` | Tái cấu trúc thành `packages/orchestrator/src/queue/` chạy trên SQLite WAL mode của Node.js (`better-sqlite3`), bảo đảm idempotency key và correlation ID. |
| **Approval & Gate System** | `bridge/models/approvals.py`, `bridge/qa/gates.py` | Python | `REFACTOR` | Chuyển sang TypeScript State Machine với cơ chế chữ ký SHA256 và bằng chứng thực thi bắt buộc trước khi chuyển trạng thái. |
| **Audit Logger & Outbox** | `bridge/core/audit.py`, `bridge/server/app.py` | Python / FastAPI / SQLite | `REFACTOR` | Chuyển thành append-only event journal trong `packages/orchestrator/src/journal/` với hash-chaining để ngăn chặn giả mạo log. |
| **Codex Bridge Adapter** | `bridge/adapters/codex_adapter.py` | Python (Subprocess) | `WRAP` / `REFACTOR` | Tham khảo logic xử lý lỗi cũ, chuyển thành `packages/agent-codex/` giao tiếp trực tiếp qua stdio JSON-RPC với `codex app-server` (đã spike thành công). |
| **Antigravity CLI Adapter** | `bridge/adapters/antigravity_adapter.py` | Python (Subprocess) | `WRAP` / `REFACTOR` | Chuyển thành `packages/agent-antigravity/` gọi `agy.exe -p ... --output-format json/stream-json` với quản lý timeout và child process sạch. |
| **Web Browser Automation** | `bridge/adapters/chatgpt_browser.py`, `gemini_browser.py` | Python Playwright / DOM scripts | `RETIRE` | Khai tử toàn bộ DOM scraping giả lập. Chuyển sang kiến trúc chuẩn V3.0: Chromium `WebContentsView` với partition cô lập `persist:mcb-web-*` và chế độ `MANUAL_SHARE` an toàn tuyệt đối. |
| **Chrome Extension Bridge** | `extension/` (manifest.json, content.js) | JS Extension (Manifest V3) | `RETIRE` | Không dùng extension tiêm script vào trang remote; tuân thủ chính sách bảo mật trang và tránh bị hệ thống anti-bot của nhà cung cấp khóa phiên. |
| **Legacy Web Frontend** | `web/index.html`, `web/app.js`, `style.css` | Vanilla JS / CSS | `RETIRE` | Khai tử frontend cũ; thay thế bằng `apps/workspace-ui` sử dụng React 18, Tailwind CSS, Lucide Icons và TypeScript. |
| **Legacy SQLite Database** | `data/muti_chat_bot.sqlite` (172 KB) | SQLite 3 | `WRAP` | Đóng băng làm dữ liệu lịch sử để kiểm tra migration script (`docs/architecture/LEGACY_DATA_MAP.md`); không ghi đè trực tiếp. |
| **Browser User Data Profiles** | `data/*_browser_profile/` | Chrome Profiles | `RETIRE` | Khai tử toàn bộ; không mang cookies hay session cũ sang monorepo mới; tạo partition sạch sẽ và có kiểm soát quyền. |
| **Pytest Test Suites** | `tests/test_audit_*.py`, `test_repair_*.py` | Python Pytest (120+ test cases) | `WRAP` | Giữ nguyên trong test fixture để chạy đối chiếu hoặc chuyển đổi các scenario vàng sang Vitest/Playwright trong `tests/integration/` và `tests/e2e/`. |
| **Architecture Documentation** | `docs/` | Markdown | `KEEP` | Giữ lại các phân tích lỗi lịch sử (MCB-AUDIT-001..005) phục vụ tra cứu hồi quy. |

---

## 3. Bản đồ Kế thừa (Migration Matrix)

```
[Legacy Codebase: D:\muti_chat_bot_package]
      │
      ├── Python Backend (FastAPI, SQLite, Subprocess)
      │     └── REFACTOR ──> [packages/protocol] (TypeScript, Zod)
      │     └── REFACTOR ──> [packages/orchestrator] (Node.js, WAL SQLite)
      │     └── REFACTOR ──> [packages/agent-codex] (stdio JSON-RPC)
      │     └── REFACTOR ──> [packages/agent-antigravity] (Headless CLI)
      │
      ├── Python DOM Scrapers & Extension (Playwright, MV3 Extension)
      │     └── RETIRE ────> [apps/desktop] (Electron WebContentsView + Manual Share)
      │
      └── Vanilla Web UI (app.js, style.css)
            └── RETIRE ────> [apps/workspace-ui] (React + Tailwind CSS + Lucide)
```

---

## 4. Kết luận P0-002
Toàn bộ mã nguồn cũ đã được rà soát rõ ràng. Không có tình trạng mang mã rác hay cơ chế scraping vi phạm chính sách sang hệ thống mới **Union Bot**.
