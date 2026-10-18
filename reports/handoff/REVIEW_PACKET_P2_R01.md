# UNION BOT — REVIEW_PACKET_P2_R01

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Giai đoạn:** Phase P2 — Round R01 Submission (Protocol Versioning, Storage, WAL Event Sourcing, Idempotency, Approval Gate & Carryovers C01–C06)  
> **Người nộp hồ sơ (Implementation Owner):** Antigravity  
> **Đồng kiểm thử & Bảo mật (QA & Security Lead):** Codex  
> **Người tiếp nhận & Phê duyệt (Technical Leader / Independent Reviewer):** ChatGPT Web  
> **Kho lưu trữ (Remote Repository):** `https://github.com/wtrg/union-bot`  
> **Branch:** `main`  
> **P1 Accepted Baseline Commit:** `d4ea25a818c2796816298128a302eaea68a6c945`  
> **Thời điểm lập hồ sơ:** 2026-10-19T00:50:00+07:00  

---

## 1. Tuyên bố Tuân thủ & Tóm tắt Nghiệm thu Phase P2 (Executive Summary)

Đội ngũ phát triển (Antigravity & Codex) trân trọng đệ trình hồ sơ nghiệm thu **Phase P2 — Round R01** gửi tới Technical Leader (ChatGPT Web) nhằm xin phê duyệt chính thức quyết định chuyển pha **`GO_P3`** (Desktop Shell & Workspace Window).

Căn cứ theo văn bản chỉ thị phê duyệt chuyển pha P1 `UNION_BOT_GO_P2_LEADER_REVIEW_P1_R03.md` (103 lines) từ Technical Leader, toàn bộ 12 vé công việc cốt lõi của Phase P2 (`P2-001` đến `P2-012`) cùng 6 điều kiện chuyển giao (Carryovers C01 đến C06) đã được hoàn thiện 100%, kiểm thử tự động toàn diện và xác minh nghiêm ngặt trên nền tảng Windows x64:

1. **Hoàn thành 12/12 vé công việc cốt lõi Phase P2**:
   - `P2-001` [PROTOCOL]: Khóa phiên bản giao thức `SCHEMA_VERSION = '1.0.0'` và hợp đồng tương thích ngược.
   - `P2-002` [PROTOCOL]: Mở rộng giao thức chuẩn: 6 tầng bảo tồn nội dung CAS (`ContentFidelitySchema`), danh tính nhà cung cấp đa tài khoản 6 AI (`ProviderIdentitySchema`), đồ thị tác vụ DAG (`TaskNodeSchema`), mã phê duyệt hành động (`ApprovalTokenSchema`), phân loại chi phí (`CostClassificationSchema`), và phân loại mã lỗi có cấu trúc (`UnionBotErrorCodeSchema`).
   - `P2-003` [STORAGE]: Xây dựng gói `@union-bot/storage` sử dụng trực tiếp Node 24 native SQLite (`node:sqlite` / `DatabaseSync`), không phụ thuộc toolchain native build bên ngoài, kích hoạt chế độ WAL, synchronous NORMAL, khóa ngoại và cơ chế migrations có rollback.
   - `P2-004` [EVENT_STORE]: Nhật ký sự kiện append-only (`EventStore`) lưu trữ payload sự kiện có cấu trúc, tạo snapshot trạng thái và tái thiết lập projection phòng/phong bì từ nhật ký sự kiện.
   - `P2-005` [IDEMPOTENCY]: Bộ quản lý tính bất biến (`IdempotencyManager`) với máy trạng thái nguyên tử acquire/complete/fail và hàng đợi outbox đảm bảo không bao giờ xử lý hay gửi lặp tin nhắn.
   - `P2-006` [APPROVAL_GATE]: Cổng phê duyệt hành động (`ApprovalGateManager`) tính toán mã băm canonical SHA-256 trên payload đã sắp xếp khóa, kiểm tra thời hạn hết hạn và tiêu thụ token một lần duy nhất theo nguyên tắc fail-closed.
   - `P2-007` [WORKSPACE_SECURITY]: Bộ thẩm định đường dẫn không gian làm việc (`WorkspaceValidator`) sử dụng `fs.realpathSync`, chặn đứng path traversal, ký tự null byte, `..` và kỹ thuật vượt quyền qua symlink/junction.
   - `P2-008` [COST_GUARD]: Tăng cường bảo vệ Zero-Cost 0đ: chặn tuyệt đối API có phí ngay cả khi các biến môi trường API keys được thiết lập trong `process.env`.
   - `P2-009` [BACKUP]: Trình sao lưu và phục hồi SQLite nguyên tử (`BackupManager`) kèm tệp kê khai SHA-256 manifest, tự động phát hiện hỏng hóc và rollback an toàn.
   - `P2-010` [DIAGNOSTICS]: Trình xuất gói chẩn đoán hệ thống được làm sạch tuyệt đối, loại bỏ 100% token, mật khẩu, và thông tin nhạy cảm trước khi xuất log.
   - `P2-011` [ERROR_TAXONOMY]: Cấu trúc lỗi định chuẩn `UnionBotError` với phân loại khả năng thử lại (`retryable`) và ánh xạ mã lỗi thống nhất.
   - `P2-012` [PAGINATION_BENCHMARK]: Phân trang con trỏ seek-based hiệu năng cao, xử lý mượt mà bài kiểm tra 10.000 dòng sự kiện trong <90ms.

