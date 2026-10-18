# MASTER TASK BOARD — UNION BOT

> **Dự án:** Union Bot (Multi-AI Desktop Collaboration Workspace)  
> **Cập nhật:** 2026-10-18 (Phase P0 Baseline Review)  
> **Quy chuẩn:** `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md` (1,884 lines) & `UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md` (205 lines)  
> **Các bên tham gia:**  
> - **Product Owner (PO):** User  
> - **Technical Leader / Independent Reviewer:** ChatGPT Web  
> - **Implementation Owner:** Antigravity  
> - **QA & Security Lead:** Codex  

---

## 1. Trạng thái Tổng quan Các Pha (Phase Overview)

| Pha | Tên Pha | Trạng thái | Số Ticket | Đã Hoàn thành | Tỉ lệ |
|---|---|---|---|---|---|
| **P0** | Khảo sát & Khóa Nền móng (Audit & Baseline) | `GATE_ACCEPTED_WITH_CARRYOVER` | 18 | 16 (Gate Closed) | 100% (Gate Closed) |
| **P1** | Monorepo Foundation & Toolchain | `ACTIVE (IN_PROGRESS)` | 18 | 0 | 0% |
| **P2** | Protocol, Storage & Event Sourcing | `TODO` | 10 | 0 | 0% |
| **P3** | Desktop Shell & Workspace Window | `TODO` | 15 | 0 | 0% |
| **P4** | Multi-Provider Browser Integration | `TODO` | 14 | 0 | 0% |
| **P5** | Artifact Management & Rich Response CAS | `TODO` | 15 | 0 | 0% |
| **P6** | Codex Local Agent Integration | `TODO` | 10 | 0 | 0% |
| **P7** | Antigravity Local Agent Integration | `TODO` | 10 | 0 | 0% |
| **P8** | Multi-Agent Orchestration & Task Graph | `TODO` | 16 | 0 | 0% |
| **P9** | Web Provider Capabilities & Extensions | `TODO` | 7 | 0 | 0% |
| **P10**| Hardening, Adversarial Tests & Acceptance | `TODO` | 14 | 0 | 0% |
| **P11**| Packaging, Windows Installer & Final Dossier | `TODO` | 12 | 0 | 0% |
| **Tổng** | **Toàn bộ Lộ trình Union Bot** | **P1 Active** | **159** | **16** | **10.1%** |

---

## 2. Chi tiết Vé Công việc Pha P0 (Khảo sát & Khóa Nền móng)

> **Quy ước Nhãn Mức Tin cậy Bằng chứng (Evidence Confidence Levels):**
> - `SOURCE_VERIFIED`: Đã kiểm chứng trực tiếp trong cây mã nguồn trên GitHub.
> - `TEAM_EXECUTED_LOG_INSPECTED`: Đội ngũ đã chạy thực tế trên máy trạm Windows, có raw log lưu trữ.
> - `REVIEWER_EXECUTED`: Technical Leader / Reviewer độc lập tự chạy và nghiệm thu.
> - `NETWORK_PROBE_ONLY`: Chỉ kiểm tra handshake HTTP/TLS origin, chưa chứng minh GUI nhúng.
> - `BLOCKED_EXTERNAL`: Bị chặn bởi dịch vụ bên ngoài (WAF, Cloudflare, ToS).

