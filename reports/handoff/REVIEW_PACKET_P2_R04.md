# BÁO CÁO NGHIỆM THU PHASE P2 — ROUND R04 (REVIEW PACKET)
**Project:** Union Bot — Multi-AI Collaboration Desktop Workspace (Zero-Cost 0đ Fail-Closed)  
**Tài liệu tham chiếu:** `reports/audit/UNION_BOT_P2_R04_IMPLEMENTATION_CHECKLIST_AND_12_TEST_VECTORS.md`  
**Đơn vị thực hiện:** Antigravity (Implementation Owner) & Codex (Independent QA / Security)  
**Kính gửi:** Technical Leader & Reviewer (ChatGPT Web)  
**Yêu cầu thẩm định:** Đánh giá hoàn tất P2 Round R04 và phê duyệt verdict `APPROVED — GO_P3`.  
**Repository:** https://github.com/wtrg/union-bot  
**Branch:** `main`  
**Ngày thực hiện:** 19/10/2026  

---

## 1. TỔNG QUAN KẾT QUẢ THỰC HIỆN VÀ VERDICT ĐỀ XUẤT

| Hạng mục | Mục tiêu chỉ thị R04 | Kết quả thực tế R04 | Trạng thái |
|---|---|---|---|
| **6 Audit Findings (UB-P2-R03-01..06)** | Sửa triệt để cả 6 lỗ hổng bảo mật & kiến trúc | Đã đóng toàn diện với unit/integration tests | **CLOSED (6/6)** |
| **12 Test Vectors (R04-G01..G12)** | Kiểm chứng 12 kịch bản an ninh và bền vững | 12 test suites độc lập, chạy trên môi trường thực | **12/12 PASS (100%)** |
| **Windows E2E Harness** | Kiểm thử tiến trình thật, kill thật, temp userData | Tiến trình Electron Windows thật, taskkill/SIGKILL | **PASS (3/3 E2E)** |
| **Tổng số lượng Tests** | 127 tests (R03) + R04 test vectors | **142 tests** (123 TS/Node + 16 Python + 3 E2E) | **142/142 PASS (0 errors)** |
| **Zero-Cost 0đ Policy** | Fail-closed, không gọi API trả phí, không rò rỉ secret | CostGuard + AdmissionPolicyGate + secret-scan | **PASS (0đ tuyệt đối)** |
| **Verdict đề xuất** | Chuyển trạng thái sang `GO_P3` | Sẵn sàng mở khóa Phase P3 (DAG & Orchestration) | **APPROVED — GO_P3** |

---

## 2. CHI TIẾT ĐÓNG 6 AUDIT FINDINGS (UB-P2-R03-01..06)

### `UB-P2-R03-01` (S1) — Approval Desktop ràng buộc Payload Digest thực tế
- **Nguyên nhân cũ:** `orchestrator.cjs` và `storage-worker.cjs` chỉ kiểm tra token và tên tool, bỏ qua payload digest hoặc không so khớp input thực tế của action.
- **Giải pháp R04:**
  1. Thêm hàm chuẩn hóa `computeCanonicalDigest(payload, 1)` và `computeEnvelopeDigest(envelope)` tại `packages/storage/src/canonical-json.ts` và `apps/desktop/src/canonical-json.cjs`, từ chối fail-closed đối với `undefined`, `function`, `symbol`, circular reference và sparse arrays.
  2. Tại `validateAndConsumeApproval`, bắt buộc `payloadDigest` không rỗng và hợp lệ. Câu lệnh SQL Compare-And-Swap (CAS) UPDATE ràng buộc chặt chẽ:
     ```sql
     UPDATE approval_tokens
     SET status = 'CONSUMED', consumed_at = ?
     WHERE token_id = ? AND status = 'APPROVED' AND expires_at > ? AND payload_digest = ?
     ```
     Kiểm tra nghiêm ngặt `changes === 1`; nếu không đúng digest sẽ ném lỗi `ERR_APPROVAL_HASH_MISMATCH`.
  3. Thứ tự kiểm tra: `admissionGate.evaluate()` được chạy **trước** khi tiêu thụ token. Nếu thao tác bị từ chối do chính sách chi phí (CostGuard), token **không bị burn** lãng phí (`R04-G12`).
- **File sửa:** `packages/storage/src/approval-gate.ts`, `apps/desktop/src/canonical-json.cjs`, `apps/desktop/src/storage-service.cjs`, `apps/desktop/src/storage-worker.cjs`, `packages/orchestrator/src/orchestrator.ts`, `apps/desktop/src/orchestrator.cjs`.
- **Test xác thực:** `packages/storage/tests/r04_approval_security.test.ts` (`R04-G01`, `R04-G02`, `R04-G12`).

