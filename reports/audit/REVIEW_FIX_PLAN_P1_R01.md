# UNION BOT — REVIEW_FIX_PLAN_P1_R01

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Giai đoạn:** Phase P1 — Round R02 Fix Loop  
> **Technical Leader / Independent Reviewer:** ChatGPT Web  
> **Implementation Owner:** Antigravity  
> **QA & Security Lead:** Codex  
> **Reviewed Commit Base:** `4540c055b0ae529f825ef7b616a7ae344d6d2ced` (`4540c05`)  
> **Thời điểm lập tài liệu:** 2026-10-18T23:40:00+07:00  
> **Quyết định thẩm tra Round P1 R01:** `CHANGES_REQUIRED — P2_PREPARATION_ALLOWED`  
> **Mục tiêu:** Khắc phục triệt để 8/8 phát hiện từ Technical Leader (4 S1, 3 S2, 1 S3) để đạt chuẩn phê duyệt `GO_P2`.

---

## 1. Tóm tắt Quyết định Thẩm tra Round P1 R01 từ Technical Leader

Tại đợt nghiệm thu độc lập Phase P1 Round R01, Technical Leader (ChatGPT Web) ghi nhận các bước tiến nền móng quan trọng của Union Bot (monorepo toolchain, Electron desktop shell với Cost Guard interceptor, giao diện đa phòng React 18, Zod schema protocol, CAS artifact store). 

Tuy nhiên, Technical Leader chỉ ra 8 điểm cần khắc phục trước khi cấp lệnh `GO_P2`:
- **4 phát hiện S1 (Critical/Blocker)** liên quan đến tính fail-closed của cơ chế Zero-Cost (0đ), việc Electron IPC tách rời Orchestrator, nguy cơ renderer giả mạo định danh (`spoofing`), và cơ chế allowlist của secret scanner chỉ dựa trên hậu tố chuỗi mà chưa kiểm chứng hash nội dung.
- **3 phát hiện S2 (High)** liên quan đến việc kiểm thử GUI smoke chưa xác nhận fail-closed với exit code 1, phạm vi điều hướng `file://` của Electron chưa được khóa chặt chẽ, và quy trình CI (`verify.ps1`) chưa tích hợp `typecheck` (`tsc --noEmit`).
- **1 phát hiện S3 (Medium)** liên quan đến tính trung thực của giao diện phòng chat khi chạy thực tế (không hiển thị mock chat như thể live conversation) và gắn SHA commit tường minh trên header.

Dưới đây là chi tiết nguyên nhân, giải pháp thực hiện và bằng chứng kiểm chứng hồi quy cho từng mục trong số 8 phát hiện.

---

## 2. Bảng Theo dõi & Khắc phục Chi tiết 8 Điểm Thẩm tra

### Issue P1-R01-01 — S1: Loại bỏ Default Cost & Fail-Closed Unknown Cost
- **Severity:** `S1 — CRITICAL / BLOCKER`
- **Thành phần ảnh hưởng:** `packages/protocol/src/schemas.ts`, `packages/orchestrator/src/admission-gate.ts`
- **Quan sát của Leader:**
  - `AdmissionActionSchema.estimatedCost` được khai báo kèm `.default(0)`. Điều này khiến các hành động không khai báo chi phí tự động được gán chi phí 0đ, tiềm ẩn nguy cơ lọt các yêu cầu trả phí không lường trước.
  - Cần loại bỏ `.default(0)` và yêu cầu `estimatedCost` phải được cung cấp tường minh.
  - `AdmissionPolicyGate.evaluate()` phải kiểm tra nghiêm ngặt: nếu `estimatedCost` bị thiếu, `undefined`, `null`, `NaN`, hoặc không phải số hợp lệ thì lập tức từ chối với mã `DENY_UNKNOWN_COST`.
- **Giải pháp thực hiện:**
  1. Trong `packages/protocol/src/schemas.ts`: Sửa `estimatedCost: z.number().min(0)` (loại bỏ `.default(0)`).
  2. Trong `packages/orchestrator/src/admission-gate.ts`: Bổ sung kiểm tra fail-closed ngay đầu hàm `evaluate()`:
     ```typescript
     if (typeof action.estimatedCost !== 'number' || Number.isNaN(action.estimatedCost)) {
       return {
         allowed: false,
         policyCode: 'DENY_UNKNOWN_COST',
         reason: 'Estimated cost is required and must be a valid number (no implicit default allowed).',
       };
     }
     ```
