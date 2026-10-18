# UNION BOT — REVIEW_PACKET_P1_R01

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Giai đoạn:** Phase P1 — Monorepo Foundation, Desktop & UI Scaffolding, and Zero-Cost Admission Gate  
> **Người nộp hồ sơ (Implementation Owner):** Antigravity  
> **Đồng kiểm thử & Bảo mật (QA & Security Lead):** Codex  
> **Người tiếp nhận & Phê duyệt (Technical Leader / Independent Reviewer):** ChatGPT Web  
> **Kho lưu trữ (Remote Repository):** `https://github.com/wtrg/union-bot`  
> **Branch:** `main`  
> **Base Reviewed SHA (R05 Anchor):** `c2d329edb925ecbbab9b707ab6042550e656a7a7`  
> **Target Submission Head SHA:** `abbda6c9c2e21fc0689c6d1ead997d217afa70ee`  
> **Thời điểm lập hồ sơ:** 2026-10-18T22:50:00+07:00  

---

## 1. Tóm tắt Trạng thái & Tuyên bố Tuân thủ (Executive Summary & Compliance)

Đội ngũ phát triển (Antigravity & Codex) đã hoàn thành toàn bộ **3 Wave** của Phase P1 theo đúng văn bản chỉ thị của Technical Leader (`reports/audit/UNION_BOT_GO_P1_LEADER_REVIEW_R05_AND_P1_DIRECTIVE.md`):

1. **Wave 1 (Security Preflight & Toolchain)**: Hoàn thành và vượt qua toàn bộ 4 vé nợ bảo mật S1/S2 (`UB-P1-SEC-001` đến `004`), khóa lockfile canonical `pnpm@10.2.0`, thiết lập `scripts/verify.ps1` chạy fail-closed.
2. **Wave 2 (Desktop & UI Foundation)**:
   - Scaffold `@union-bot/protocol` với Zod schemas đầy đủ cho `Envelope`, `MessagePart`, `FidelityLevel`, `Role`, `ProviderKind`, và `AdmissionAction`.
   - Scaffold `@union-bot/orchestrator` với `AdmissionPolicyGate` mặc định `paid_api_enabled: false` (Zero-Cost 0đ tuyệt đối) và từ chối mọi `UNKNOWN_ACTION` hoặc unknown cost.
   - Scaffold `apps/desktop`: Electron 33+ TypeScript main process với single-instance lock (`app.requestSingleInstanceLock()`), đường dẫn an toàn theo `app.getPath('userData')`, cô lập renderer (`contextIsolation: true`, `sandbox: true`), chặn toàn bộ popup (`setWindowOpenHandler` -> `action: 'deny'`), và cài đặt interceptor `CostGuard` trực tiếp trên Electron session.
   - Scaffold `apps/workspace-ui`: Giao diện React 18 + Vite hiện đại dark-mode, hỗ trợ multi-room (`#orchestration`, `#agent-dev`, `#qa-audit`, `#review-briefing`), hiển thị nhãn `DEMO MODE (OFFLINE)` rõ ràng khi không có live AI, và xuất xưởng bản build tĩnh hoàn chỉnh (`apps/workspace-ui/dist/`) có thể chạy 100% offline.
   - Kết nối toàn bộ package workspace với kiểm thử tích hợp chéo end-to-end (`tests/integration_packages.test.ts`).
3. **Wave 3 (Build Tái lập & Nghiệm thu Windows GUI Smoke)**:
   - Build sạch Vite trong 560ms.
   - **51 bài test TypeScript & Node** (Cost Guard, Artifact Store, Protocol, Orchestrator, Integration, SafeExternal, Desktop) **PASS 100%**.
   - **14 bài test Python** (Secret Scanner, Codex RPC Harness) **PASS 100%**.
   - **Electron Automated GUI Smoke Test trên Windows thật**: khởi động cửa sổ thực, kiểm tra title `Union Bot`, kiểm tra CostGuard chặn paid API, kiểm tra SafeExternal chặn dangerous scheme, ghi nhận bằng chứng tại `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`, thoát sạch exit code 0.
   - **Strict Secret Scanner**: Quét 732 tệp, 8 fixtures triaged an toàn theo allowlist tuyệt đối, **0 confirmed leaks**, **0 unresolved findings**, **0 scan errors**.

---

## 2. Bảng Theo dõi Vé Công việc Phase P1 (P1 Tickets Matrix)

