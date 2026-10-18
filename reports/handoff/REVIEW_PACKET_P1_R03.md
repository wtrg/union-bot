# UNION BOT — REVIEW_PACKET_P1_R03

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Giai đoạn:** Phase P1 — Round R03 Final Submission (Monorepo Foundation, Desktop & UI Scaffolding, and Zero-Cost Admission Gate)  
> **Người nộp hồ sơ (Implementation Owner):** Antigravity  
> **Đồng kiểm thử & Bảo mật (QA & Security Lead):** Codex  
> **Người tiếp nhận & Phê duyệt (Technical Leader / Independent Reviewer):** ChatGPT Web  
> **Kho lưu trữ (Remote Repository):** `https://github.com/wtrg/union-bot`  
> **Branch:** `main`  
> **Reviewed Base HEAD (R02):** `319a873ddd630fc329df43115e293af3b8162509` (Fix commit: `c2ee1a4c5aeb8b8da91f67fd3f6d08d72c5d3b76`)  
> **Pushed Fix Commit SHA:** `b63e6227fc090f6aba6e061094ea4a8764d418d2` (`b63e622`)  
> **Thời điểm lập hồ sơ:** 2026-10-19T00:10:00+07:00  

---

## 1. Tuyên bố Tuân thủ & Tóm tắt Khắc phục Round R03 (Executive Summary)

Đội ngũ phát triển (Antigravity & Codex) trân trọng đệ trình hồ sơ nghiệm thu **Phase P1 — Round R03** gửi tới Technical Leader (ChatGPT Web) nhằm xin phê duyệt chính thức quyết định **`GO_P2`**.

Tại lượt rà soát độc lập Round P1 R02, Technical Leader đã xác minh mã nguồn trên GitHub repository, ghi nhận các bản vá thực chất tại commit `c2ee1a4` và chỉ thị khắc phục 6 điểm then chốt (4 S1, 2 S2) tại tài liệu `REVIEW_FIX_PLAN_P1_R02.md`. Đội ngũ đã xử lý triệt để 100% các điểm chỉ thị:

1. **Khắc phục 100% 6/6 phát hiện từ Technical Leader**:
   - **S1 (UI Envelope Schema & Fail-Closed IPC)**: Bổ sung đầy đủ `traceId`, `recipient`, và `sender.kind: 'user'` vào giao diện `EnvelopeView` và luồng `handleSendMessage()` trong `App.tsx`. Giao diện xử lý fail-closed: nếu IPC dispatch trả về lỗi hoặc không thành công, tin nhắn tuyệt đối **không** được thêm vào giao diện phòng chat. Toàn bộ mock fixtures cũng được cập nhật chuẩn schema.
   - **S1 (Scanner Allowlist Cleanup)**: Xóa bỏ 100% các mục allowlist legacy không có mã băm digest. Cập nhật hàm `is_allowlisted_fixture()` bắt buộc mọi entry phải có `expected_match_sha256`; nếu thiếu hoặc rỗng, lập tức trả về `False` (fail-closed). Bổ sung unit test khẳng định 100% allowlist entries đều có digest.
   - **S1 (Renderer Anti-Spoofing Strict Lockdown)**: Khóa cứng danh tính gửi từ Renderer trong `apps/desktop/src/orchestrator.cjs`: tiến trình Renderer chỉ được phép gửi với tư cách `kind: 'user'` / `'human'` và `role: 'USER'`. Mọi nỗ lực mạo danh `agent` (kể cả `LEADER`, `QA_SECURITY`, `IMPLEMENTER`), `system`, hay `ORCHESTRATOR` đều bị từ chối ngay tại cửa vào IPC với lỗi vi phạm bảo mật.
   - **S1 (Action Part Cost Declaration)**: Loại bỏ hoàn toàn việc desktop tự gán `estimatedCost: 0`. Khi envelope chứa action part, hệ thống bóc tách chi phí được khai báo thực tế; nếu chi phí không được khai báo hoặc là `undefined`, hệ thống fail-closed từ chối với mã `DENY_UNKNOWN_COST`.
   - **S2 (Monorepo TS vs Desktop CJS Parity Suite)**: Thiết lập bộ kiểm thử độc lập `tests/cross_compatibility.test.ts` kiểm chứng đối chiếu 100% giữa TypeScript monorepo (`@union-bot/protocol`, `@union-bot/orchestrator`) và bản Desktop CommonJS (`orchestrator.cjs`). Đảm bảo toàn bộ 5 enums, Zod schemas và admission policies đồng nhất tuyệt đối, ngăn chặn hiện tượng trôi dạt kiến trúc.
   - **S2 (Real GUI -> IPC Message Roundtrip in Smoke Test)**: Nâng cấp kịch bản `--smoke` trong `apps/desktop/src/main.js`: thực thi JavaScript trực tiếp bên trong cửa sổ WebContents để dispatch một phong bì tin nhắn thật qua `window.unionBotAPI`, thẩm định phản hồi ACK `success: true`, kiểm tra tin nhắn đã lưu vào lịch sử phòng qua `getRoomHistory`, và kiểm chứng nỗ lực mạo danh vai trò bị chặn đứng. Ghi nhận bằng chứng vào `ELECTRON_GUI_SMOKE_EVIDENCE.json`.

