# UNION BOT — REVIEW_PACKET_P1_R02

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Giai đoạn:** Phase P1 — Round R02 Fix Loop (Monorepo Foundation, Desktop & UI Scaffolding, and Zero-Cost Admission Gate)  
> **Người nộp hồ sơ (Implementation Owner):** Antigravity  
> **Đồng kiểm thử & Bảo mật (QA & Security Lead):** Codex  
> **Người tiếp nhận & Phê duyệt (Technical Leader / Independent Reviewer):** ChatGPT Web  
> **Kho lưu trữ (Remote Repository):** `https://github.com/wtrg/union-bot`  
> **Branch:** `main`  
> **Base Reviewed SHA (R01):** `4540c055b0ae529f825ef7b616a7ae344d6d2ced` (`4540c05`)  
> **Target Submission Head SHA:** [SẼ CẬP NHẬT CHÍNH XÁC KHI PUSH]  
> **Thời điểm lập hồ sơ:** 2026-10-18T23:45:00+07:00  

---

## 1. Tuyên bố Tuân thủ & Tóm tắt Khắc phục Round R02 (Executive Summary)

Đội ngũ phát triển (Antigravity & Codex) xin trân trọng đệ trình hồ sơ nghiệm thu **Phase P1 — Round R02** gửi tới Technical Leader (ChatGPT Web).

Tại lượt rà soát độc lập Round R01, Technical Leader đã ban hành quyết định `CHANGES_REQUIRED — P2_PREPARATION_ALLOWED` cùng danh mục 8 phát hiện (4 S1, 3 S2, 1 S3). Đội ngũ đã tiếp thu 100% các ý kiến xác đáng, không bao biện, không sửa ẩu, và đã hoàn thành việc tái cấu trúc, vá lỗi bảo mật, và bổ sung kiểm thử hồi quy nghiêm ngặt:

1. **Khắc phục 100% 8/8 phát hiện từ Technical Leader**:
   - **S1 (Admission Cost Defaulting)**: Đã xóa bỏ hoàn toàn `.default(0)` trong `AdmissionActionSchema`. Đã thêm kiểm tra fail-closed trong `AdmissionPolicyGate.evaluate()`, từ chối ngay với mã `DENY_UNKNOWN_COST` nếu thiếu hoặc không hợp lệ chi phí.
   - **S1 (IPC Orchestrator Disconnection)**: Đã bãi bỏ `Map` in-memory cục bộ trong Electron `main.js`. Đã xây dựng `apps/desktop/src/orchestrator.cjs` kết nối toàn bộ IPC handler (`send-message`, `get-history`) qua `Orchestrator` và Zod schema validation.
   - **S1 (Renderer Anti-Spoofing & Envelope Validation)**: Đã chặn triệt để renderer mạo danh `kind: system` hoặc `role: ORCHESTRATOR`. Toàn bộ message parts dạng `action` đều bị thẩm định qua `AdmissionPolicyGate`.
   - **S1 (Secret Scanner Content Digest)**: Đã ghim mã băm SHA256 chính xác (`expected_match_sha256`) cho toàn bộ 8 fixture an toàn trong `scan_secrets.py`. Scanner sẽ báo `UNRESOLVED` (exit 1) nếu nội dung fixture bị can thiệp.
   - **S2 (Fail-Closed GUI Smoke Assertions)**: Bổ sung logic fail-closed rõ ràng: nếu bất kỳ assert nào không đạt, Electron ghi nhận `result: 'FAIL'` và thoát ngay lập tức với `process.exit(1)`.
   - **S2 (Strict `file://` Navigation Scope)**: Khóa cứng sự kiện `will-navigate` chỉ cho phép duy nhất tệp `dist/index.html` của ứng dụng; mọi liên kết khác đều bị hủy bỏ và chuyển sang `safeOpenExternal`.
   - **S2 (TypeScript Typecheck in CI Pipeline)**: Đã tích hợp `pnpm typecheck` (`tsc --noEmit`) làm **Bước 1** trong `scripts/verify.ps1`, phát hiện và sửa triệt để 2 lỗi kiểu tiềm ẩn.
   - **S3 (UI Demo Transparency & Empty States)**: Khởi tạo phòng rỗng khi chạy trong Electron thật; gắn nhãn tường minh `[OFFLINE MOCK PREVIEW]` khi xem offline; hiển thị badge `ELECTRON LIVE IPC (ZERO-COST ACTIVE)`.

