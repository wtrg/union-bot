# ELECTRON WEBCONTENTSVIEW SPIKE & CAPABILITY EVIDENCE — UNION BOT

- **Document ID:** `UB-SPIKE-003`
- **Phase:** `P0-008` & `P1 Starter`
- **Ticket:** `UB-R04-002`, `P0-008`, `P1-002`, `P1-005`
- **Date:** 2026-10-18
- **Runtime:** Electron v33.4.11 / Chromium 130.0.6723.191 / Node v20.18.0 / Windows 11 x64
- **Author:** Antigravity (Implementation Owner) & Codex (QA Lead)
- **Status:** `ELECTRON_RENDERED & PARTITION_ISOLATED`

---

## 1. Mục tiêu & Ranh giới Kỹ thuật (Technical Scope)

Thực hiện yêu cầu kiểm chuẩn của Technical Leader tại Round R04 (`UB-R04-002`):
1. Xây dựng spike Electron tối thiểu tại `spikes/electron-browser/`.
2. Kiểm chứng khả năng nạp thực tế của `BrowserWindow` và `WebContentsView` với cấu hình an toàn tuyệt đối:
   - `sandbox: true`
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - **Không cấp preload đặc quyền** cho provider pages.
3. Kiểm thử phân vùng cô lập (`persist:mcb-web-*`) qua kịch bản A/B.
4. Kiểm thử cơ chế điều hướng an toàn (Safe Routing) và fallback mở trình duyệt mặc định ngoài hệ điều hành (`shell.openExternal`).
5. Phân loại 4 dòng verdict minh bạch cho 4 web AI: ChatGPT, Gemini, Claude, DeepSeek.

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

## 3. Kết quả Kiểm thử Điều hướng An toàn & Fallback (External Fallback Test)

- **Mục tiêu:** Đảm bảo khi trang web yêu cầu mở cửa sổ mới (`target="_blank"` hoặc `window.open`) hướng đến liên kết ngoài, hệ thống chặn mở bên trong Electron shell và chuyển hướng ra trình duyệt mặc định của người dùng.
- **Kết quả thực tế:**
  - `setWindowOpenHandler` bắt sự kiện và trả về `{ action: 'deny' }`.
  - `shell.openExternal` được kích hoạt với URL: `https://unapproved-external.org/`.
  - `Fallback Verified`: **`PASS`**

---

## 4. Bảng Kết quả Kiểm định 4 Nhà cung cấp AI (Provider Verdict Matrix)

| Nhà cung cấp | Origin URL | Partition ID | URL Thực tế Đã Nạp | Tiêu đề Trang (Page Title) | did-finish-load | Verdict Phân loại |
|---|---|---|---|---|---|---|
| **ChatGPT** | `https://chatgpt.com` | `persist:mcb-web-chatgpt` | `https://chatgpt.com/` | `ChatGPT: Chat, Work, Create & Code with AI` | `true` | `ELECTRON_RENDERED` |
| **Gemini** | `https://gemini.google.com` | `persist:mcb-web-gemini` | `https://gemini.google.com/app` | `Google Gemini` | `true` | `ELECTRON_RENDERED` |
| **Claude** | `https://claude.ai` | `persist:mcb-web-claude` | `https://claude.ai/login` | `Sign in - Claude` | `true` | `ELECTRON_RENDERED` |
| **DeepSeek** | `https://chat.deepseek.com` | `persist:mcb-web-deepseek` | `https://chat.deepseek.com/sign_in` | `DeepSeek` | `true` | `ELECTRON_RENDERED` |

> [!NOTE]
> **Nhận xét Chi tiết từng Provider:**
> - **ChatGPT:** Nạp thành công giao diện web chính thức (`finishLoad: true`). Trang đích giữ nguyên `https://chatgpt.com/`.
> - **Gemini:** Nạp thành công và tự động điều hướng nội bộ đến `https://gemini.google.com/app` (`finishLoad: true`).
> - **Claude:** Nạp thành công và hiển thị giao diện đăng nhập `Sign in - Claude` tại `https://claude.ai/login` (`finishLoad: true`).
> - **DeepSeek:** Nạp thành công và hiển thị giao diện đăng nhập `DeepSeek` tại `https://chat.deepseek.com/sign_in` (`finishLoad: true`).

---

## 5. Kết luận P0-008 & Khép lại Spike

1. **Khả năng nhúng thực tế:** Cả 4 website AI chính thức đều được nạp và render thành công trong `WebContentsView` của Electron 33.4.11 trên môi trường máy trạm Windows 11.
2. **Cô lập bảo mật:** Phân vùng `persist:mcb-web-*` hoạt động chính xác, ngăn chặn rò rỉ cookie chéo giữa các tài khoản và giữa các AI.
3. **An toàn egress:** Liên kết ngoài không được mở tự do trong ứng dụng mà bắt buộc fallback qua trình duyệt mặc định hệ điều hành.
4. Toàn bộ mã nguồn spike đặt tại `spikes/electron-browser/`, cấu hình `package.json`, và báo cáo chi tiết tại `scratch/electron-probe/electron_probe_report.json`.