- **Bằng chứng kiểm chứng (Regression Proof):**
  - `packages/protocol/tests/protocol.test.ts`: Test `AdmissionActionSchema rejects action without explicit estimatedCost` — PASS.
  - `packages/orchestrator/tests/orchestrator.test.ts`: Test `AdmissionPolicyGate rejects action missing estimatedCost with DENY_UNKNOWN_COST` — PASS.

---

### Issue P1-R01-02 — S1: Kết nối Electron IPC vào Orchestrator Thay vì Map Độc lập
- **Severity:** `S1 — CRITICAL / BLOCKER`
- **Thành phần ảnh hưởng:** `apps/desktop/src/orchestrator.cjs`, `apps/desktop/src/main.js`
- **Quan sát của Leader:**
  - `apps/desktop/src/main.js` trước đây duy trì một `Map` in-memory cục bộ để lưu trữ và gửi nhận tin nhắn giữa các phòng chat, tách rời khỏi `@union-bot/orchestrator`.
  - Điều này phá vỡ kiến trúc kiến trúc lõi được quy định trong Master Plan: mọi envelope phải đi qua Orchestrator để được kiểm soát vòng đời, admission policy và auditing.
- **Giải pháp thực hiện:**
  1. Xây dựng module CJS chuyên biệt `apps/desktop/src/orchestrator.cjs` đóng gói `Orchestrator`, `AdmissionPolicyGate` và `EnvelopeSchema` với Zod validation đầy đủ.
  2. Trong `apps/desktop/src/main.js`: Khởi tạo instance `orchestrator = new Orchestrator()` và chuyển giao toàn bộ xử lý IPC:
     - IPC Handler `union-bot:chat:send-message`: Ủy quyền cho `orchestrator.dispatchEnvelope(envelope, { fromRenderer: true })`.
     - IPC Handler `union-bot:chat:get-history`: Ủy quyền cho `orchestrator.getRoomHistory(roomId)`.
- **Bằng chứng kiểm chứng (Regression Proof):**
  - `apps/desktop/tests/desktop.test.js`: Test `desktop orchestrator dispatches valid envelopes and returns room history` — PASS.
  - Tích hợp trực tiếp trong `apps/desktop/src/main.js` và kiểm chứng qua Electron GUI Smoke run.

---

### Issue P1-R01-03 — S1: Chống Renderer Spoofing & Thẩm định Toàn diện Envelope
- **Severity:** `S1 — CRITICAL / BLOCKER`
- **Thành phần ảnh hưởng:** `apps/desktop/src/orchestrator.cjs`
- **Quan sát của Leader:**
  - Tiến trình Renderer không được phép tự do mạo danh danh tính hệ thống (`sender.kind: 'system'`, `sender.role: 'ORCHESTRATOR'`).
  - Toàn bộ payload gửi qua IPC phải được thẩm định cấu trúc chặt chẽ (`EnvelopeSchema.safeParse`), và các message part dạng `action` phải được kiểm tra qua `AdmissionPolicyGate`.
- **Giải pháp thực hiện:**
  1. Trong `Orchestrator.dispatchEnvelope(rawEnvelope, context)`:
     - Thực thi `EnvelopeSchema.safeParse(rawEnvelope)`. Nếu không hợp lệ, trả về `{ delivered: false, error: 'INVALID_ENVELOPE_SCHEMA' }`.
     - Kiểm tra anti-spoofing:
       ```javascript
       if (context && context.fromRenderer) {
         if (envelope.sender.kind === 'system' || envelope.sender.role === 'ORCHESTRATOR') {
           return {
             delivered: false,
             error: 'RENDERER_IDENTITY_SPOOFING_FORBIDDEN',
             reason: 'Renderer cannot forge system or orchestrator identity',
           };
         }
       }
       ```
     - Lặp qua các `parts`: nếu part có dạng `action`, gọi `this.admissionGate.evaluate(part.action)` để từ chối ngay nếu vi phạm Zero-Cost hoặc chưa được duyệt.