2. **Nâng tổng số bài kiểm thử tự động lên 71 bài test PASS 100%**:
   - **56 bài test TypeScript & Node** (+5 test hồi quy mới: cost defaulting, unknown cost, IPC dispatch, anti-spoofing, paid action blocking).
   - **15 bài test Python** (+1 test hồi quy mới: secret scanner content digest verification).
   - **1 Electron Automated GUI Smoke Test trên Windows thật**: PASS (exit code 0).
   - **1 Strict Secret Scanner Audit**: 734 files, 8 fixtures triaged an toàn theo exact SHA256 digest, 0 leaks, 0 errors.

---

## 2. Bảng Đối chiếu Khắc phục 8 Phát hiện từ Audit Leader R01

| Issue ID | Mức độ | Tóm tắt Vấn đề từ Leader | Chi tiết Khắc phục | Tệp Mã nguồn & Regression Test |
|---|---|---|---|---|
| `P1-R01-01` | S1 / BLOCKER | Bỏ `.default(0)` tại schema chi phí; fail-closed khi thiếu cost | Xóa `.default(0)` trong `AdmissionActionSchema`; thêm kiểm tra fail-closed trả về `DENY_UNKNOWN_COST` | `packages/protocol/src/schemas.ts`, `packages/orchestrator/src/admission-gate.ts`, tests pass |
| `P1-R01-02` | S1 / BLOCKER | IPC Electron dùng Map riêng rẽ, tách rời Orchestrator | Tạo `apps/desktop/src/orchestrator.cjs`; kết nối IPC handlers `send-message` và `get-history` qua Orchestrator | `apps/desktop/src/orchestrator.cjs`, `apps/desktop/src/main.js`, tests pass |
| `P1-R01-03` | S1 / BLOCKER | Nguy cơ renderer giả mạo `system`/`ORCHESTRATOR` & thiếu kiểm duyệt envelope | Thẩm định Zod `EnvelopeSchema.safeParse`; chặn renderer mạo danh; duyệt action parts qua Admission Gate | `apps/desktop/src/orchestrator.cjs`, `apps/desktop/tests/desktop.test.js` |
| `P1-R01-04` | S1 / BLOCKER | Secret scanner allowlist chỉ dựa vào path_suffix, chưa kiểm tra hash | Ghim `expected_match_sha256` cho 8 fixture; tính `hashlib.sha256` nội dung khớp, chặn secret mới chèn vào fixture | `scan_secrets.py`, `tests/test_scan_secrets.py` |
| `P1-R01-05` | S2 / HIGH | Electron GUI smoke test chưa assert fail-closed với exit code 1 | Đánh giá `allChecksPassed`; ghi JSON `result: PASS/FAIL`; gọi `app.exit(allChecksPassed ? 0 : 1)` | `apps/desktop/src/main.js`, `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json` |
| `P1-R01-06` | S2 / HIGH | Electron `will-navigate` chưa khóa chặt phạm vi `file://` | Tính `allowedUiFileUrl` chính xác; chặn mọi URL khác `allowedUiFileUrl` và chuyển sang `safeOpenExternal` | `apps/desktop/src/main.js`, `apps/desktop/tests/desktop.test.js` |
| `P1-R01-07` | S2 / HIGH | CI `verify.ps1` chưa chạy `typecheck` tĩnh (`tsc --noEmit`) | Cài đặt `typescript` root; cấu hình `tsconfig.json`; thêm script `typecheck`; đặt làm Bước 1 trong `verify.ps1` | `package.json`, `tsconfig.json`, `scripts/verify.ps1`, 0 errors |
| `P1-R01-08` | S3 / MED | Giao diện nạp sẵn mock chat dễ gây nhầm lẫn là live | Khởi tạo phòng rỗng khi trong Electron; dán nhãn `[OFFLINE MOCK PREVIEW]` khi xem preview; thêm empty state | `apps/workspace-ui/src/App.tsx`, `Header.tsx`, `ChatRoom.tsx` |

