# Electron WebContentsView Browser Spike — Union Bot (P0-008 / P1 Starter)

Minimal Electron spike demonstrating isolated multi-provider WebContentsView rendering, partition sandboxing, safe external fallback routing, and zero-cost policy enforcement.

---

## 1. Yêu cầu & Kiến trúc An toàn (Safety Architecture)

- **Chromium / Electron Sandbox:** Mọi WebContentsView chạy với `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- **Zero Privileged Preload:** Không nạp preload script có đặc quyền vào các trang web AI nhà cung cấp.
- **Partition Isolation:** Mỗi nhà cung cấp AI được gán partition riêng biệt:
  - ChatGPT: `persist:mcb-web-chatgpt`
  - Gemini: `persist:mcb-web-gemini`
  - Claude: `persist:mcb-web-claude`
  - DeepSeek: `persist:mcb-web-deepseek`
- **Safe Route Handler:** Mọi liên kết mở cửa sổ mới (`window.open`) hoặc domain ngoài luồng được điều hướng an toàn qua trình duyệt mặc định của hệ điều hành (`shell.openExternal`) thay vì mở trong ứng dụng.

---

## 2. Hướng dẫn Chạy trên Windows (Windows Execution Guide)

### Cách 1: Chạy tự động kiểm thử 4 nhà cung cấp & Phân vùng (Automated Probe)
```powershell
cd d:\WORK-TEAM\spikes\electron-browser
node ./node_modules/electron/cli.js probe-providers.js
```
Lệnh này sẽ:
1. Thực thi bài kiểm thử cô lập Cookie A/B giữa 2 partition `persist:mcb-web-test-a` và `persist:mcb-web-test-b`.
2. Kiểm thử cơ chế Fallback mở trình duyệt ngoài khi gặp liên kết không xác định.
3. Nạp lần lượt 4 nhà cung cấp (ChatGPT, Gemini, Claude, DeepSeek) trong `WebContentsView`.
4. Chụp ảnh màn hình kiểm chứng (đã scrub thông tin người dùng) lưu tại `scratch/electron-probe/`.
5. Xuất báo cáo kết quả `scratch/electron-probe/electron_probe_report.json`.

### Cách 2: Chạy giao diện Desktop hiển thị cửa sổ (Interactive Window)
```powershell
cd d:\WORK-TEAM\spikes\electron-browser
node ./node_modules/electron/cli.js main.js
```
Cửa sổ desktop Windows sẽ mở ra hiển thị `WebContentsView` nhúng ChatGPT trong partition cô lập.