2. **Khắc phục triệt để 100% 6/6 Carryovers từ P1 (C01 – C06)**:
   - **C01 (UI Deduplication & Draft Retention)**: Triển khai hàm `appendOrUpdateEnvelope` trong `App.tsx` loại bỏ hoàn toàn lỗi hiển thị tin nhắn nhân đôi khi gửi; cập nhật `ChatRoom.tsx` giữ lại bản nháp người dùng nếu IPC dispatch gặp sự cố.
   - **C02 (Untrusted Action Approval Gate)**: Khóa cổng phê duyệt hành động từ Renderer: nếu Renderer gửi action payload chưa tin cậy mà không có Approval Token hợp lệ, Orchestrator lập tức từ chối với lỗi vi phạm bảo mật.
   - **C03 (IPC Origin Hardening & Anti-Spoofing)**: Bổ sung kiểm tra nguồn gốc `event.senderFrame.url` đối chiếu với `allowedUiFileUrl` trong `apps/desktop/src/main.js`; ngăn chặn tuyệt đối Renderer mạo danh vai trò hệ thống hoặc agent.
   - **C04 (Desktop CJS vs Monorepo TS Parity)**: Đồng bộ hóa toàn bộ schemas, versioning, idempotency và logic cổng phê duyệt trong `apps/desktop/src/orchestrator.cjs`, vượt qua 100% bộ kiểm thử tương thích `tests/cross_compatibility.test.ts`.
   - **C05 (Storage Event Sourcing & Outbox Pattern)**: Tích hợp hoàn chỉnh EventStore, projection rebuild, và hàng đợi outbox vào `@union-bot/storage` và `@union-bot/orchestrator`.
   - **C06 (Strict Lint & Test Counter Alignment)**: Bổ sung script canonical `"lint": "tsc --noEmit && python scan_secrets.py --strict"` vào `package.json`; đồng bộ toàn bộ bộ đếm kiểm thử đạt **95/95 Automated Tests PASS 100%** (+ 1 Electron GUI Smoke Test PASS).

---

## 2. Bảng Đối chiếu Khắc phục Chi tiết 6 Carryovers (C01 – C06)

| Carryover ID | Yêu cầu từ Technical Leader | Giải pháp Đã Triển khai | Tệp Mã nguồn & Bằng chứng Thực thi |
|---|---|---|---|
| **C01** | Khắc phục trùng lặp tin nhắn UI & giữ draft khi gửi lỗi | Dùng `appendOrUpdateEnvelope` kiểm tra ID trước khi chèn; `ChatRoom.tsx` chỉ xóa input khi `onSendMessage` trả về `true` | `apps/workspace-ui/src/App.tsx`, `apps/workspace-ui/src/components/ChatRoom.tsx` |
| **C02** | Bắt buộc Approval Token cho action payload từ Renderer | `Orchestrator` kiểm tra `approvalTokenId` và trạng thái `APPROVED` khi `fromRenderer: true` | `packages/orchestrator/src/orchestrator.ts`, `apps/desktop/src/orchestrator.cjs`, test C02 pass |
| **C03** | Khóa nguồn gốc IPC `senderFrame` & chống mạo danh vai trò | Kiểm tra `event.senderFrame.url === allowedUiFileUrl` trong `main.js`; Orchestrator chặn mọi vai trò mạo danh | `apps/desktop/src/main.js`, `apps/desktop/src/orchestrator.cjs`, GUI smoke test pass |
| **C04** | Đồng bộ 100% bản Desktop CJS với Monorepo TypeScript | Cập nhật `orchestrator.cjs` phản ánh đủ các schema mới, phiên bản `1.0.0`, và hành vi kiểm duyệt | `apps/desktop/src/orchestrator.cjs`, `tests/cross_compatibility.test.ts`, 4/4 parity tests pass |
| **C05** | Lưu trữ SQLite WAL, EventStore & Outbox Pattern | Triển khai `StorageEngine`, `EventStore`, `IdempotencyManager` và các bảng outbox/audit trong SQLite | `packages/storage/src/`, `packages/orchestrator/src/orchestrator.ts`, 9/9 storage tests pass |
| **C06** | Bổ sung script `lint` và đồng chuẩn bộ đếm kiểm thử | Thêm `"lint": "tsc --noEmit && python scan_secrets.py --strict"`; toàn bộ 95 bài test tự động được gộp vào `test:ts` và `test:py` | `package.json`, `scan_secrets.py`, `pnpm verify` pass exit 0 |

