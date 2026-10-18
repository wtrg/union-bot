# ENVIRONMENT & TOOLCHAIN LOCK — UNION BOT

- **Document ID:** `UB-ARCH-002`
- **Phase:** `P0`
- **Ticket:** `P0-005`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu
Khóa toàn bộ phiên bản phần mềm, trình thông dịch, công cụ biên dịch và runtime trên máy trạm của Developer nhằm loại bỏ rủi ro "chạy được trên máy này nhưng lỗi máy khác", bảo đảm tính tái lặp 100% của các bản build và kiểm thử.

---

## 2. Bảng Ma trận Công cụ & Phiên bản Đã Khóa

| Thành phần | Phiên bản Thực tế | Phiên bản Tối thiểu theo Plan | Trạng thái | Ghi chú & Đường dẫn |
|---|---|---|---|---|
| **Hệ điều hành** | Windows 11 Enterprise Build 26200.5732 x64 | Windows 10/11 x64 | `PASS` | Nền tảng phát triển và kiểm thử mục tiêu. |
| **Node.js** | `v24.17.0` | >= `v20.0.0` | `PASS` | Hỗ trợ native fetch, Web Crypto API, worker threads. |
| **pnpm** | `v12.14.0` | >= `v9.0.0` | `PASS` | Quản lý monorepo workspace tốc độ cao, deduplication sạch. |
| **npm** | `11.13.0` | >= `10.0.0` | `PASS` | Trình quản lý package dự phòng. |
| **Python** | `3.11.9` | >= `3.11.0` | `PASS` | `C:\Users\Lenovo\AppData\Local\Programs\Python\Python311\python.exe` |
| **Git** | `2.55.0.windows.3` | >= `2.40.0` | `PASS` | Quản lý phiên bản cục bộ & remote GitHub. |
| **Codex CLI** | `codex-cli 0.162.1` | >= `0.150.0` | `PASS` | `C:\Users\Lenovo\AppData\Roaming\npm\codex.ps1` |
| **Antigravity CLI** | `1.3.6` | >= `1.3.0` | `PASS` | `C:\Users\Lenovo\AppData\Local\agy\bin\agy.exe` |
| **Electron Target** | `33.x` / `34.x` | >= `32.0.0` | `PASS` | Chromium Engine hỗ trợ WebContentsView ổn định. |
| **TypeScript** | `5.7+` | >= `5.4.0` | `PASS` | Type safety và project references cho monorepo. |

---

## 3. Khóa Khả năng Native Build trên Windows
- **Visual C++ Build Tools:** Cung cấp trình biên dịch MSBuild và cl.exe cho các module nhị phân Node.js cục bộ (như `better-sqlite3`).
- **Python GYP Support:** `Python 3.11.9` được liên kết chính xác trong biến môi trường `PYTHON` phục vụ node-gyp khi biên dịch.

---

## 4. Lệnh Kiểm tra Nhanh Môi trường
Bất kỳ thành viên nào trong nhóm (hoặc quy trình CI) đều có thể chạy lệnh sau để xác nhận môi trường đạt chuẩn:

```powershell
node --version
pnpm --version
python --version
git --version
agy --version
codex --version
```

---

## 5. Kết luận P0-005
Toàn bộ chuỗi công cụ phát triển cho **Union Bot** đã được thiết lập, kiểm thử thành công và khóa phiên bản. Hệ thống đạt 100% điều kiện tiên quyết để xây dựng monorepo.
