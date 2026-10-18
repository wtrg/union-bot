# CAPABILITY EVIDENCE: BROWSER ENGINE & WEBCONTENTSVIEW SPIKE

- **Document ID:** `UB-EVID-003`
- **Phase:** `P0`
- **Ticket:** `P0-008`
- **Date:** 2026-10-18
- **Technology Tested:** Electron WebContentsView + Chromium Engine
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu Kiến trúc
Đánh giá và kiểm chứng công nghệ nhúng trình duyệt trong ứng dụng máy trạm **Union Bot**:
1. Tuyệt đối **không dùng** thẻ `<webview>` cũ (kém an toàn, lỗi font/DPI, rò rỉ bộ nhớ).
2. Tuyệt đối **không dùng** `BrowserView` (đã bị Chromium/Electron deprecate từ Electron 30+).
3. Sử dụng chuẩn mới nhất: **`WebContentsView`** tích hợp trong `BaseWindow` / `BrowserWindow`.
4. Thiết lập cơ chế cô lập session bằng partition riêng biệt: `persist:mcb-web-<provider>`.

---

## 2. Thiết kế Cô lập Session & Phân vùng (Partition Isolation)

Mỗi nhà cung cấp dịch vụ web AI được cấp một partition độc lập tuyệt đối:
- `persist:mcb-web-chatgpt` -> `https://chatgpt.com`
- `persist:mcb-web-gemini` -> `https://gemini.google.com`
- `persist:mcb-web-claude` -> `https://claude.ai`
- `persist:mcb-web-deepseek` -> `https://chat.deepseek.com`

### Quy tắc Bảo mật Bắt buộc:
```typescript
const view = new WebContentsView({
  webPreferences: {
    partition: `persist:mcb-web-${providerId}`,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    preload: path.join(__dirname, 'browser-preload.js') // Chỉ cung cấp navigation IPC, không lộ Node APIs
  }
});
```

---

## 3. Khảo sát Khả năng Điều khiển Điều hướng (Navigation Controls)
Thực nghiệm xác nhận các API có sẵn của `webContents`:
- `view.webContents.loadURL(url)`: Tải trang chính thức của provider.
- `view.webContents.canGoBack()`, `view.webContents.goBack()`: Điều hướng quay lại.
- `view.webContents.canGoForward()`, `view.webContents.goForward()`: Điều hướng tiến tới.
- `view.webContents.reload()`: Tải lại trang khi gặp lỗi mạng.
- `view.webContents.stop()`: Dừng tải trang.
- `view.webContents.getURL()`, `view.webContents.getTitle()`: Lấy URL và tiêu đề hiện tại để hiển thị trên thanh địa chỉ.

---

## 4. Cơ chế Chia sẻ Thủ công Có Kiểm soát (Manual Share Flow)
Thay vì tự động scraping DOM tiềm ẩn nguy cơ bị chặn hoặc khóa tài khoản:
1. Người dùng tương tác trực tiếp với giao diện web chính thức của nhà cung cấp trong tab nhúng.
2. Khi muốn chia sẻ một câu trả lời hoặc tệp tin từ ChatGPT / Gemini sang phòng làm việc chung, người dùng nhấn nút **"Chia sẻ vào phòng Union Bot"** trên thanh công cụ của ứng dụng.
3. Ứng dụng mở hộp thoại xem trước dữ liệu (**Context Preview Dialog** theo `P3-015`), người dùng duyệt nội dung, ứng dụng gắn nhãn provenance `user_manual` và lưu vào `artifact_store`.

---

## 5. Kết luận P0-008
Kiến trúc `WebContentsView` kết hợp partition `persist:mcb-web-*` đáp ứng hoàn hảo tiêu chí: bảo mật cao, không rò rỉ cookie giữa các tài khoản, tuân thủ chính sách của các hãng AI, và mang lại trải nghiệm duyệt web mượt mà cho người dùng.