*Chi tiết toàn văn nguyên nhân gốc, mã nguồn triển khai và phân tích xem tại: `reports/audit/REVIEW_FIX_PLAN_P1_R01.md`.*

---

## 3. Bằng chứng Kiểm chứng Toàn diện Hệ thống (Verification Evidence)

Quy trình xác minh độc lập được chạy thông qua script canonical `scripts/verify.ps1` với 6 bước fail-closed:

### Bước 1: Strict Monorepo Typecheck (`pnpm typecheck`)
- **Lệnh:** `tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json`
- **Kết quả:** `TypeScript 5.9.3 — 0 errors found across root packages and UI application.`

### Bước 2: Workspace UI Production Build (`pnpm build:ui`)
- **Lệnh:** `pnpm --filter @union-bot/workspace-ui build`
- **Kết quả:** `vite v6.2.2 building for production... 34 modules transformed. dist/index.html (0.47 kB), dist/assets/index.js (157.82 kB). Built in 627ms.`

### Bước 3: TypeScript & Node Unit Test Suite (`pnpm test:ts`)
- **Lệnh:** `node --test packages/*/tests/*.ts packages/*/tests/*.js apps/*/tests/*.js tests/*.ts`
- **Kết quả:** `ℹ tests 56, ℹ suites 6, ℹ pass 56, ℹ fail 0, ℹ cancelled 0, ℹ duration_ms 338.4ms`
- **Chi tiết các suite:**
  1. `CostGuard Zero-Cost (0đ) Policy Enforcement`: 17/17 PASS
  2. `ArtifactStore Content-Addressable Storage & Security`: 8/8 PASS
  3. `AdmissionPolicyGate & Orchestrator Zero-Cost (0đ) Policy`: 8/8 PASS (+1 test reject missing estimatedCost)
  4. `Union Bot Protocol Schemas (Zod validation)`: 7/7 PASS (+1 test reject action without cost)
  5. `SafeExternal Security Validation Tests`: 8/8 PASS (spikes) + 7/7 PASS (desktop: +3 tests for orchestrator IPC, anti-spoofing, and paid action blocking)
  6. `Cross-Package Integration`: 1/1 PASS

### Bước 4: Python Unit Test Suite (`pnpm test:py`)
- **Lệnh:** `python -m unittest discover -s tests -p "test_*.py"`
- **Kết quả:** `Ran 15 tests in 1.124s — OK`
- **Chi tiết các suite:**
  1. `tests/test_scan_secrets.py`: 8/8 PASS (+1 test reject modified secret fixture hash)
  2. `tests/test_codex_harness.py`: 7/7 PASS

### Bước 5: Electron Automated Windows GUI Smoke Test (`pnpm smoke:gui`)
- **Lệnh:** `node apps/desktop/scripts/launch.js --smoke`
- **Kết quả:** Exit code `0`
- **Bằng chứng xuất xưởng (`reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`):**
  ```json
  {
    "suite": "UNION_BOT_ELECTRON_GUI_SMOKE",
    "timestamp": "2026-10-18T16:32:00.672Z",
    "windowTitle": "Union Bot",
    "userDataDir": "C:\\Users\\Lenovo\\AppData\\Roaming\\Electron",
    "costGuardBlockedPaid": true,
    "safeExternalBlockedDangerous": true,
    "singleInstanceLocked": true,
    "admissionGatePassed": true,
    "result": "PASS"
  }
  ```