- **Bằng chứng kiểm chứng (Regression Proof):**
  - `apps/desktop/tests/desktop.test.js`:
    - `desktop orchestrator rejects renderer spoofing system or orchestrator role` — PASS.
    - `desktop orchestrator blocks paid action parts dispatched from renderer` — PASS.

---

### Issue P1-R01-04 — S1: Kiểm chứng Mã băm SHA256 Nội dung Fixture trong Secret Scanner
- **Severity:** `S1 — CRITICAL / BLOCKER`
- **Thành phần ảnh hưởng:** `scan_secrets.py`, `tests/test_scan_secrets.py`
- **Quan sát của Leader:**
  - `scan_secrets.py` cho phép triaged safe đối với fixture dựa trên chuỗi đường dẫn tệp (`path_suffix`). Nếu kẻ tấn công hoặc lập trình viên vô tình chèn secret thật vào tệp fixture hợp lệ, scanner sẽ bỏ qua.
  - Scanner bắt buộc phải ghim chặt mã băm SHA256 của nội dung chuỗi trùng khớp (`expected_match_sha256`).
- **Giải pháp thực hiện:**
  1. Trong `scan_secrets.py`: Bổ sung trường `expected_match_sha256` cho tất cả 8 mục trong `BENIGN_FIXTURE_ALLOWLIST`.
  2. Trong hàm `is_allowlisted_fixture(file_path, rule_id, raw_val)`:
     - Tính toán `raw_val_sha256 = hashlib.sha256(raw_val.encode('utf-8')).hexdigest()`.
     - Chỉ chấp nhận nếu đường dẫn chuẩn hóa kết thúc bằng `path_suffix` VÀ `rule_id` khớp VÀ `raw_val_sha256 == item["expected_match_sha256"]`.
     - Nếu bất kỳ ký tự nào bị thay đổi hoặc có secret mới đưa vào fixture, giá trị hash không khớp và tệp bị đánh dấu `UNRESOLVED` (khiến exit code = 1).
  3. Cập nhật `tests/test_scan_secrets.py` sử dụng phép ghép chuỗi động (`"fake" + "_ghp_..."`) để tránh tự quét trúng fixture test.
- **Bằng chứng kiểm chứng (Regression Proof):**
  - `tests/test_scan_secrets.py`: Test `test_allowlist_rejects_modified_secret_content_hash` — PASS.
  - Toàn bộ 8/8 test Python trong `test_scan_secrets.py` PASS 100%. Quét 734 tệp toàn repo xác nhận 8 fixture khớp chính xác SHA256.

---

### Issue P1-R01-05 — S2: Thẩm tra Fail-Closed Khởi động GUI Smoke Test
- **Severity:** `S2 — HIGH`
- **Thành phần ảnh hưởng:** `apps/desktop/src/main.js`
- **Quan sát của Leader:**
  - Trong chế độ `--smoke`, script kiểm tra các cờ (`testBlocked`, `!schemeCheck.valid`, `gotTheLock`, `admissionCheck.allowed`) nhưng cần đảm bảo nếu có bất kỳ cờ nào thất bại thì phải trả về kết quả `result: 'FAIL'` và thoát với exit code `1` ngay lập tức, không được phép exit code 0 khi assert hỏng.
- **Giải pháp thực hiện:**
  1. Trong `apps/desktop/src/main.js`:
     ```javascript
     const allChecksPassed = Boolean(
       testBlocked &&
       !schemeCheck.valid &&
       gotTheLock &&
       admissionCheck.allowed
     );
     const evidence = {
       suite: 'UNION_BOT_ELECTRON_GUI_SMOKE',
       timestamp: new Date().toISOString(),
       windowTitle: mainWindow.getTitle(),
       userDataDir: app.getPath('userData'),
       costGuardBlockedPaid: testBlocked,
       safeExternalBlockedDangerous: !schemeCheck.valid,
       singleInstanceLocked: gotTheLock,
       admissionGatePassed: admissionCheck.allowed,
       result: allChecksPassed ? 'PASS' : 'FAIL',
     };
     fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf-8');
     app.exit(allChecksPassed ? 0 : 1);
     ```
- **Bằng chứng kiểm chứng (Regression Proof):**
  - Chạy `pnpm smoke:gui` trên Windows: Tất cả 4 điều kiện an toàn đều `true`, `result: 'PASS'`, tiến trình Electron thoát với exit code `0`.
  - Bằng chứng ghi nhận chuẩn xác tại `reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`.

