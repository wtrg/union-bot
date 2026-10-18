# LEGACY DATA & PERSISTENCE AUDIT — UNION BOT

- **Document ID:** `UB-ARCH-001`
- **Phase:** `P0`
- **Ticket:** `P0-004`
- **Date:** 2026-10-18
- **Source Database:** `D:\muti_chat_bot_package\data\muti_chat_bot.sqlite` (172,032 bytes)
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu & Phạm vi
Phân tích toàn diện cấu trúc cơ sở dữ liệu SQLite của hệ thống tiền nhiệm để:
1. Đánh giá chất lượng và lược đồ quan hệ (Schema) hiện hữu.
2. Xác định các trường dữ liệu giá trị cần bảo toàn khi người dùng nâng cấp.
3. Lập chiến lược di trú (Migration Plan) hoặc ánh xạ (Schema Mapping) sang lược đồ mới của **Union Bot** mà không gây xung đột định danh (`muti` vs `union-bot`).

---

## 2. Kiểm kê Thực tế Lược đồ Cũ

Bảng thống kê 17 bảng trong `muti_chat_bot.sqlite`:

| Bảng dữ liệu | Số bản ghi | Vai trò trong hệ thống cũ | Chiến lược sang Union Bot |
|---|---|---|---|
| `projects` | 1 | Quản lý dự án workspace | Giữ nguyên khái niệm, ánh xạ sang `projects` trong Union Bot. |
| `conversations` | 3 | Các phòng thảo luận / hội thoại đa bên | Ánh xạ sang `rooms` (hỗ trợ phân loại chat/collaboration). |
| `messages` | 17 | Tin nhắn người dùng & AI | Ánh xạ sang `messages` mới có gắn trường `fidelity` và `provenance`. |
| `message_recipients` | 36 | Bảng quan hệ định tuyến tin nhắn | Tích hợp trực tiếp vào schema routing của Orchestrator. |
| `agent_sessions` | 3 | Phiên chạy của từng AI adapter | Tách biệt thành `agent_instances` quản lý process lifecycle. |
| `agent_turns` | 55 | Lượt trả lời của từng tác tử | Ánh xạ sang `turn_ledger` có bằng chứng xác minh (evidence ID). |
| `tasks` | 12 | Nhiệm vụ kỹ thuật cần giải quyết | Ánh xạ sang `task_board` với đầy đủ trạng thái V3.0 & V3.1. |
| `task_transitions` | 98 | Lịch sử chuyển trạng thái task | Ánh xạ sang append-only `event_journal`. |
| `approvals` | 1 | Quyết định phê duyệt của người dùng | Ánh xạ sang `approvals` với chữ ký SHA256 bắt buộc. |
| `pr_reviews` | 18 | Hồ sơ đánh giá mã nguồn / patch | Ánh xạ sang `review_dossiers` (phục vụ Reviewer Handoff). |
| `bugs` | 0 | Nhật ký phát hiện lỗi | Ánh xạ sang `bug_tracker`. |
| `test_runs` | 0 | Lịch sử chạy kiểm thử tự động | Ánh xạ sang `test_execution_ledger`. |
| `agent_jobs` | 70 | Hàng đợi công việc nền | Ánh xạ sang `orchestrator_queue`. |
| `outbox` | 248 | Hàng đợi gửi tin nhắn ngoại vi | Ánh xạ sang durable `outbox` với cơ chế idempotency. |
| `audit_events` | 378 | Nhật ký kiểm toán bảo mật | Ánh xạ sang `audit_trail` dạng chuỗi hash SHA256 chống giả mạo. |
| `settings` | 1 | Cấu hình ứng dụng cục bộ | Ánh xạ sang `app_settings` (cô lập per-workspace). |
| `attachments` | 3 | Metadata tệp đính kèm | Ánh xạ sang Content-Addressable `artifact_store` (bảo toàn SHA256). |

---

## 3. Kiến trúc Lược đồ Mới của Union Bot

Cơ sở dữ liệu của Union Bot sẽ chạy trên **SQLite với WAL Mode (Write-Ahead Logging)** và Zod runtime schema validation trong Node.js (`better-sqlite3`):
- **PRAGMA journal_mode = WAL;**
- **PRAGMA synchronous = NORMAL;**
- **PRAGMA foreign_keys = ON;**

### Các cải tiến kiến trúc cốt lõi:
1. **Append-Only Event Store:** Bảng `event_journal` là nguồn chân lý duy nhất (Single Source of Truth). Mọi thay đổi trạng thái của task, agent, approval đều được ghi nhận bằng một immutable event kèm hash.
2. **Artifact Content-Addressable Storage (CAS):** Tệp đính kèm không lưu base64 trong bảng tin nhắn. File được lưu tại `.union-bot/artifacts/<sha256>`, trong DB chỉ lưu metadata, hash SHA256, MIME type, byte size và provenance.
3. **Fidelity Attributes:** Mọi message part đều có trường định danh mức độ bảo toàn: `original_bytes`, `rendered_preview`, `screenshot_only`, `reference_only` (tuân thủ ticket `P5-013`).

---

## 4. Kế hoạch Di trú An toàn (Migration & Compatibility)
- **Chính sách không ghi đè:** File `muti_chat_bot.sqlite` được sao lưu nguyên trạng sang `backups/legacy_muti_chat_bot_backup.sqlite` trước bất kỳ thao tác nào.
- **Migration Script (`scripts/migrate_legacy_db.ts`):** 
  - Đọc dữ liệu từ SQLite cũ ở chế độ Read-Only.
  - Chuyển đổi ID phòng, tin nhắn, nhiệm vụ sang cấu trúc Union Bot.
  - Kiểm tra tính toàn vẹn (checksum) số lượng bản ghi trước và sau khi import.
  - Cung cấp cờ CLI `--dry-run` để người dùng kiểm tra trước khi thực thi thực tế.

---

## 5. Kết luận P0-004
Lược đồ dữ liệu cũ hoàn toàn khả thi để chuyển đổi sang kiến trúc Union Bot mà không làm mất lịch sử hội thoại hay cấu hình người dùng. Lược đồ mới bổ sung tính năng chứng thực chữ ký số và bảo vệ đa phương thức theo yêu cầu của Technical Leader.