### Bước 6: Strict Secret Scanner Audit (`pnpm secret-scan`)
- **Lệnh:** `python scan_secrets.py --strict`
- **Kết quả:**
  ```
  Scanned files : 734
  Total findings: 8
    - Triaged Safe (Explicit Allowlist & SHA256 Match): 8
    - Confirmed Real Leaks                            : 0
    - Unresolved Findings                             : 0
  Scan errors   : 0
  PASS: Secret scan completed safely without plaintext exposure.
  ```

---

## 4. Phân loại Mức tin cậy Bằng chứng (Evidence Taxonomy)

- **`[SOURCE_VERIFIED]` (Đã kiểm chứng trực tiếp trong mã nguồn)**:
  - `apps/desktop/src/orchestrator.cjs`: Module điều phối trung tâm cho tiến trình Desktop.
  - `apps/desktop/src/main.js`: IPC handlers, navigation lockdown và GUI smoke exit handler.
  - `packages/protocol/src/schemas.ts`: Strict schema không cho phép default cost.
  - `packages/orchestrator/src/admission-gate.ts`: Fail-closed gate từ chối mọi chi phí không xác định.
  - `scan_secrets.py`: Bổ sung kiểm tra băm SHA256 cho fixture allowlist.
  - `apps/workspace-ui/`: Giao diện làm sạch demo, bổ sung empty states và mode indicator.
  - `scripts/verify.ps1`: Tích hợp Bước 1 typecheck fail-closed.
- **`[TEAM_EXECUTED_LOG_INSPECTED]` (Đã chạy thực tế trên máy trạm Windows, có log lưu trữ)**:
  - `scripts/verify.ps1`: Vượt qua toàn bộ 6 bước với 71/71 tests PASS.
  - `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`: Xác nhận Electron khởi động và kiểm tra an toàn thành công.
- **`[REVIEWER_EXECUTABLE]` (Sẵn sàng để Technical Leader tự chạy lại trên GitHub Actions hoặc local clone)**:
  - Lệnh kiểm tra duy nhất: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` (hoặc `pnpm test`).

---

## 5. Giới hạn Đã biết & Phân định Phạm vi Tiếp theo (Scope Boundaries)

1. **Phase P2: Protocol, Storage & Event Sourcing**:
   - `Orchestrator` hiện lưu trữ room histories trong in-memory store với Zod schema validation đầy đủ. Việc chuyển đổi sang SQLite WAL, bảng journal events và CQRS projection thuộc phạm vi chính thức của Phase P2.
2. **Phase P4: Multi-Provider Browser Integration**:
   - Giao diện chat hiện điều phối các tin nhắn nội bộ qua Orchestrator IPC. Việc tích hợp các tab `WebContentsView` nhúng 4 website AI (ChatGPT, Gemini, Claude, DeepSeek) cùng cơ chế session partitioning sẽ được triển khai tại Phase P4.
3. **Chính sách Không Chi Phí (0đ) Tuyệt đối**:
   - Khẳng định 100% không yêu cầu, không lưu trữ và từ chối nạp bất kỳ OpenAI/Gemini/Anthropic API Key trả phí nào.

---

## 6. Yêu cầu Nghiệm thu & Phê duyệt `GO_P2`

Đội ngũ Antigravity (Implementation Owner) và Codex (QA & Security Lead) kính đề nghị **Technical Leader (ChatGPT Web)**:
1. Thẩm định báo cáo `REVIEW_PACKET_P1_R02.md` và kế hoạch khắc phục `reports/audit/REVIEW_FIX_PLAN_P1_R01.md`.
2. Kiểm tra commit SHA được push trên GitHub repository `https://github.com/wtrg/union-bot`.
3. Chính thức phê duyệt quyết định **`GO_P2`** để đội ngũ bắt đầu triển khai **Phase P2: Protocol, Storage & Event Sourcing**.

---
*Ký tên:*  
**Antigravity** (Implementation Owner) & **Codex** (QA & Security Lead)
