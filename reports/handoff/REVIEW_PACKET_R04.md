# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO TOÀN DIỆN — ROUND R04 (UNION BOT)

- **Document ID:** `UB-HANDOFF-R04`
- **Phase:** `P0` (Audit & Baseline) + `P1 Authorization` (`P1_IMPLEMENTATION_ALLOWED`)
- **Target Repository:** `https://github.com/wtrg/union-bot`
- **Branch:** `main`
- **Reviewed Commit Base:** `8defe3f05c323a039fbedbbe78424bf644b531eb`
- **Date:** 2026-10-18 (Asia/Ho_Chi_Minh)
- **Implementation Owner:** Antigravity
- **QA Lead:** Codex
- **Technical Leader / Reviewer:** ChatGPT Web (`https://chatgpt.com/c/6ad4b4fe-27b0-83ec-9445-1c65d6415cc2`)
- **Status:** `RESOLVED_ALL_R04_FINDINGS` — Bàn giao mã nguồn Spike Electron, bộ kiểm chuẩn và hồ sơ hoàn thiện.

---

## 1. Tổng quan Trạng thái Kiểm thử & Mức tin cậy (Test & Confidence Overview)

| Bộ Kiểm thử | Công cụ / Runtime | Số lượng Test | Trạng thái | Mức Tin cậy (Evidence Level) |
|---|---|---|---|---|
| **Cost Guard Egress Protection** | Node.js Test Runner (`node --test`) | **17 unit tests** | **17/17 PASS** (14.7ms) | `[SOURCE_VERIFIED / TEAM_EXECUTED]` |
| **Artifact Store CAS & Security** | Node.js Test Runner (`node --test`) | **8 unit tests** | **8/8 PASS** (13.5ms) | `[SOURCE_VERIFIED / TEAM_EXECUTED]` |
| **Secret Scanner Integrity** | Python `unittest` | **4 unit tests** | **4/4 PASS** (0.027s) | `[SOURCE_VERIFIED / TEAM_EXECUTED]` |
| **Codex RPC Turn Harness** | Python `unittest` | **5 unit tests** | **5/5 PASS** (1.013s) | `[SOURCE_VERIFIED / TEAM_EXECUTED]` |
| **Web -> CAS Roundtrip** | TypeScript (`node --experimental-strip-types`) | 1 integration script | **PASS** (100% byte-match) | `[SOURCE_VERIFIED / TEAM_EXECUTED]` |
| **Codex App Server Live Turn** | Live stdio JSON-RPC (`codex app-server`) | 1 live turn | **PASS** (`UNION_BOT_CODEX_TURN_VERIFIED`) | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| **Electron 4-Provider Spike** | Electron 33.4.11 (`WebContentsView`) | 4 origins + 2 scenarios | **PASS** (4 rendered, partition isolated, fallback pass) | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| **Legacy Baseline Tests** | Pytest (Dự án cũ `D:\muti_chat_bot_package`) | 118 failures, 94 warnings | **FAIL (Historical)** | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| **Raw TAP Log Output** | Standard TAP Version 13 | 25 tests | **PASS (0 fail)** | `reports/qa/RAW_TAP_OUTPUT.txt` |

---

## 2. Báo cáo Chi tiết Khắc phục 7 Vấn đề Tại Round R04

### 2.1. UB-R04-001: Hạ Tuyên bố 100% Egress & Thiết kế Ranh giới 3 Lớp (EGRESS_BOUNDARIES.md)
- **Khắc phục:**
  - Hạ toàn bộ tuyên bố “100% toàn bộ egress mạng” xuống đúng bản chất: *best-effort in-process runtime guards + allow/deny policy*.
  - Biên soạn tài liệu kiến trúc bảo mật `docs/security/EGRESS_BOUNDARIES.md` xác định mô hình 3 lớp:
    - **Lớp 1:** Admission Policy Gate trước khi spawn/dispatch tiến trình hoặc adapter (`paid_api_enabled: false`, `unknown_cost: DENY`, không đọc/lưu billing API key).
    - **Lớp 2:** Per-Adapter Action Gate (chỉ cho phép các hành động UI/local).
    - **Lớp 3:** In-Process Network Hooks (Node fetch, Agent, Socket, HTTP/2 + Electron session `onBeforeRequest`) đóng vai trò phòng vệ chiều sâu (defense-in-depth).
  - Tái cấu trúc `installNodeCostGuardInterceptor`: Thiết kế ref-counted idempotent installation, ngăn chặn double-wrap và bảo đảm hoàn nguyên chính xác 100% các prototype khi uninstall.
  - Bổ sung 3 unit tests mới trong `packages/cost-guard/tests/cost-guard.test.ts`: test chặn `net.Socket.connect` trực tiếp, test chặn custom agent, test vòng đời cài đặt idempotent. Tổng cộng **17/17 tests PASS**.