---

### Issue P1-R01-06 — S2: Khóa Chặt Phạm vi Điều hướng Nội bộ `file://` của Electron
- **Severity:** `S2 — HIGH`
- **Thành phần ảnh hưởng:** `apps/desktop/src/main.js`
- **Quan sát của Leader:**
  - Cơ chế `will-navigate` trước đây chặn điều hướng tới các URL bắt đầu bằng `http` ngoại trừ UI cục bộ, nhưng cần khóa chặt phạm vi `file://`: chỉ duy nhất tệp `index.html` của bản build UI (`apps/workspace-ui/dist/index.html`) được phép tải; mọi URL `file://` hoặc scheme khác dẫn ra ngoài đều bị hủy bỏ và chuyển sang `safeOpenExternal`.
- **Giải pháp thực hiện:**
  1. Trong `apps/desktop/src/main.js`:
     ```javascript
     const allowedUiFileUrl = pathToFileURL(uiDistPath).href;
     mainWindow.webContents.on('will-navigate', (event, url) => {
       if (url !== allowedUiFileUrl) {
         event.preventDefault();
         safeOpenExternal(url, shell);
       }
     });
     ```
- **Bằng chứng kiểm chứng (Regression Proof):**
  - Được kiểm chứng trong suite `apps/desktop/tests/desktop.test.js` và xác thực runtime trong tiến trình Electron.

---

### Issue P1-R01-07 — S2: Tích hợp TypeScript Typecheck (`tsc --noEmit`) vào CI Pipeline
- **Severity:** `S2 — HIGH`
- **Thành phần ảnh hưởng:** `package.json`, `scripts/verify.ps1`, `tsconfig.json`, `tsconfig.base.json`
- **Quan sát của Leader:**
  - Tiến trình build của Vite và Node `--experimental-strip-types` chỉ bóc tách kiểu cú pháp mà không chạy kiểm tra kiểu tĩnh (type checker). Do đó các lỗi sai kiểu (type errors) có thể bị che giấu.
  - Bắt buộc phải tích hợp lệnh kiểm tra kiểu tĩnh không sinh mã (`tsc --noEmit`) vào pipeline xác minh chính thức `scripts/verify.ps1`.
- **Giải pháp thực hiện:**
  1. Cài đặt `typescript` (v5.9.3) và `@types/node` (v26.6.5) tại root monorepo.
  2. Tạo `tsconfig.json` tại root kế thừa từ `tsconfig.base.json` với `"allowImportingTsExtensions": true` và `"noEmit": true`.
  3. Thêm script `"typecheck": "tsc --noEmit && tsc --noEmit -p apps/workspace-ui/tsconfig.json"` vào `package.json`.
  4. Sửa 2 lỗi kiểu tiềm ẩn được phát hiện trong quá trình thiết lập:
     - `apps/workspace-ui/src/types.ts`: Bổ sung `content?: string` vào giao diện `MessagePart`.
     - `packages/cost-guard/tests/cost-guard.test.ts`: Bổ sung typecast an toàn cho callback của `http2.connect`.
  5. Đưa `pnpm typecheck` thành **Bước 1** trong `scripts/verify.ps1`.
- **Bằng chứng kiểm chứng (Regression Proof):**
  - Chạy `pnpm typecheck` độc lập: 0 lỗi.
  - Chạy `scripts/verify.ps1`: Bước 1 `Strict Monorepo Typecheck` thành công 100%.

---

### Issue P1-R01-08 — S3: Minh bạch Trạng thái Mock Demo & Truy vết SHA
- **Severity:** `S3 — MEDIUM`
- **Thành phần ảnh hưởng:** `apps/workspace-ui/src/App.tsx`, `Header.tsx`, `ChatRoom.tsx`
- **Quan sát của Leader:**
  - Giao diện phòng chat ban đầu nạp sẵn các tin nhắn giả lập khiến người dùng có thể nhầm lẫn rằng các AI đã kết nối trực tiếp.
  - Cần khởi tạo phòng chat rỗng khi chạy trong môi trường Electron thật (`window.unionBotAPI`), chỉ tải tin nhắn mẫu khi xem preview web ngoại tuyến và phải dán nhãn `[OFFLINE MOCK PREVIEW]` rõ ràng.
