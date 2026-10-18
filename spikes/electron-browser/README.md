# Electron WebContentsView Browser Spike — Union Bot (P0-008 / Phase P1 Wave 1)

Minimal Electron spike demonstrating isolated multi-provider WebContentsView rendering, partition sandboxing, strict external route scheme validation (`safeOpenExternal`), and zero-cost policy enforcement.

---

## 1. Yêu cầu & Kiến trúc An toàn (Safety Architecture)

- **Chromium / Electron Sandbox:** Mọi WebContentsView chạy với `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`.
- **Zero Privileged Preload:** Không nạp preload script có đặc quyền vào các trang web AI nhà cung cấp.
- **Partition Isolation:** Mỗi nhà cung cấp AI được gán partition riêng biệt:
  - ChatGPT: `persist:mcb-web-chatgpt`
  - Gemini: `persist:mcb-web-gemini`
  - Claude: `persist:mcb-web-claude`
  - DeepSeek: `persist:mcb-web-deepseek`
- **Strict Safe External Route Handler (`safe-external.js` / UB-P1-SEC-001):**
  - Mọi `view.webContents.setWindowOpenHandler` đều trả `{ action: 'deny' }` để chặn mở popup tùy ý.
  - Bộ kiểm duyệt `safeOpenExternal` chỉ cho phép scheme `https:` và `http:`.
  - Nghiêm cấm các scheme nguy hiểm như `file:`, `javascript:`, `data:`, `vbscript:`, `shell:`, `ms-settings:`, `powershell:`, `cmd:`.
  - Cấm embedded credentials trong URL (`https://user:pass@host`) và cấm loopback/private IP addresses.
- **Xác thực Hiển thị & Ảnh chụp Màn hình (UB-P1-SEC-003):**
  - Ảnh chụp màn hình kiểm chuẩn bề mặt hiển thị (`_raw_rendered.png`) chỉ thực hiện trên các trang đăng nhập/giới thiệu công khai (public login / landing pages).
  - Không tuyên bố là ảnh đã "scrub" che dữ liệu cá nhân; hỗ trợ cờ `--no-screenshot` để tắt hoàn toàn tính năng chụp khi phiên làm việc chứa dữ liệu nhạy cảm.

---

## 2. Hướng dẫn Chạy Kiểm thử trên Windows

### Bước 1: Kiểm thử Đơn vị Bảo mật Tuyến đường Ngoài (SafeExternal Unit Tests)
```powershell
node --test spikes/electron-browser/test-safe-external.js
```
Kết quả: **8/8 unit tests PASS** (chặn đứng `file:`, `javascript:`, `ms-settings:`, URL credentials, private IPs).

### Bước 2: Chạy Tự động Kiểm chuẩn 4 Nhà Cung Cấp & Phân Vùng (Automated Probe)
```powershell
cd d:\WORK-TEAM\spikes\electron-browser
$env:ELECTRON_OVERRIDE_DIST_PATH = "D:\WORK-TEAM\spikes\electron-browser\node_modules\.pnpm\electron@33.4.11\node_modules\electron\dist"
node ./node_modules/electron/cli.js probe-providers.js
```
(Hoặc thêm `--no-screenshot` để bỏ qua thao tác capturePage).

Kết quả:
1. **Partition Isolation A/B Test:** Cookie token tại `persist:mcb-web-test-a` không rò rỉ sang `persist:mcb-web-test-b` (PASS).
2. **External Fallback & Security Test (UB-P1-SEC-001):** URL HTTPS hợp lệ được điều hướng an toàn; các scheme `file:`, `javascript:`, `ms-settings:` bị chặn đứng hoàn toàn (PASS).
3. **Nạp 4 Provider AI:** ChatGPT (`READY_OR_LANDING`), Gemini (`READY_OR_LANDING`), Claude (`LOGIN_REQUIRED`), DeepSeek (`LOGIN_REQUIRED`).
4. Báo cáo lưu tại `scratch/electron-probe/electron_probe_report.json`.

### Bước 3: Chạy Giao diện Desktop Mẫu
```powershell
cd d:\WORK-TEAM\spikes\electron-browser
$env:ELECTRON_OVERRIDE_DIST_PATH = "D:\WORK-TEAM\spikes\electron-browser\node_modules\.pnpm\electron@33.4.11\node_modules\electron\dist"
node ./node_modules/electron/cli.js main.js
```