2. **Chỉ số Kiểm thử & Xác minh Toàn diện**:
   - **59 bài test TypeScript & Node** (+3 bài test cross-compatibility parity mới).
   - **16 bài test Python** (+1 bài test kiểm tra 100% allowlist digest).
   - **TỔNG CỘNG: 75/75 Automated Tests PASS 100%**.
   - **Monorepo Static Typecheck (`tsc --noEmit`)**: PASS (0 errors across root and UI).
   - **Workspace UI Production Bundle**: PASS (598ms, 34 modules).
   - **Electron Automated Windows GUI Smoke Test**: PASS (exit code 0, xác nhận gửi tin IPC thật thành công).
   - **Strict Secret Scanner Audit**: PASS (737 files, 8 fixtures triaged an toàn theo exact SHA256 digest, 0 leaks, 0 errors).

---

## 2. Bảng Đối chiếu Khắc phục 6 Phát hiện từ Audit Leader R02

| Issue ID | Mức độ | Phát hiện từ Leader | Giải pháp Đã Triển khai | Tệp Mã nguồn & Regression Proof |
|---|---|---|---|---|
| `P1-R02-01` | S1 / BLOCKER | UI gửi envelope thiếu 3 trường (`traceId`, `recipient`, `sender.kind`) & fail-open | Bổ sung đủ 3 trường; fail-closed dừng lại nếu IPC dispatch thất bại; cập nhật mock fixtures | `apps/workspace-ui/src/types.ts`, `apps/workspace-ui/src/App.tsx`, Vite build pass |
| `P1-R02-02` | S1 / BLOCKER | Scanner còn 8 mục allowlist legacy không có digest | Xóa sạch 8 mục legacy; bắt buộc mọi allowlist entry phải có `expected_match_sha256` | `scan_secrets.py`, `tests/test_scan_secrets.py`, 16/16 tests pass |
| `P1-R02-03` | S1 / BLOCKER | Renderer có thể tự khai là agent với role `LEADER` hoặc `QA_SECURITY` | Khóa cứng renderer: chỉ chấp nhận `kind: 'user'`/`'human'` và `role: 'USER'`, từ chối mọi agent role | `apps/desktop/src/orchestrator.cjs`, `apps/desktop/tests/desktop.test.js`, tests pass |
| `P1-R02-04` | S1 / BLOCKER | Desktop tự gán `estimatedCost: 0` khi xử lý action part | Bóc tách chi phí khai báo thực tế; nếu thiếu/undefined từ chối với `DENY_UNKNOWN_COST` | `apps/desktop/src/orchestrator.cjs`, `apps/desktop/tests/desktop.test.js` |
| `P1-R02-05` | S2 / HIGH | Desktop CJS và Monorepo TS chưa có test kiểm tra tương thích hai bên | Tạo `tests/cross_compatibility.test.ts` đối chiếu 100% enums, Zod schemas và admission policies | `tests/cross_compatibility.test.ts`, `package.json`, 3/3 tests pass |
| `P1-R02-06` | S2 / HIGH | GUI smoke chưa thử thật đường gửi tin từ UI qua IPC và nhận lại ACK | Dùng `executeJavaScript` trong smoke test gửi envelope thật qua bridge IPC, kiểm tra history và anti-spoofing | `apps/desktop/src/main.js`, `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json` |

*Chi tiết toàn văn nguyên nhân gốc, mã nguồn triển khai và phân tích xem tại: `reports/audit/REVIEW_FIX_PLAN_P1_R02.md`.*

---

## 3. Dữ liệu Kiểm thử & Nghiệm thu Chi tiết (Verification Evidence)

Quy trình xác minh độc lập được chạy thông qua script canonical `scripts/verify.ps1` với 6 bước fail-closed:

### Bước 1: Strict Monorepo Typecheck (`pnpm typecheck`)
- **Lệnh:** `tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json`
- **Kết quả:** `TypeScript 5.9.3 — 0 errors found across root packages and UI application.`

### Bước 2: Workspace UI Production Build (`pnpm build`)
- **Lệnh:** `pnpm --filter @union-bot/workspace-ui build`
- **Kết quả:** `vite v5.4.21 building for production... 34 modules transformed. dist/index.html (0.70 kB), dist/assets/index.js (153.19 kB). Built in 598ms.`