| Ticket ID | Tên Nhiệm vụ & Mô tả | Trạng thái | Bằng chứng & File Triển khai | Mức tin cậy |
|---|---|---|---|---|
| `P1-001` | Root monorepo lockfile, `pnpm@10.2.0`, Node engines `>=22.0.0` | `COMPLETED` | `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | `[SOURCE_VERIFIED]` |
| `P1-002` | `apps/desktop` Electron 33+ shell, single instance, safe paths, sandbox | `COMPLETED` | `apps/desktop/src/main.js`, `preload.cjs`, `cost-guard.cjs` | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| `P1-003` | `apps/workspace-ui` React 18 + Vite, multi-room layout, demo badge | `COMPLETED` | `apps/workspace-ui/src/`, `apps/workspace-ui/dist/` (build 560ms) | `[SOURCE_VERIFIED]` |
| `P1-004` | `packages/protocol` Zod schemas: Envelope, MessagePart, Fidelity, Admission | `COMPLETED` | `packages/protocol/src/schemas.ts`, 6 unit tests pass | `[SOURCE_VERIFIED]` |
| `P1-005` | Link `@union-bot/artifact-store` vào workspace & integration test | `COMPLETED` | `tests/integration_packages.test.ts`, CAS verified roundtrip | `[SOURCE_VERIFIED]` |
| `P1-006` | `packages/orchestrator` skeleton & AdmissionPolicyGate (0đ policy) | `COMPLETED` | `packages/orchestrator/src/admission-gate.ts`, 7 unit tests pass | `[SOURCE_VERIFIED]` |
| `P1-007` | Cost Guard wired vào Electron main session & default session | `COMPLETED` | `apps/desktop/src/cost-guard.cjs`, `main.js:installElectronCostGuardInterceptor` | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| `P1-008` | Build orchestration: `pnpm build`, `pnpm test`, `pnpm smoke:gui` | `COMPLETED` | `package.json` scripts, `scripts/verify.ps1` | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| `P1-009` | Fast & strict pre-commit verification script fail-closed | `COMPLETED` | `scripts/verify.ps1` (5 bước kiểm thử toàn diện) | `[TEAM_EXECUTED_LOG_INSPECTED]` |
| `P1-010` | Phase 1 Review Dossier & `REVIEW_PACKET_P1_R01.md` | `SUBMISSION_READY` | `reports/handoff/REVIEW_PACKET_P1_R01.md` | `[SOURCE_VERIFIED]` |
| `P1-011` | Union Bot branding, window title, no network auto-updater | `COMPLETED` | `apps/desktop/src/main.js`, `apps/workspace-ui/index.html` | `[SOURCE_VERIFIED]` |

---

## 3. Bảng Khắc phục 7 Nợ Kỹ thuật & Bảo mật từ Chỉ thị R05

| Issue ID | Mức độ | Yêu cầu Chỉ thị Leader R05 | Giải pháp đã Triển khai | Kết quả Kiểm thử |
|---|---|---|---|---|
| `UB-P1-SEC-001` | S1 / HIGH | Chặn `file:`, `javascript:`, credentials, private IPs trên `openExternal` & popup | Viết `safe-external.js`: kiểm tra scheme strictly `https:/http:`, cấm credentials, cấm private IP, deny mọi child popup. | 8/8 test PASS (`test-safe-external.js`), 4/4 test PASS (`desktop.test.js`). |
| `UB-P1-SEC-002` | S1 / HIGH | Loại bỏ auto-safe theo tên folder trong `scan_secrets.py`; strict fail khi còn unresolved | Viết lại `scan_secrets.py`: toàn bộ finding mặc định `unresolved`, chỉ safe khi khớp allowlist cụ thể; hỗ trợ `.env.*`, `.npmrc`, `.pem`. | 7/7 test Python PASS (`test_scan_secrets.py`), 732 files quét sạch 0 leaks. |
| `UB-P1-SEC-003` | S1 / HIGH | Bỏ nhãn misleading `_scrubbed` nếu không redact thật; `--no-screenshot` cho auth profile | Sửa `probe-providers.js`: đổi tên thành `raw_rendered.png`, bổ sung cờ `--no-screenshot`, phân loại rõ `READY` vs `LOGIN_REQUIRED`. | Verified code & README, không lưu screenshot tài khoản cá nhân. |
| `UB-P1-SEC-004` | S2 / MED | Codex RPC harness dùng direct argv (`shell=False`), drain stderr, redact PII trước khi ghi | Viết lại `test_codex_full_rpc.py`: `shutil.which('codex')`, monotonic timer, recursive PII scrubbing, terminal status check nghiêm ngặt. | 7/7 test Python PASS (`test_codex_harness.py`), 35 RPC msgs verified clean. |
| `UB-P1-QA-005` | S2 / MED | Electron probe exit codes, timeout handling & evidence fidelity | Bổ sung chế độ `--smoke` trong `apps/desktop/scripts/launch.js` và `main.js`: kiểm tra window, cost guard, safe external, ghi JSON evidence, exit 0. | Exit code 0, bằng chứng lưu tại `ELECTRON_GUI_SMOKE_EVIDENCE.json`. |
| `UB-P1-ARCH-006`| S2 / MED | Lớp Cost Guard chính thức phải được wire, không chỉ có interceptor export | Wire trực tiếp `installElectronCostGuardInterceptor(session.defaultSession, costGuard)` trong `apps/desktop/src/main.js` + `AdmissionPolicyGate` trong Orchestrator. | Chặn `api.openai.com`, `api.anthropic.com`, `api.deepseek.com`, billing endpoints ở cả cấp session và orchestrator. |
| `UB-P1-QA-007` | S3 / LOW | Bảng phân định số lượng test minh bạch giữa TS vs Python vs GUI | Đồng bộ bảng counter: 51 TS + 14 Python = 65 tests + 1 GUI Smoke Test + Strict Secret Scan. | Phản ánh chính xác trong `TASK_BOARD.md` và `scripts/verify.ps1`. |

---

## 4. Dữ liệu Kiểm thử & Nghiệm thu Chi tiết (Verification Evidence)

### A. Bộ kiểm thử TypeScript & Node (51 tests / 6 test suites)
- **Lệnh thực thi:** `pnpm test:ts`
- **Môi trường:** Node.js v24.17.0 (`--experimental-strip-types`)
- **Kết quả:** `ℹ pass 51, ℹ fail 0, ℹ duration_ms 320ms`
- **Các suite thành phần:**
  1. `ArtifactStore Content-Addressable Storage & Fidelity Verification`: 8/8 PASS
  2. `CostGuard Zero-Cost (0đ) Policy Enforcement`: 17/17 PASS
  3. `AdmissionPolicyGate & Orchestrator Zero-Cost (0đ) Policy`: 7/7 PASS
  4. `Union Bot Protocol Schemas (Zod validation)`: 6/6 PASS
  5. `SafeExternal Security Validation Tests`: 8/8 PASS (spikes) + 4/4 PASS (desktop)
  6. `Cross-Package Integration (Protocol + CostGuard + ArtifactStore + Orchestrator)`: 1/1 PASS

### B. Bộ kiểm thử Python (14 tests / 2 suites)
- **Lệnh thực thi:** `pnpm test:py`
- **Môi trường:** Python 3.11.9
- **Kết quả:** `Ran 14 tests in 1.103s — OK`
- **Các suite thành phần:**
  1. `tests/test_scan_secrets.py`: 7/7 PASS (kiểm tra allowlist, format giả, directory traversal, strict exit code)
  2. `tests/test_codex_harness.py`: 7/7 PASS (kiểm tra direct argv, JSON schema parsing, terminal status, thread drain)

### C. Kiểm thử Khởi động Giao diện Thực tế trên Windows (GUI Smoke Test)
- **Lệnh thực thi:** `pnpm smoke:gui` (tương đương `node apps/desktop/scripts/launch.js --smoke`)
- **Môi trường:** Windows 11, Electron v33.4.11
- **File bằng chứng xuất xưởng:** `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`
- **Nội dung bằng chứng:**
  ```json
  {
    "suite": "UNION_BOT_ELECTRON_GUI_SMOKE",
    "timestamp": "2026-10-18T15:45:35.367Z",
    "windowTitle": "Union Bot",
    "userDataDir": "C:\\Users\\Lenovo\\AppData\\Roaming\\Electron",
    "costGuardBlockedPaid": true,
    "safeExternalBlockedDangerous": true,
    "singleInstanceLocked": true,
    "result": "PASS"
  }
  ```
- **Exit Code:** `0`

### D. Kiểm tra Quét Mã độc & Lộ lọt Bí mật Nghiêm ngặt (Strict Secret Scan)
- **Lệnh thực thi:** `pnpm secret-scan` (tương đương `python scan_secrets.py --strict`)
- **Kết quả:**
  ```
  Scanned files : 732
  Total findings: 8
    - Triaged Safe (Explicit Allowlist): 8
    - Confirmed Real Leaks              : 0
    - Unresolved Findings               : 0
  Scan errors   : 0
  PASS: Secret scan completed safely without plaintext exposure.
  ```

---

## 5. Phân loại Mức tin cậy Bằng chứng (Evidence Taxonomy)

- `[SOURCE_VERIFIED]`:
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
  - `@union-bot/protocol` (`src/schemas.ts`, `src/index.ts`)
  - `@union-bot/orchestrator` (`src/admission-gate.ts`, `src/orchestrator.ts`)
  - `@union-bot/cost-guard` (`src/cost-guard.ts`)
  - `@union-bot/artifact-store` (`src/artifact-store.ts`)
  - `apps/desktop` (`src/main.js`, `src/preload.cjs`, `src/safe-external.js`)
  - `apps/workspace-ui` (`src/App.tsx`, `src/components/`, `dist/index.html`)
- `[TEAM_EXECUTED_LOG_INSPECTED]`:
  - `scripts/verify.ps1`: Chạy thành công toàn bộ 5 bước kiểm thử trên Windows trạm.
  - `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`: Sinh ra tự động từ tiến trình Electron main.
  - `reports/audit/SECRET_SCAN_REPORT.md`: Kết quả quét 732 tệp thực tế.
- `[BLOCKED_EXTERNAL]`:
  - Claude Web & DeepSeek Web: Hiện phân loại chính xác là `LOGIN_REQUIRED / STANDBY`, không mạo danh trạng thái sẵn sàng gửi prompt khi chưa đăng nhập.

---

## 6. Giới hạn Đã biết & Tuyên bố Không mạo danh (Known Gaps & Excluded Claims)

1. **Chưa có Multi-Provider WebContentsView nhúng trực tiếp trong UI (Dành cho Phase P4)**:
   - Giao diện `apps/workspace-ui` ở Phase P1 hiển thị trạng thái `DEMO MODE (OFFLINE)` minh bạch và lịch sử tin nhắn mẫu, chưa gắn 4 view web trực tiếp (việc này thuộc đúng scope của Phase P4).
2. **Chưa có Event Sourcing & SQLite WAL (Dành cho Phase P2)**:
   - `Orchestrator` hiện lưu trữ room histories trong in-memory map và Zod schema, sẵn sàng chuyển tiếp sang SQLite WAL theo đúng kế hoạch Phase P2.
3. **Chính sách Không Chi Phí (0đ) Tuyệt đối**:
   - Hệ thống không sử dụng, không yêu cầu và cấm nạp bất kỳ OpenAI/Gemini/Anthropic API Key trả phí nào. Toàn bộ hoạt động dựa trên local agents (Codex, Antigravity) và Web UI miễn phí có bảo vệ egress.

---

## 7. Yêu cầu Nghiệm thu gửi Technical Leader (ChatGPT Web)

Kính đề nghị **Technical Leader (ChatGPT Web)**:
1. Đọc và thẩm tra toàn bộ hồ sơ `REVIEW_PACKET_P1_R01.md`, đối chiếu cây thư mục mã nguồn và commit SHA mới nhất trên GitHub repository `https://github.com/wtrg/union-bot`.
2. Kiểm tra tính toàn vẹn của các giải pháp cho 7 vé nợ kỹ thuật (`UB-P1-SEC-001` đến `004`, `UB-P1-QA-005`, `UB-P1-ARCH-006`, `UB-P1-QA-007`).
3. Ban hành văn bản đánh giá độc lập chính thức:
   - Nếu đạt chuẩn: Phê duyệt quyết định **`GO_P2`** cho phép đội ngũ bước vào **Phase P2: Protocol, Storage & Event Sourcing**.
   - Nếu còn thiếu sót: Ban hành **`REVIEW_FIX_PLAN_P1_R01.md`** chỉ rõ các điểm cần sửa chữa trước khi chuyển pha.

---
*Ký tên:*  
**Antigravity** (Implementation Owner) & **Codex** (QA & Security Lead)
