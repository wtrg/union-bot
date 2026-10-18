# ELECTRON WEBCONTENTSVIEW SPIKE & CAPABILITY EVIDENCE — UNION BOT

- **Document ID:** `UB-SPIKE-003`
- **Phase:** `P0-008` & `Phase P1 Wave 1`
- **Ticket:** `UB-R04-002`, `UB-P1-SEC-001`, `UB-P1-SEC-003`, `UB-P1-QA-005`, `P0-008`
- **Date:** 2026-10-18 (Updated for Leader R05 Directive)
- **Runtime:** Electron v33.4.11 / Chromium 130.0.6723.191 / Node v24.17.0 / Windows 11 x64
- **Author:** Antigravity (Implementation Owner) & Codex (QA Lead)
- **Status:** `VERIFIED_LIVE — SAFE_ROUTING_HARDENED`

---

## 1. Mục tiêu & Ranh giới Kỹ thuật (Technical Scope)

Thực hiện yêu cầu kiểm chuẩn của Technical Leader tại Round R04 và chỉ thị P1 Round R05:
1. Xây dựng spike Electron tối thiểu tại `spikes/electron-browser/`.
2. Kiểm chứng khả năng nạp thực tế của `BrowserWindow` và `WebContentsView` với cấu hình an toàn tuyệt đối:
   - `sandbox: true`
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - **Không cấp preload đặc quyền** cho provider pages.
3. Kiểm thử phân vùng cô lập (`persist:mcb-web-*`) qua kịch bản A/B.
4. **Kiểm soát Tuyến đường Ngoài (`safe-external.js` / UB-P1-SEC-001):**
   - Chỉ cho phép `https:` và `http:`.
   - Chặn đứng mọi scheme nguy hiểm (`file:`, `javascript:`, `data:`, `ms-settings:`, `powershell:`, `cmd:`).
   - Gắn `setWindowOpenHandler` lên từng `WebContentsView` (trả về `{ action: 'deny' }` để chặn popup).
5. **Minh bạch Trạng thái & Ảnh chụp Hiển thị (UB-P1-SEC-003 / UB-P1-QA-005):**
   - Phân biệt rõ giữa `READY_OR_LANDING` và `LOGIN_REQUIRED`.
   - Ảnh chụp kiểm chuẩn hiển thị được lưu là `_raw_rendered.png` cho các trang công khai; không tuyên bố đã "scrub" dữ liệu cá nhân; hỗ trợ cờ `--no-screenshot` cho profile người dùng.

---

## 2. Kết quả Kiểm thử Cô lập Phân vùng (Partition Isolation A/B Test)

- **Mục tiêu:** Chứng minh dữ liệu nhạy cảm (cookie, session token) giữa 2 partition khác nhau được cô lập hoàn toàn mức Chromium profile.
- **Kịch bản:**
  - Partition A: `persist:mcb-web-test-a`
  - Partition B: `persist:mcb-web-test-b`
  - Ghi nhận cookie `qa_partition_token=partition_a_private_data` trên Partition A.
  - Truy vấn cookie trên Partition B.
- **Kết quả thực tế:**
  - `Partition A has token`: **`true`**
  - `Partition B has token`: **`false`**
  - `Partition Isolation Verified`: **`PASS (100% Isolated)`**

---

## 3. Kết quả Kiểm thử Tuyến đường An toàn & Chặn Scheme Nguy hiểm (UB-P1-SEC-001)

- **Mục tiêu:** Đảm bảo khi trang web yêu cầu mở cửa sổ mới (`target="_blank"` hoặc `window.open`):
  1. Không tạo popup child view tự do trong Electron.
  2. Chỉ các liên kết `https:` hợp lệ mới được chuyển sang trình duyệt OS ngoài.
  3. Mọi scheme nguy hiểm (`file:`, `javascript:`, `ms-settings:`, credentials trong URL) đều bị chặn ngay lập tức.