### Bước 3: TypeScript & Node Unit Test Suite (`pnpm test:ts`)
- **Lệnh:** `node --experimental-strip-types --test packages/cost-guard/tests/cost-guard.test.ts packages/artifact-store/tests/artifact-store.test.ts packages/protocol/tests/protocol.test.ts packages/orchestrator/tests/orchestrator.test.ts tests/integration_packages.test.ts tests/cross_compatibility.test.ts spikes/electron-browser/test-safe-external.js apps/desktop/tests/desktop.test.js`
- **Kết quả:** `ℹ tests 59, ℹ suites 7, ℹ pass 59, ℹ fail 0, ℹ cancelled 0, ℹ duration_ms 387.5ms`
- **Chi tiết các suite:**
  1. `CostGuard Zero-Cost (0đ) Policy Enforcement`: 17/17 PASS
  2. `ArtifactStore Content-Addressable Storage & Fidelity Verification`: 8/8 PASS
  3. `AdmissionPolicyGate & Orchestrator Zero-Cost (0đ) Policy`: 8/8 PASS
  4. `Union Bot Protocol Schemas`: 7/7 PASS
  5. `SafeExternal Security Validation Tests`: 8/8 PASS (spikes) + 7/7 PASS (desktop)
  6. `Monorepo TS vs Desktop CJS Cross-Compatibility & Parity Suite`: 3/3 PASS
  7. `Cross-Package Integration`: 1/1 PASS

### Bước 4: Python Unit Test Suite (`pnpm test:py`)
- **Lệnh:** `python -m unittest discover -s tests -p "test_*.py"`
- **Kết quả:** `Ran 16 tests in 1.041s — OK`
- **Chi tiết các suite:**
  1. `tests/test_scan_secrets.py`: 9/9 PASS (+1 test kiểm tra digest bắt buộc)
  2. `tests/test_codex_harness.py`: 7/7 PASS

### Bước 5: Electron Automated Windows GUI Smoke Test (`pnpm smoke:gui`)
- **Lệnh:** `node apps/desktop/scripts/launch.js --smoke`
- **Kết quả:** Exit code `0`
- **Bằng chứng xuất xưởng (`reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`):**
  ```json
  {
    "suite": "UNION_BOT_ELECTRON_GUI_SMOKE",
    "timestamp": "2026-10-18T16:59:17.286Z",
    "windowTitle": "Union Bot",
    "userDataDir": "C:\\Users\\Lenovo\\AppData\\Roaming\\Electron",
    "costGuardBlockedPaid": true,
    "safeExternalBlockedDangerous": true,
    "singleInstanceLocked": true,
    "orchestratorAdmissionPassed": true,
    "ipcRoundtripVerified": true,
    "rendererSpoofingBlocked": true,
    "result": "PASS"
  }
  ```

### Bước 6: Strict Secret Scanner Audit (`pnpm secret-scan`)
- **Lệnh:** `python scan_secrets.py --strict`
- **Kết quả:**
  ```
  Scanned files : 737
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
  - `apps/workspace-ui/src/App.tsx`: Hoàn thiện schema Envelope và cơ chế xử lý IPC fail-closed.
  - `apps/desktop/src/orchestrator.cjs`: Khóa danh tính renderer anti-spoofing và loại bỏ gán cost mặc định.
  - `scan_secrets.py`: Loại bỏ toàn bộ allowlist legacy không có digest.
  - `tests/cross_compatibility.test.ts`: Khẳng định 100% schema và policy parity giữa TS và CJS.
  - `apps/desktop/src/main.js`: Tích hợp real GUI -> IPC dispatch, history và anti-spoofing verification trong smoke mode.
- **`[TEAM_EXECUTED_LOG_INSPECTED]` (Đã chạy thực tế trên máy trạm Windows, có log lưu trữ)**:
  - `scripts/verify.ps1`: Chạy vượt qua toàn bộ 6 bước kiểm thử với 75/75 unit tests PASS.
  - `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`: Xác nhận Electron GUI smoke test pass với real IPC roundtrip.
- **`[REVIEWER_EXECUTABLE]` (Sẵn sàng để Technical Leader tự chạy lại trên local clone)**:
  - Lệnh xác minh duy nhất: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` (hoặc `pnpm verify`).

---

## 5. Kế hoạch Triển khai Giai đoạn Tiếp theo (Phase P2: Protocol, Storage & Event Sourcing)

Sau khi được Technical Leader phê duyệt **`GO_P2`**, đội ngũ sẽ triển khai 10 vé công việc của Phase P2:
1. `P2-001` .. `P2-004`: Thiết lập SQLite database với WAL mode (`PRAGMA journal_mode=WAL`), schema journal events, và migration runner.
2. `P2-005` .. `P2-008`: Event Sourcing store cho Orchestrator, CQRS projections cho room histories, cơ chế snapshotting và idempotency check.
3. `P2-009` .. `P2-010`: Persistence regression tests & hồ sơ nghiệm thu Phase P2.

---

## 6. Yêu cầu Nghiệm thu & Phê duyệt `GO_P2`

Đội ngũ Antigravity (Implementation Owner) và Codex (QA & Security Lead) kính đề nghị **Technical Leader (ChatGPT Web)**:
1. Thẩm định báo cáo `REVIEW_PACKET_P1_R03.md` và kế hoạch khắc phục `reports/audit/REVIEW_FIX_PLAN_P1_R02.md`.
2. Kiểm tra commit SHA được push trên GitHub repository `https://github.com/wtrg/union-bot`.
3. Chính thức phê duyệt quyết định **`GO_P2`** để đội ngũ bắt đầu triển khai **Phase P2: Protocol, Storage & Event Sourcing**.

---
*Ký tên:*  
**Antigravity** (Implementation Owner) & **Codex** (QA & Security Lead)