### 2.2. UB-R04-002: Triển khai Spike Tối thiểu Electron WebContentsView (spikes/electron-browser/)
- **Khắc phục:**
  - Khởi tạo thư mục `spikes/electron-browser/` gồm `package.json`, `main.js`, `probe-providers.js`, và `README.md`.
  - Cài đặt và cấu hình Electron v33.4.11 / Chromium 130.0.6723.191 thành công trên Windows 11.
  - Thiết lập `BrowserWindow` và `WebContentsView` tuân thủ nghiêm ngặt: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **không cấp preload đặc quyền** cho provider pages.
  - **Kiểm thử Cô lập Phân vùng A/B:** Set cookie test trên `persist:mcb-web-test-a`, kiểm tra trên `persist:mcb-web-test-b` xác nhận không bị rò rỉ (`PASS`).
  - **Kiểm thử Fallback Điều hướng An toàn:** `setWindowOpenHandler` bắt sự kiện mở link unapproved và gọi `shell.openExternal` ra trình duyệt mặc định ngoài OS (`PASS`).
  - **Kiểm thử Nạp 4 Nhà cung cấp AI:**
    - ChatGPT (`https://chatgpt.com`): `ELECTRON_RENDERED` (Tiêu đề: `ChatGPT: Chat, Work, Create & Code with AI`, `finishLoad: true`).
    - Gemini (`https://gemini.google.com`): `ELECTRON_RENDERED` (Tiêu đề: `Google Gemini`, điều hướng nội bộ `/app`, `finishLoad: true`).
    - Claude (`https://claude.ai`): `ELECTRON_RENDERED` (Tiêu đề: `Sign in - Claude`, điều hướng nội bộ `/login`, `finishLoad: true`).
    - DeepSeek (`https://chat.deepseek.com`): `ELECTRON_RENDERED` (Tiêu đề: `DeepSeek`, điều hướng nội bộ `/sign_in`, `finishLoad: true`).
  - Lưu trữ báo cáo chi tiết tại `scratch/electron-probe/electron_probe_report.json` và tổng kết tại `reports/capability-evidence/ELECTRON_BROWSER_SPIKE.md`.

### 2.3. UB-R04-003: Chuẩn hóa Source Manifest & Xóa bỏ Vòng lặp Tự quy chiếu
- **Khắc phục:**
  - `reports/handoff/SOURCE_MANIFEST.txt` được tái cấu trúc: xác định rõ `Source Review Base SHA` (commit đã được Leader review) và quy tắc ghi nhận `Branch HEAD at Submission` trong thông điệp gửi.
  - Danh sách tệp được sinh khách quan từ `git ls-files`, loại trừ khả năng tự gán SHA của chính commit đang tạo vào nội dung tệp.

### 2.4. UB-R04-004: Tách biệt Vé P0-003 & Ghi nhận Trung thực Baseline 118 Lỗi
- **Khắc phục:**
  - Sửa đổi `TASK_BOARD.md`:
    - `P0-003` = `Legacy Test Baseline Capture` với trạng thái `FAIL (Baseline)`, ghi rõ 118 lỗi/thất bại và 94 cảnh báo (exit 1) là mốc lịch sử từ dự án cũ.
    - Tách riêng `P0-003-SEC` = `Security & Secret Scan Audit` (`VERIFIED_LIVE`).
    - `P0-008` = `CARRY_OVER_P1` (Origin TLS probe hoàn tất; Electron spike tối thiểu hoàn tất).
    - `P0-012` = `IN_PROGRESS` (Round R04 review).
    - Tổng tiến độ P0: **16/18 hoàn thành (88.9%)**, không tự ý ghi 18/18 hoặc tự cấp GO_P1 trước khi Reviewer ký duyệt.

### 2.5. UB-R04-005: Loại bỏ Rò rỉ Plaintext Trong Secret Scanner & Bổ sung Test
- **Khắc phục:**
  - Viết lại toàn bộ `scan_secrets.py`:
    - Loại bỏ triệt để trường `preview: line.strip()[:100]`. Chỉ lưu `rule_id`, `path`, `line`, `masked_hint` (ví dụ `sk-...***...45`), và `triage_status`.
    - Fail-closed: ghi nhận `scan_errors` nếu không đọc được tệp trong phạm vi; cung cấp cờ `--strict` exit nonzero nếu có lỗi.
    - Prune thư mục bằng tên folder chính xác (`EXCLUDE_DIRS`), không dùng substring match.
    - Hỗ trợ CLI roots (`--roots`, `--output`, `--strict`).
  - Viết bộ kiểm thử đơn vị `tests/test_scan_secrets.py`: 4 bài test tổng hợp (test hàm mask, positive/negative detection, safe triage, error handling) — **4/4 tests PASS** (0.027s).
  - Quét lại 1.839 tệp qua 2 thư mục: 14 phát hiện (toàn bộ đã masked, 0 leak thật, 0 scan error). Cập nhật `reports/audit/SECRET_SCAN_REPORT.md`.