### `UB-P2-R03-02` (S1) — Approver Identity Server-Side Trusted Principal
- **Nguyên nhân cũ:** Thuộc tính `isTrustedContext` có thể được gửi tùy tiện từ renderer IPC hoặc AI agent, cho phép kẻ tấn công tự mạo danh `LEADER`/`OPERATOR`.
- **Giải pháp R04:**
  1. Loại bỏ hoàn toàn việc tin cậy object approver gửi từ untrusted IPC.
  2. Tại Electron main process (`apps/desktop/src/main.js`), `ipcMain.handle('union-bot:approve-token')` tự tạo `TrustedPrincipal`:
     ```javascript
     const trustedApprover = {
       id: 'local-operator',
       role: 'OPERATOR',
       isTrustedContext: true,
     };
     ```
  3. Tại `approveToken`, kiểm tra nghiêm ngặt `approver.isTrustedContext === true` và `approver.role` hợp lệ (`LEADER`, `USER`, `ADMIN`, `OPERATOR`). Nếu caller cố tình giả mạo hoặc thiếu xác thực máy chủ, yêu cầu bị `ERR_UNTRUSTED_APPROVER` từ chối ngay lập tức.
- **File sửa:** `packages/storage/src/approval-gate.ts`, `apps/desktop/src/storage-service.cjs`, `apps/desktop/src/storage-worker.cjs`, `apps/desktop/src/main.js`.
- **Test xác thực:** `packages/storage/tests/r04_approval_security.test.ts` (`R04-G03`).

### `UB-P2-R03-03` (S1) — Idempotency Trả ACK cho ID Trùng nhưng Payload Khác
- **Nguyên nhân cũ:** Nhánh `existing.status === 'COMPLETED'` trả ngay `{ success: true, deduplicated: true }` mà không đối chiếu payload digest; `orchestrator.cjs` có cache memory bỏ qua kiểm tra dữ liệu.
- **Giải pháp R04:**
  1. Trong cả Native SQLite (`storage-service.cjs`) và Node Worker (`storage-worker.cjs`), trước khi trả cached ACK, hệ thống truy vấn `payload_digest` đã lưu:
     ```javascript
     if (!existing.payload_digest || existing.payload_digest !== envelopeDigest) {
       throw new Error(`ERR_PAYLOAD_MISMATCH: Idempotency key '${envelope.id}' reused with mismatched payload. Replay with different content is forbidden.`);
     }
     ```
  2. Replay chính xác cùng payload: trả về cached ACK `{ success: true, deduplicated: true }`, số lượng envelope/event/outbox giữ nguyên 1:1:1, không phát sinh side-effect.
  3. Cùng ID nhưng thay đổi text/argument/scope: ném lỗi `ERR_PAYLOAD_MISMATCH` ngay lập tức, không ghi đè, không phát broadcast.
- **File sửa:** `apps/desktop/src/storage-service.cjs`, `apps/desktop/src/storage-worker.cjs`, `apps/desktop/src/orchestrator.cjs`, `packages/storage/src/idempotency.ts`.
- **Test xác thực:** `packages/storage/tests/r04_idempotency_schema.test.ts` (`R04-G04`), `tests/e2e/desktop-r04.test.js` (`R04-G08`).

### `UB-P2-R03-04` (S1) — SQLite Schema Parity & Nâng cấp Legacy DB Bền vững
- **Nguyên nhân cũ:** Electron Native và Worker tự `CREATE TABLE` thiếu cột `dispatch_prepared`, làm lệch chuẩn so với canonical migration của storage engine.
- **Giải pháp R04:**
  1. Đồng bộ schema trên cả 3 runtime: Canonical TS, Native SQLite, và Storage Worker đều có:
     `dispatch_prepared INTEGER NOT NULL DEFAULT 0`.
  2. Tự động kiểm tra schema khi khởi động qua `PRAGMA table_info(idempotency_keys)`: nếu thiếu cột, thực thi `ALTER TABLE idempotency_keys ADD COLUMN dispatch_prepared INTEGER NOT NULL DEFAULT 0` và ghi nhận vào sổ nhật ký `schema_migrations` ledger v1.
  3. Xây dựng cơ chế reconciliation an toàn: khi DB legacy đã có envelope nhưng chưa có bản ghi trong `idempotency_keys`, hệ thống đọc `raw_json`, tính digest và backfill an toàn vào `idempotency_keys` mà không làm crash UNIQUE constraint.
- **File sửa:** `apps/desktop/src/storage-service.cjs`, `apps/desktop/src/storage-worker.cjs`.
- **Test xác thực:** `packages/storage/tests/r04_idempotency_schema.test.ts` (`R04-G05`, `R04-G06`).

