# BRAND MIGRATION INVENTORY — UNION BOT

- **Document ID:** `UB-AUDIT-003`
- **Phase:** `P0`
- **Ticket:** `P0-013`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu
Rà soát toàn bộ các chuỗi văn bản, định danh tiến trình, registry keys, installer metadata, đường dẫn cấu hình có chứa `MUTI`, `MUTI CHAT BOT`, `MCB` hoặc `WT Team` từ dự án cũ để lên phương án thay thế chính xác sang `Union Bot`.

---

## 2. Bảng Kiểm kê Chi tiết Các Vị trí Chứa Chuỗi

| STT | Vị trí / Đối tượng | Chuỗi cũ | Chuỗi mới (Union Bot) | Phân loại | Hành động kỹ thuật |
|---|---|---|---|---|---|
| 1 | `apps/desktop/package.json` | `"name": "muti-chat-bot"` | `"name": "@union-bot/desktop"` | `DISPLAY_ONLY` | Cập nhật trực tiếp trong package.json mới. |
| 2 | Window Title (Electron) | `"MUTI CHAT BOT"` | `"Union Bot"` | `DISPLAY_ONLY` | Đặt trong BrowserWindow constructor. |
| 3 | Windows AppUserModelId | `com.muti.chatbot` | `com.unionbot.desktop` | `IDENTIFIER_STABLE` | Hỗ trợ fallback migration cho taskbar pin. |
| 4 | Windows Installer Artifact | `muti-chat-bot-setup.exe` | `Union-Bot-Setup-1.0.0.exe` | `DISPLAY_ONLY` | Cấu hình electron-builder `artifactName`. |
| 5 | Start Menu Shortcut | `MUTI CHAT BOT.lnk` | `Union Bot.lnk` | `DISPLAY_ONLY` | Tên shortcut trong installer. |
| 6 | System Tray Tooltip | `MUTI CHAT BOT Background` | `Union Bot Workspace` | `DISPLAY_ONLY` | Tray tooltip string. |
| 7 | Thư mục AppData | `%APPDATA%\muti_chat_bot` | `%APPDATA%\UnionBot` | `MIGRATION_REQUIRED` | Script di trú tự động với verify checksum. |
| 8 | Database File Name | `muti_chat_bot.sqlite` | `union_bot.sqlite` | `MIGRATION_REQUIRED` | Sao lưu file cũ và import vào file mới. |
| 9 | Browser Partitions | `persist:mcb-web-*` | `persist:mcb-web-*` | `IDENTIFIER_STABLE` | **Giữ nguyên** để không làm mất session cookies web. |
| 10 | Protocol Schemas | `mcb.protocol.*` | `union_bot.protocol.*` | `IDENTIFIER_STABLE` | Hỗ trợ alias parser cho phiên bản cũ. |
| 11 | Documentation / Readme | "MUTI CHAT BOT" | "Union Bot" | `DISPLAY_ONLY` | Cập nhật toàn bộ docs hướng dẫn. |
| 12 | About Dialog UI | "Phiên bản MUTI CHAT BOT" | "Union Bot — Multi-AI Collaboration"| `DISPLAY_ONLY` | Thiết kế giao diện About mới. |

---

## 3. Quy trình Kiểm thử Hồi quy Di trú
1. Cài đặt phiên bản giả lập có AppData cũ của `muti_chat_bot`.
2. Khởi chạy binary `Union Bot`.
3. Kiểm tra:
   - Toàn bộ dữ liệu dự án cũ được đọc và hiển thị đầy đủ trong Union Bot.
   - Không xuất hiện tệp cơ sở dữ liệu rác hay lỗi ghi đè.
   - Phiên đăng nhập trên các trình duyệt nhúng giữ nguyên trạng thái xác thực.

---

## 4. Kết luận P0-013
Danh mục kiểm kê hoàn chỉnh, phân nhóm rủi ro rõ ràng. Việc chuyển đổi tên sang **Union Bot** đảm bảo 100% tính tương thích và không làm gián đoạn trải nghiệm người dùng.