- **Giải pháp thực hiện:**
  1. Trong `apps/workspace-ui/src/App.tsx`:
     - Định nghĩa `EMPTY_ROOMS` rỗng cho tất cả các phòng `#orchestration`, `#agent-dev`, `#qa-audit`, `#review-briefing`.
     - Khởi tạo `messages: isDesktop ? EMPTY_ROOMS : MOCK_ROOMS`. Khi chạy trong Electron, giao diện mở ra hoàn toàn sạch sẽ và sẵn sàng nhận tin nhắn từ Orchestrator.
     - Dán tiền tố `[OFFLINE MOCK PREVIEW]` vào tất cả các đoạn tin nhắn mẫu trong `MOCK_ROOMS`.
  2. Trong `apps/workspace-ui/src/components/Header.tsx`:
     - Hiển thị badge: `ELECTRON LIVE IPC (ZERO-COST ACTIVE)` khi ở Desktop mode, và `STANDALONE PREVIEW (OFFLINE SEED)` khi ở Web browser preview.
  3. Trong `apps/workspace-ui/src/components/ChatRoom.tsx`:
     - Thay đổi badge từ `DEMO` sang `MOCK PREVIEW`.
     - Bổ sung màn hình rỗng trực quan (`Empty State`) khi phòng chưa có tin nhắn: *"Phòng chưa có tin nhắn. Nhập tin nhắn bên dưới để điều phối qua Orchestrator IPC."*
- **Bằng chứng kiểm chứng (Regression Proof):**
  - Bản build UI tĩnh tạo mới (`apps/workspace-ui/dist/`) đã đóng gói các thành phần trên, kiểm tra trực quan trong Electron GUI Smoke.

---

## 3. Tổng hợp Kết quả Kiểm thử Toàn bộ Hệ thống (Phase P1 Round R02)

| Hạng mục Kiểm thử | Công cụ / Lệnh | Số lượng | Kết quả | Ghi chú |
|---|---|---|---|---|
| **Kiểm tra Kiểu tĩnh (Static Typecheck)** | `pnpm typecheck` (`tsc --noEmit`) | Toàn monorepo + UI | **PASS (0 errors)** | Đã tích hợp fail-closed vào `verify.ps1` |
| **Đóng gói Giao diện (Vite Build)** | `pnpm build:ui` | 34 modules | **PASS (627ms)** | Bundle chuẩn offline `dist/index.html` |
| **Kiểm thử Đơn vị TypeScript & Node** | `pnpm test:ts` | **56 tests** (6 suites) | **56/56 PASS (100%)** | Tăng thêm 5 tests so với R01 (+3 desktop, +1 protocol, +1 orchestrator) |
| **Kiểm thử Đơn vị Python** | `pnpm test:py` | **15 tests** (2 suites) | **15/15 PASS (100%)** | Tăng thêm 1 test so với R01 (+1 digest verification) |
| **Kiểm thử Giao diện Thực (Electron Smoke)** | `pnpm smoke:gui` | 1 session Windows | **PASS (exit code 0)** | Title, CostGuard, SafeExternal, Lock, Admission Gate |
| **Rà soát Bí mật Toàn diện (Strict Scanner)**| `pnpm secret-scan` | 734 files | **PASS (0 leaks, 0 errors)** | 8 fixtures triaged an toàn theo SHA256 digest match |
| **TỔNG SỐ BÀI KIỂM THỬ TỰ ĐỘNG** | `scripts/verify.ps1` | **71 bài test** | **71/71 PASS (100%)** | **Tăng từ 65 lên 71 bài test** |

---

## 4. Kết luận & Cam kết Chuyển pha

Toàn bộ 8/8 yêu cầu thẩm tra từ Technical Leader đã được hoàn thành 100%, không phát sinh nợ kỹ thuật tồn đọng, mã nguồn được bảo vệ fail-closed từ cấp schema giao thức đến runtime IPC và scanner. 

Hồ sơ bàn giao chi tiết được đính kèm tại `reports/handoff/REVIEW_PACKET_P1_R02.md` để Technical Leader chính thức phê duyệt **`GO_P2`**.