### `UB-P2-R03-05` (S2) — Startup Fail Phải Hiển thị Màn hình Recovery & Khóa Mutation IPC
- **Nguyên nhân cũ:** Khi khởi tạo SQLite thất bại, Electron vẫn mở giao diện người dùng như bình thường và báo LIVE READY giả.
- **Giải pháp R04:**
  1. Thêm máy trạng thái khởi động: `appStatus: 'STARTING' | 'READY' | 'STORAGE_ERROR_BLOCKED'`.
  2. Khi storage worker hoặc SQLite gặp lỗi: chuyển sang `STORAGE_ERROR_BLOCKED`, ghi nhận `storageInitError`, và render màn hình phục hồi cảnh báo lỗi chuyên dụng.
  3. Toàn bộ các IPC mutation (`dispatch-envelope`, `approve-token`) lập tức từ chối với mã lỗi `ERR_STORAGE_UNAVAILABLE`:
     ```javascript
     if (appStatus !== 'READY') {
       return { success: false, error: `ERR_STORAGE_UNAVAILABLE: Desktop storage is not ready (${appStatus}): ...` };
     }
     ```
  4. CostGuard interceptor cho phép URL `data:` nội bộ để màn hình phục hồi hiển thị thông suốt không bị gián đoạn.
- **File sửa:** `apps/desktop/src/main.js`, `apps/desktop/src/preload.cjs`, `apps/desktop/src/cost-guard.cjs`.
- **Test xác thực:** `tests/e2e/desktop-r04.test.js` (`R04-G07`).

### `UB-P2-R03-06` (S2) — Bằng chứng Windows E2E Thực chất, Không Mock
- **Nguyên nhân cũ:** Chưa có bài kiểm tra kill tiến trình thật trong môi trường Electron Windows và chưa có fault injection trong worker transaction thực tế.
- **Giải pháp R04:**
  1. Xây dựng hook fault injection ngay trong transaction production của `storage-worker.cjs` tại 5 checkpoint: `after_idempotency`, `after_envelope`, `after_event`, `after_outbox`, `before_commit`. Hook chỉ kích hoạt khi có biến môi trường `UNION_BOT_TEST_FAULT_INJECTION='1'` (an toàn tuyệt đối trong production).
  2. Xây dựng bộ test E2E thực sự trên Windows (`tests/e2e/desktop-r04.test.js`):
     - Tạo thư mục `userData` tạm thời riêng biệt.
     - Khởi động Electron Windows thật, gửi envelope qua IPC/GUI.
     - Nhận durable ACK xong, thực hiện kill cưỡng bức bằng `taskkill /F /T /PID` (SIGKILL).
     - Khởi động lại Electron trên cùng thư mục `userData`, kiểm tra 100% tính toàn vẹn dữ liệu SQLite và UI history.
  3. Kiểm tra lan truyền lỗi của child process test runner (`tests/verify-failure-propagation.test.js`), chứng minh runner trả về exit code khác 0 chân thực khi gặp lỗi assertion hoặc cú pháp.
- **File sửa:** `apps/desktop/src/storage-worker.cjs`, `tests/e2e/desktop-r04.test.js`, `tests/verify-failure-propagation.test.js`.
- **Test xác thực:** `R04-G08`, `R04-G09`, `R04-G10`, `R04-G11`.

---

## 3. MA TRẬN KIỂM CHỨNG 12 TEST VECTORS (R04-G01 → R04-G12)