| Ticket ID | Tên Nhiệm vụ | Người phụ trách | File Sản phẩm | Trạng thái | Mức tin cậy & Bằng chứng / Evidence |
|---|---|---|---|---|---|
| `P0-001` | Repo Baseline & Clean Tree Audit | Antigravity | `reports/audit/REPO_BASELINE.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` Git init, .gitignore, clean tree verified. |
| `P0-002` | Legacy Code Module Inventory | Antigravity | `reports/audit/MODULE_INVENTORY.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 177 files scanned, 4-tier decision applied. |
| `P0-003` | Legacy Test Baseline Capture | Antigravity | `reports/qa/BASELINE_TESTS.md` | `BASELINE_CAPTURED_FAIL` | `[TEAM_EXECUTED_LOG_INSPECTED]` 118 errors/failures, 94 warnings (exit 1) ghi nhận làm mốc lịch sử khảo sát. |
| `P0-003-SEC`| Security & Secret Scan Audit | Antigravity | `reports/audit/SECRET_SCAN_REPORT.md` | `VERIFIED_LIVE` | `[TEAM_EXECUTED_LOG_INSPECTED]` Quét 1.839 files qua 2 roots; 0 leaks thực tế; redacted triage. |
| `P0-004` | Legacy Data & Persistence Audit | Antigravity | `docs/architecture/LEGACY_DATA_MAP.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 17 tables analyzed, WAL migration planned. |
| `P0-005` | Environment & Toolchain Lock | Antigravity | `docs/architecture/ENVIRONMENT_LOCK.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` Node 24, pnpm 12, Python 3.11, Git 2.55 locked. |
| `P0-006` | Codex App Server Capability Spike | Antigravity | `reports/capability-evidence/CODEX_SPIKE.md` | `VERIFIED_LIVE` | `[TEAM_EXECUTED_LOG_INSPECTED]` Multi-turn RPC passed: init -> thread -> turn -> token stream. |
| `P0-007` | Antigravity Headless CLI Spike | Antigravity | `reports/capability-evidence/ANTIGRAVITY_SPIKE.md` | `VERIFIED_LIVE` | `[TEAM_EXECUTED_LOG_INSPECTED]` agy -p json executed, token metrics verified. |
| `P0-008` | Browser Engine & Origin Probe Spike | Antigravity | `reports/capability-evidence/ELECTRON_BROWSER_SPIKE.md`, `spikes/electron-browser/` | `MINIMAL_SPIKE_ACCEPTED / PRODUCT_INTEGRATION_P1_P4` | `[TEAM_EXECUTED_LOG_INSPECTED]` Electron 33 Spike 4 AI rendered, partition isolation passed; hardening chuyển tiếp P1/P4. |
| `P0-009` | Cost Guard 0-dong Architecture | Antigravity | `docs/COST_MANIFEST.md`, `docs/security/EGRESS_BOUNDARIES.md`, `packages/cost-guard/` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 3-Layer defense spec; in-process interceptor + 17/17 tests pass. |
| `P0-010` | Provider Capability Matrix V1 | Antigravity | `docs/providers/CAPABILITY_MATRIX.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 6 providers analyzed, truthfulness enforced. |
| `P0-011` | Monorepo Structure RFC & ADR-000 | Antigravity | `docs/adr/ADR-000-monorepo-foundation.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` pnpm workspace & TypeScript layout accepted. |
| `P0-012` | Phase 0 Review Dossier R01–R05 | Antigravity | `reports/handoff/REVIEW_PACKET_R04.md`, `reports/audit/UNION_BOT_GO_P1_LEADER_REVIEW_R05_AND_P1_DIRECTIVE.md` | `LEADER_GO_P1_ISSUED` | `[REVIEWER_EXECUTED]` Leader review R05 chính thức ban hành GO_P1 anchored to SHA c2d329e. |
| `P0-013` | Union Bot Brand & Compatibility Inventory | Antigravity | `docs/adr/ADR-001-union-bot-brand-and-compat.md`, `reports/audit/BRAND_MIGRATION_INVENTORY.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 3-tier string mapping, 0-breakage strategy locked. |
| `P0-014` | ChatGPT Leader Handoff Channel Spike | Antigravity | `reports/capability-evidence/LEADER_HANDOFF_SPIKE.md` | `VERIFIED_LIVE` | `[TEAM_EXECUTED_LOG_INSPECTED]` Two-way handshake tested, R00-R05 cycles completed. |
| `P0-015` | Proof-of-Fidelity Rich Response CAS | Antigravity | `docs/providers/FIDELITY_MATRIX.md`, `packages/artifact-store/` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` CAS implemented, path traversal blocked, 8/8 tests + TS web roundtrip pass. |
| `P0-016` | Provider Policy & Automation Matrix | Antigravity | `docs/providers/POLICY_AUTOMATION_MATRIX.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` Legal/technical permissions mapped, billing blocked. |
| `P0-017` | Baseline Data Flow & Trust Boundaries | Antigravity | `docs/security/DATA_FLOW_AND_TRUST_BOUNDARIES.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` 4 trust zones & abuse cases defined. |
| `P0-018` | Product Release Scope & Tiers Decision | Antigravity | `docs/product/RELEASE_SCOPE_DECISION.md` | `VERIFIED_LIVE` | `[SOURCE_VERIFIED]` T0-T3 tiers defined; target release = T1 + T2. |

---

## 3. Lộ trình Các Pha Tiếp Theo (P1 – P11)

### Phase P1: Monorepo Foundation & Toolchain (`ACTIVE / IN_PROGRESS`)

> **Quyết định Chuyển pha:** `GO_P1` được Technical Leader phê duyệt chính thức tại Round R05 (gắn với commit `c2d329edb925ecbbab9b707ab6042550e656a7a7`, văn bản chỉ thị `reports/audit/UNION_BOT_GO_P1_LEADER_REVIEW_R05_AND_P1_DIRECTIVE.md`).

#### Wave 1: Security Preflight & Root Monorepo Hardening
- `UB-P1-SEC-001` [S1/HIGH]: `safeOpenExternal` scheme validation & `setWindowOpenHandler` on WebContentsView (chặn protocol nguy hiểm `file:`, `javascript:`, deny popups)
- `UB-P1-SEC-002` [S1/HIGH]: Secret scanner strict fixture allowlist (loại bỏ auto-safe theo tên folder; hỗ trợ `.env.*`, `.npmrc`, `*.pem`, `*.key`)
- `UB-P1-SEC-003` [S1/HIGH]: Screenshot reality check (loại bỏ suffix `_scrubbed` nếu không redact thật; `--no-screenshot` cho auth profiles)
- `UB-P1-SEC-004` [S2/MEDIUM]: Codex harness subprocess direct argv (`shell=False`, sanitized PATH, redaction)
- `P1-001`: Root monorepo lockfile (`pnpm-lock.yaml`), packageManager & Node LTS engines lock
- `P1-007`: Wire Cost Guard interceptor vào Electron main lifecycle & session filters
- `P1-009`: CI / pre-commit verification script (`scripts/verify.ps1`, strict secret scan, type check)

#### Wave 2: Desktop & UI Foundation
- `P1-002`: `apps/desktop` Electron 33+ TypeScript main/preload/renderer structure
- `P1-003`: `apps/workspace-ui` React 18 + Vite + Tailwind CSS scaffolding
- `P1-004`: `packages/protocol` setup (Zod schemas for MessagePart, Envelope, Fidelity)
- `P1-005`: `packages/artifact-store` workspace link & cross-package tests
- `P1-006`: `packages/orchestrator` skeleton (Admission Policy & default DENY_UNKNOWN)
- `P1-011` [V3.1]: Union Bot branding, metadata, window titles, icons, updater safety

#### Wave 3: Reproducible Build & Verification Gate (GO_P2)
- `P1-008`: Build orchestration & scripts (`pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`)
- `UB-P1-QA-005` [S2/MEDIUM]: Electron probe exit codes, timeout handling & evidence fidelity
- `UB-P1-ARCH-006` [S2/MEDIUM]: Cost Guard admission gate wiring & deny-before-dispatch
- `UB-P1-QA-007` [S3/LOW]: Evidence taxonomy & test counters alignment
- `P1-010`: Phase 1 Review Dossier & `REVIEW_PACKET_P1_R01.md` requesting `GO_P2`

### Phase P2: Protocol, Storage & Event Sourcing (10 tickets)
- `P2-001` .. `P2-008`: Zod schemas, SQLite WAL setup, event journal, idempotency
- `P2-009` .. `P2-010`: Persistence tests & Review Packet R03

### Phase P3: Desktop Shell & Workspace Window (15 tickets)
- `P3-001` .. `P3-014`: Electron window lifecycle, tray, multi-room UI, keyboard shortcuts
- `P3-015` [V3.1]: Context Preview Dialog (xem rõ trước khi gửi AI)

### Phase P4: Multi-Provider Browser Integration (14 tickets)
- `P4-001` .. `P4-012`: WebContentsView for 4 web AI, manual share buttons, view switching
- `P4-013` [V3.1]: Account/profile isolation & browser state reconciliation
- `P4-014` [V3.1]: Browser navigation vs permission state (OAuth, DPI, downloads)

### Phase P5: Artifact Management & Rich Response CAS (15 tickets)
- `P5-001` .. `P5-012`: Artifact hashing, preview generator, provenance ledger
- `P5-013` [V3.1]: Fidelity contract for rich response (6 fidelity levels)
- `P5-014` [V3.1]: Capability-negotiated cross-AI handoff
- `P5-015` [V3.1]: Semantic rendering + preview isolation (DOMPurify, sandbox)

### Phase P6: Codex Local Agent Integration (10 tickets)
- `P6-001` .. `P6-010`: Stdio JSON-RPC client, test runner, review feedback loop

### Phase P7: Antigravity Local Agent Integration (10 tickets)
- `P7-001` .. `P7-010`: Headless CLI runner, stream-json consumer, code synthesis

### Phase P8: Multi-Agent Orchestration & Task Graph (16 tickets)
- `P8-001` .. `P8-012`: Task state machine, DAG execution, approval gates
- `P8-013` [V3.1]: Context synchronization by version/cost/permission
- `P8-014` [V3.1]: Delivery/receipt & output verification
- `P8-015` [V3.1]: AI team discussion controller with evidence-based debate
- `P8-016` [V3.1]: Fair scheduling & backpressure per provider

### Phase P9: Web Provider Capabilities & Extensions (7 tickets)
- `P9-001` .. `P9-006`: Provider health monitors, error detectors, manual export helpers
- `P9-007` [V3.1]: Capability truth probe per website (`P9-CG7`, `P9-GM7`, `P9-CL7`, `P9-DS7`)

### Phase P10: Hardening, Adversarial Tests & Acceptance (14 tickets)
- `P10-001` .. `P10-012`: Stress tests, network disconnection recovery, crash resilience
- `P10-013` [V3.1]: Cross-provider acceptance journey (`UAT-031`..`042`)
- `P10-014` [V3.1]: Security adversarial multi-profile & context leak tests

### Phase P11: Packaging, Windows Installer & Final Dossier (12 tickets)
- `P11-001` .. `P11-010`: electron-builder setup, Windows NSIS installer, release verification
- `P11-011` [V3.1]: Safe manual update & database rollback contract
- `P11-012` [V3.1]: Union Bot brand & final claims audit (T0-T3 certification)

---

## 4. Ma trận Kiểm thử Người dùng (UAT Scenarios: UAT-001 .. UAT-042)

| UAT ID | Tình huống Kiểm thử | Tiêu chuẩn Đạt Chuẩn | Trạng thái |
|---|---|---|---|
| `UAT-001` .. `UAT-030` | 30 kịch bản cốt lõi từ Master Plan V3.0 (Cài đặt, tạo phòng, gửi tin, duyệt web, gọi Codex, gọi Antigravity, Cost Guard chặn thanh toán) | 100% kịch bản đạt chuẩn không có lỗi nghiêm trọng | `SCHEDULED` |
| `UAT-031` | Ảnh thật ChatGPT/Web export -> shared room -> local agent | Bytes và SHA khớp 100%; nếu chỉ screenshot thì ghi đúng `screenshot_only` | `SCHEDULED` |
| `UAT-032` | Tệp PDF + lời giải markdown + native interactive widget trong một reply | Giữ từng part và fidelity; widget không hỗ trợ chỉ mở native | `SCHEDULED` |
| `UAT-033` | Provider nhận long context đã lược bớt | Có manifest phần gửi/bỏ; không rò context room khác | `SCHEDULED` |
| `UAT-034` | Codex review SHA A; Antigravity sửa sang SHA B | Review của SHA A không duyệt SHA B; bắt buộc review lại | `SCHEDULED` |
| `UAT-035` | Hai phòng đồng thời gửi cùng một provider | Đúng reply/thread/correlation; không trộn nội dung giữa 2 phòng | `SCHEDULED` |
| `UAT-036` | Một web provider quota/login hết hạn lúc thảo luận | UI hiện rõ giới hạn; không tự ý đổi account hoặc gọi API có phí | `SCHEDULED` |
| `UAT-037` | App đột ngột crash sau khi gửi tác vụ chưa nhận ACK | Khởi động lại ở trạng thái UNKNOWN; không tự gửi lại tác vụ có side-effect | `SCHEDULED` |
| `UAT-038` | Clipboard/manual file chuyển từ AI web | Provenance gắn đúng `user_manual`; không mạo danh live capture | `SCHEDULED` |
| `UAT-039` | Hai account cùng provider, project A/B | Cookie/session không chéo; không egress trái phép | `SCHEDULED` |
| `UAT-040` | Nhận packet R01 -> Leader review -> FIX PLAN -> R02 | Mã định danh lỗi truy vết được, đối chiếu SHA trước/sau | `IN_PROGRESS` |
| `UAT-041` | Installer Union Bot nâng cấp profile legacy | App data cũ không bị mất; backup/restore đạt 100% | `SCHEDULED` |
| `UAT-042` | Bấm tải/export tool/plugin proprietary không hỗ trợ | Thông báo giới hạn minh bạch + native link; không fake tính năng | `SCHEDULED` |