- **Kết quả thực tế:**
  - `setWindowOpenHandler` trên mọi view đều trả về `{ action: 'deny' }`.
  - Liên kết HTTPS hợp lệ (`https://unapproved-external.org/`) được mở qua `shell.openExternal`: **`PASS`**.
  - Các liên kết nguy hiểm (`file:///C:/Windows/System32/cmd.exe`, `javascript:alert(1)`, `ms-settings:privacy`) bị chặn đứng: **`PASS (0 nguy cơ rò rỉ sang native OS)`**.
  - Bộ kiểm thử đơn vị `spikes/electron-browser/test-safe-external.js`: **8/8 unit tests PASS**.

---

## 4. Bảng Kết quả Kiểm định 4 Nhà cung cấp AI (Provider Verdict Matrix)

| Nhà cung cấp | Origin URL | Partition ID | URL Thực tế Đã Nạp | Tiêu đề Trang (Page Title) | State Thực tế | Verdict Phân loại |
|---|---|---|---|---|---|---|
| **ChatGPT** | `https://chatgpt.com` | `persist:mcb-web-chatgpt` | `https://chatgpt.com/` | `ChatGPT: Chat, Work, Create & Code with AI` | `READY_OR_LANDING` | `ELECTRON_RENDERED` |
| **Gemini** | `https://gemini.google.com` | `persist:mcb-web-gemini` | `https://gemini.google.com/app` | `Google Gemini` | `READY_OR_LANDING` | `ELECTRON_RENDERED` |
| **Claude** | `https://claude.ai` | `persist:mcb-web-claude` | `https://claude.ai/login` | `Sign in - Claude` | `LOGIN_REQUIRED` | `ELECTRON_RENDERED` |
| **DeepSeek** | `https://chat.deepseek.com` | `persist:mcb-web-deepseek` | `https://chat.deepseek.com/sign_in` | `DeepSeek` | `LOGIN_REQUIRED` | `ELECTRON_RENDERED` |

> [!NOTE]
> **Nhận xét Chi tiết từng Provider (Minh bạch Theo Chỉ thị R05):**
> - **ChatGPT:** Nạp thành công giao diện web chính thức (`finishLoad: true`, tiêu đề đầy đủ).
> - **Gemini:** Nạp thành công và tự động điều hướng nội bộ đến `https://gemini.google.com/app` (`finishLoad: true`).
> - **Claude:** Nạp thành công giao diện đăng nhập công khai tại `https://claude.ai/login` (`finishLoad: true`, `LOGIN_REQUIRED`). Cần phiên đăng nhập người dùng để bắt đầu gửi prompt.
> - **DeepSeek:** Nạp thành công giao diện đăng nhập công khai tại `https://chat.deepseek.com/sign_in` (`finishLoad: true`, `LOGIN_REQUIRED`). Cần phiên đăng nhập người dùng để bắt đầu gửi prompt.

---

## 5. Kết luận & Điều kiện Chuyển tiếp

1. **Khả năng nhúng thực tế:** Cả 4 website AI chính thức đều được nạp và render thành công trong `WebContentsView` của Electron 33.4.11 trên môi trường máy trạm Windows 11.
2. **Cô lập bảo mật:** Phân vùng `persist:mcb-web-*` hoạt động chính xác, ngăn chặn rò rỉ cookie chéo giữa các tài khoản và giữa các AI.
3. **Phòng thủ Tuyến đường Ngoài (UB-P1-SEC-001):** Toàn bộ popup bị deny; `safeOpenExternal` lọc scheme nghiêm ngặt, loại bỏ hoàn toàn nguy cơ thực thi mã ngoài OS.
4. **Quy tắc Ảnh chụp (UB-P1-SEC-003):** Toàn bộ ảnh kiểm chuẩn là raw render của trang public; không lưu hay xuất bất kỳ dữ liệu cá nhân nào.
5. Toàn bộ mã nguồn spike đặt tại `spikes/electron-browser/`, test tại `test-safe-external.js`, và báo cáo chi tiết tại `scratch/electron-probe/electron_probe_report.json`.