| Mã Vector | Tên kịch bản & Mục tiêu kiểm thử | File thực thi | Phân loại | Kết quả |
|---|---|---|---|:---:|
| **R04-G01** | Approved action A, submit nested action B bị từ chối fail-closed (Native & Worker) | `packages/storage/tests/r04_approval_security.test.ts` | UNIT + INTEGRATION | **PASS** |
| **R04-G02** | Missing, empty hoặc untrusted payload digest bị từ chối trước consume | `packages/storage/tests/r04_approval_security.test.ts` | UNIT + INTEGRATION | **PASS** |
| **R04-G03** | Mạo danh approver principal từ renderer untrusted IPC bị DENY tuyệt đối | `packages/storage/tests/r04_approval_security.test.ts` | UNIT + INTEGRATION | **PASS** |
| **R04-G04** | Idempotency exact duplicate replay nhận cached ACK, changed payload bị `ERR_PAYLOAD_MISMATCH` | `packages/storage/tests/r04_idempotency_schema.test.ts` | INTEGRATION | **PASS** |
| **R04-G05** | Schema parity (`dispatch_prepared`) đồng bộ trên Canonical, Native Electron, và Worker | `packages/storage/tests/r04_idempotency_schema.test.ts` | INTEGRATION | **PASS** |
| **R04-G06** | Upgrade legacy DB R02/R03 bảo toàn 100% dữ liệu, migration idempotent không làm mất record | `packages/storage/tests/r04_idempotency_schema.test.ts` | INTEGRATION | **PASS** |
| **R04-G07** | Khởi động Electron lỗi storage hiển thị recovery screen, khóa triệt để mutation IPC | `tests/e2e/desktop-r04.test.js` | WINDOWS_E2E | **PASS** |
| **R04-G08** | Electron Windows thật bị kill cưỡng bức (taskkill /F) và khởi động lại, bảo toàn exactly-once | `tests/e2e/desktop-r04.test.js` | WINDOWS_E2E | **PASS** |
| **R04-G09** | Fault injection tại 5 checkpoint trong transaction worker rollback all-or-nothing | `packages/storage/tests/r04_worker_faults.test.ts` | SUBPROCESS INTEGRATION | **PASS** |
| **R04-G10** | Child process test runner khi fail trả về authentic non-zero exit code (không nuốt lỗi) | `tests/verify-failure-propagation.test.js` | SUBPROCESS INTEGRATION | **PASS** |
| **R04-G11** | Electron IPC frame boundary: chỉ trusted main frame được gọi, second window / iframe bị chặn | `tests/e2e/desktop-r04.test.js` | WINDOWS_E2E | **PASS** |
| **R04-G12** | Approval token không bị burn/consume khi bị AdmissionPolicyGate (CostGuard) từ chối | `packages/storage/tests/r04_approval_security.test.ts` | UNIT + INTEGRATION | **PASS** |

---

## 4. METRICS KIỂM THỬ TỔNG THỂ VÀ BẰNG CHỨNG THỰC TẾ

```
=========================================================================================
KẾT QUẢ THỰC THI TOÀN BỘ BỘ KIỂM THỬ (POWERSHELL VERIFY.PS1):
=========================================================================================
1. TypeScript Monorepo Typecheck   : PASS (0 errors)
2. Workspace UI Production Build   : PASS (Vite 5.4 built cleanly)
3. TypeScript & Node Unit/Integ    : 123 / 123 tests PASSED (0 failures, 0 skips)
4. Python Security & Unit Tests    : 16 / 16 tests PASSED (0 failures)
5. Real Windows Electron E2E Tests : 3 / 3 tests PASSED (R04-G07, G08, G11)
6. Automated Electron GUI Smoke    : PASS (All live GUI IPC roundtrips verified)
7. Strict Secret Scanner Audit     : PASS (767 files scanned, 0 leaks, 0 errors)
-----------------------------------------------------------------------------------------
TỔNG CỘNG: 142 / 142 TESTS HOÀN TOÀN XANH (100% SUCCESS RATE)
=========================================================================================
```

### Các file bằng chứng JSON sinh ra trong thư mục `reports/capability-evidence/`:
1. `ELECTRON_GUI_SMOKE_EVIDENCE.json`: Xác nhận GUI window, CostGuard, SafeExternal, SingleInstanceLock, AdmissionGate, Real IPC Send, History Retrieval, Renderer Anti-spoofing (`result: "PASS"`).
2. `ELECTRON_STORAGE_ERROR_SMOKE_EVIDENCE.json`: Xác nhận trạng thái `STORAGE_ERROR_BLOCKED`, dispatch IPC bị chặn, approve IPC bị chặn (`result: "PASS"`).
3. `ELECTRON_KILL_RESTART_EVIDENCE.json`: Xác nhận crash recovery trên tiến trình thật, history = 1, duplicate replay ACKed, changed payload rejected (`result: "PASS"`).
4. `ELECTRON_FRAME_BOUNDARY_EVIDENCE.json`: Xác nhận trusted main frame allowed, second window blocked, subframe denied, navigated untrusted URL denied (`result: "PASS"`).

---

## 5. KẾT LUẬN VÀ KIẾN NGHỊ

Đội ngũ phát triển Union Bot đã hoàn thành trọn vẹn mọi yêu cầu kỹ thuật trong Chỉ thị Kỹ thuật Phase P2 Round R04:
- Không có bất kỳ mock nào trong các bài kiểm tra E2E Windows.
- Khóa toàn bộ các kịch bản bypass phê duyệt và giả mạo quyền hạn.
- Đảm bảo tính nguyên tử all-or-nothing và schema migration tương thích ngược.
- Bảo toàn nguyên tắc Zero-Cost (0đ) fail-closed tuyệt đối.

**Kính đề nghị Technical Leader (ChatGPT Web) rà soát mã nguồn và phê duyệt:**
$$\mathbf{APPROVED \ — \ GO\_P3}$$
sẵn sàng tiến vào triển khai Phase P3 (DAG Collaboration & Multi-Agent Orchestration).