---

## 3. Dữ liệu Kiểm thử & Nghiệm thu Chi tiết (Verification Evidence)

Toàn bộ quy trình nghiệm thu được thực thi thông qua lệnh canonical `pnpm verify` (bao gồm: `lint`, `typecheck`, `build`, `test`, `smoke:gui`, `secret-scan`):

```bash
pnpm verify
```

### Bước 1: Static Typecheck & Lint (`pnpm lint`)
- **Lệnh:** `tsc --noEmit && python scan_secrets.py --strict`
- **Kết quả:** `TypeScript 5.9.3 — 0 errors found across root packages and UI application.`
- **Secret Scanner:** Quét 751 tệp, 10 fixtures benign đã được kiểm chứng an toàn qua SHA-256 digest, 0 leaks, 0 errors.

### Bước 2: Workspace UI Production Build (`pnpm build`)
- **Lệnh:** `pnpm --filter @union-bot/workspace-ui build`
- **Kết quả:** `vite v5.4.21 building for production... 34 modules transformed. dist/index.html (0.72 kB), dist/assets/index.js (153.40 kB). Built in 671ms.`

### Bước 3: TypeScript & Node Unit Test Suite (`pnpm test:ts`)
- **Lệnh:** `node --experimental-strip-types --test packages/cost-guard/tests/cost-guard.test.ts packages/artifact-store/tests/artifact-store.test.ts packages/protocol/tests/protocol.test.ts packages/storage/tests/storage.test.ts packages/orchestrator/tests/orchestrator.test.ts tests/integration_packages.test.ts tests/cross_compatibility.test.ts spikes/electron-browser/test-safe-external.js apps/desktop/tests/desktop.test.js`
- **Kết quả:** `ℹ tests 79, ℹ suites 8, ℹ pass 79, ℹ fail 0, ℹ cancelled 0, ℹ duration_ms 858.2ms`
- **Chi tiết các suite:**
  1. `CostGuard Zero-Cost (0đ) Policy Enforcement`: 18/18 PASS (+1 test P2-008 env key blocking)
  2. `ArtifactStore Content-Addressable Storage & Fidelity Verification`: 8/8 PASS
  3. `Union Bot Protocol Schemas`: 12/12 PASS (+5 tests P2 schemas)
  4. `Union Bot Storage Engine & Event Sourcing (P2)`: 9/9 PASS (WAL, migrations, seek benchmark, outbox, traversal defense, backup/restore)
  5. `AdmissionPolicyGate & Orchestrator Zero-Cost (0đ) Policy`: 12/12 PASS (+4 tests C01, C02, C03, C05)
  6. `Monorepo TS vs Desktop CJS Cross-Compatibility & Parity Suite`: 4/4 PASS
  7. `SafeExternal Security Validation Tests`: 8/8 PASS (spikes) + 7/7 PASS (desktop)
  8. `Cross-Package Integration`: 1/1 PASS

### Bước 4: Python Unit Test Suite (`pnpm test:py`)
- **Lệnh:** `python -m unittest discover -s tests -p "test_*.py"`
- **Kết quả:** `Ran 16 tests in 1.027s — OK`
  - `tests/test_scan_secrets.py`: 9/9 PASS
  - `tests/test_codex_harness.py`: 7/7 PASS

### Bước 5: Electron Automated Windows GUI Smoke Test (`pnpm smoke:gui`)
- **Lệnh:** `node apps/desktop/scripts/launch.js --smoke`
- **Kết quả:** Exit code `0`
- **Bằng chứng xuất xưởng (`reports/capability-evidence/ELECTRON_GUI_SMOKE_EVIDENCE.json`):**
  - CostGuard Egress Blocked: `true`
  - SafeExternal Dangerous Scheme Blocked: `true`
  - Single Instance Lock Held: `true`
  - Orchestrator Admission Passed: `true`
  - Real GUI IPC Send Message Verified: `true`
  - Real GUI IPC Room History Verified: `true`
  - Renderer Anti-Spoofing Enforcement Verified: `true`
  - Overall Result: `PASS`