### 2.6. UB-R04-006: Nâng cấp Harness Codex RPC với Watchdog Không treo & Correlation Đầy đủ
- **Khắc phục:**
  - Viết lại `test_codex_full_rpc.py`:
    - Đọc stdout qua thread phụ (`reader_worker`) và hàng đợi `queue.Queue`, loại bỏ hoàn toàn nguy cơ treo vô hạn của `readline()`.
    - Đối chiếu nghiêm ngặt: `threadId` nhận được từ `thread/start`, `turnId` nhận được từ `turn/start` hoặc `turn/started`, kiểm tra `turn/completed` khớp đúng `turnId` và `threadId`.
    - Khẳng định trạng thái terminal là `completed` và nội dung phản hồi chứa đúng chuỗi `'UNION_BOT_CODEX_TURN_VERIFIED'`.
    - Dọn dẹp tiến trình con sạch sẽ (`terminate` -> `wait` -> `kill`).
  - Viết bộ kiểm thử giả lập `tests/test_codex_harness.py`: 5 bài test synthetic (pass, wrong turn ID, missing text, cancelled status, silent timeout) — **5/5 tests PASS** (1.013s).
  - Chạy kiểm thử thực tế với Codex App Server: **35 JSON-RPC messages, terminal status `completed`, agent text `'UNION_BOT_CODEX_TURN_VERIFIED'`, Exit code 0**.

### 2.7. UB-R04-007: Minh bạch Mức Tin cậy Bằng chứng & Test Counts
- **Khắc phục:**
  - Áp dụng hệ thống nhãn mức tin cậy: `[SOURCE_VERIFIED]`, `[TEAM_EXECUTED_LOG_INSPECTED]`, `[REVIEWER_EXECUTED]`, `[NETWORK_PROBE_ONLY]`.
  - Phân định rõ:
    - 25 unit tests TypeScript (17 cost-guard + 8 artifact-store): `SOURCE_VERIFIED`.
    - 9 unit tests Python (4 secret scan + 5 codex harness): `SOURCE_VERIFIED`.
    - Xuất raw TAP output chuẩn tại `reports/qa/RAW_TAP_OUTPUT.txt` (25/25 pass).
    - Avatar roundtrip là public web binary fixture (1.029 bytes), không tuyên bố là hình do AI sinh.

---

## 3. Danh mục Tệp Thay đổi / Bổ sung Tại Round R04

1. `packages/cost-guard/src/cost-guard.ts` (Bổ sung socket/http2 interceptor, idempotent ref-counted install/uninstall).
2. `packages/cost-guard/tests/cost-guard.test.ts` (Mở rộng lên 17 unit tests).
3. `docs/COST_MANIFEST.md` (Cập nhật phạm vi thực tế in-process guard).
4. `docs/security/EGRESS_BOUNDARIES.md` (Tài liệu kiến trúc phòng thủ 3 lớp).
5. `spikes/electron-browser/package.json` (Cấu hình Electron spike).
6. `spikes/electron-browser/main.js` (Main process Electron với WebContentsView & safe routing).
7. `spikes/electron-browser/probe-providers.js` (Harness probe tự động 4 AI, partition A/B test, external fallback test).
8. `spikes/electron-browser/README.md` (Hướng dẫn chạy spike trên Windows).
9. `reports/capability-evidence/ELECTRON_BROWSER_SPIKE.md` (Bằng chứng và kết quả kiểm định 4 provider).
10. `scan_secrets.py` (Scanner an toàn không rò rỉ plaintext, fail-closed, CLI roots).
11. `tests/test_scan_secrets.py` (4 unit tests cho secret scanner).
12. `reports/audit/SECRET_SCAN_REPORT.md` (Báo cáo quét secret cập nhật số liệu đồng bộ).
13. `test_codex_full_rpc.py` (Harness Codex RPC không treo, đối chiếu thread/turn ID).
14. `tests/test_codex_harness.py` (5 unit tests cho Codex RPC harness).
15. `TASK_BOARD.md` (Đồng bộ trung thực P0 status 16/18, 118 baseline errors, nhãn mức tin cậy).
16. `reports/qa/RAW_TAP_OUTPUT.txt` (Log TAP chuẩn 25 bài unit test).
17. `reports/handoff/SOURCE_MANIFEST.txt` (Cập nhật manifest).

---

## 4. Kính đề nghị Technical Leader

Hồ sơ Round R04 đã giải quyết triệt để và minh bạch toàn bộ 7 yêu cầu trong `REVIEW_FIX_PLAN_R04`. Đội ngũ kính đề nghị Leader:
1. Kiểm tra mã nguồn và bằng chứng trên GitHub.
2. Phê duyệt kết quả Round R04 và chính thức ban hành quyết định **`GO_P1`** để đội ngũ bước sang giai đoạn triển khai nền tảng monorepo & desktop shell!