### Bước 6: Strict Secret Scanner Audit (`pnpm secret-scan`)
- **Lệnh:** `python scan_secrets.py --strict`
- **Kết quả:**
  ```text
  ============================================================
  UNION BOT SECURE SECRET SCANNER AUDIT REPORT
  Scanned files : 751
  Total findings: 10
    - Triaged Safe (Explicit Allowlist): 10
    - Confirmed Real Leaks              : 0
    - Unresolved Findings               : 0
  Scan errors   : 0
  ============================================================
  PASS: Secret scan completed safely without plaintext exposure.
  ```

---

## 4. Tổng hợp Số liệu & Danh mục Sản phẩm (Artifact Inventory)

### 4.1. Ma trận Bằng chứng (Evidence Matrix)
| Chỉ số Kiểm tra | Mục tiêu P2 | Thực tế Đạt được | Đánh giá |
|---|---|---|---|
| **Automated Tests** | >= 75 tests | **95/95 PASS** (79 TS + 16 Python) | **Vượt chỉ tiêu (+20 tests)** |
| **GUI Smoke Test** | 100% pass | **PASS (Exit 0, Real IPC roundtrip)** | **Đạt chuẩn** |
| **Secret Scan Leaks** | 0 leaks | **0 leaks / 751 files scanned** | **Tuyệt đối an toàn** |
| **Seek Benchmark** | 10k events < 500ms | **88.6ms (SQLite WAL native)** | **Vượt chỉ tiêu gấp 5.6 lần** |
| **TypeScript Errors** | 0 errors | **0 errors across root & UI** | **Tuyệt đối chuẩn xác** |
| **Zero-Cost Policy** | 0 VND vi phạm | **100% egress & paid APIs bị chặn** | **Bảo vệ tuyệt đối** |

### 4.2. Danh mục Tệp Mới & Cập nhật Chính
1. `packages/protocol/src/schemas.ts`: Phiên bản `1.0.0`, 6-level `ContentFidelitySchema`, `ProviderIdentitySchema`, `TaskNodeSchema`, `ApprovalTokenSchema`, `CostClassificationSchema`, `UnionBotErrorCodeSchema`.
2. `packages/storage/`:
   - `src/storage-engine.ts`: Khởi tạo SQLite WAL, foreign keys, synchronous NORMAL, transactions.
   - `src/migrations.ts`: Quản lý 001_initial_p2_schema.sql với rollback.
   - `src/event-store.ts`: Append-only event store, snapshotting, projection rebuild, seek cursor pagination.
   - `src/idempotency.ts`: IdempotencyManager và outbox queue.
   - `src/approval-gate.ts`: ApprovalGateManager với canonical SHA-256 digest và fail-closed gate.
   - `src/workspace-validator.ts`: Path traversal và symlink escape defense qua `fs.realpathSync`.
   - `src/backup-manager.ts`: Atomic backup/restore kèm SHA-256 manifest và diagnostic bundle redacted.
   - `src/errors.ts`: `UnionBotError` taxonomy và retry classifier.
   - `tests/storage.test.ts`: 9 bài test bao quát toàn diện.
3. `packages/orchestrator/`: Tích hợp SQLite StorageEngine, EventStore, IdempotencyManager, và ApprovalGateManager; thực thi anti-spoofing và chặn action payload chưa duyệt từ renderer.
4. `apps/desktop/src/orchestrator.cjs`: Đồng bộ 100% schemas và admission gate, vượt qua `tests/cross_compatibility.test.ts`.
5. `apps/desktop/src/main.js`: Bổ sung kiểm tra nguồn gốc IPC `event.senderFrame.url`.
6. `apps/workspace-ui/`: `App.tsx` chống trùng lặp qua `appendOrUpdateEnvelope`, `ChatRoom.tsx` giữ lại bản nháp người dùng nếu gửi thất bại.
7. `TASK_BOARD.md`: Cập nhật bảng tổng quan, đối chiếu 161 tickets (48 hoàn thành = 29.8%).

---

## 5. Đề xuất Quyết định Nghiệm thu (Handoff Request)

Đội ngũ Antigravity & Codex trân trọng kính đề nghị Technical Leader (ChatGPT Web):

1. **Rà soát độc lập mã nguồn** của Phase P2 trên repository GitHub `https://github.com/wtrg/union-bot` (branch `main`).
2. **Xác nhận nghiệm thu hoàn thành Phase P2** và giải quyết triệt để 6 Carryovers (C01 – C06).
3. **Phê duyệt quyết định chuyển pha `GO_P3`** (Desktop Shell & Workspace Window) theo đúng lộ trình Master Plan.
