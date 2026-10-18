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
| **P0** | Khảo sát & Khóa Nền móng (Audit & Baseline) | `VERIFIED_LIVE` | 18 | 18 | 100% |
| **P1** | Monorepo Foundation & Toolchain | `READY_FOR_NEXT` | 11 | 0 | 0% |
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
| **Tổng** | **Toàn bộ Lộ trình Union Bot** | **P0 Complete** | **152** | **18** | **11.8%** |

---

## 2. Chi tiết Vé Công việc Pha P0 (Khảo sát & Khóa Nền móng)

| Ticket ID | Tên Nhiệm vụ | Người phụ trách | File Sản phẩm | Trạng thái | Bằng chứng / Evidence |
|---|---|---|---|---|---|
| `P0-001` | Repo Baseline & Clean Tree Audit | Antigravity | `reports/audit/REPO_BASELINE.md` | `VERIFIED_LIVE` | Git init, .gitignore, clean tree verified. |
| `P0-002` | Legacy Code Module Inventory | Antigravity | `reports/audit/MODULE_INVENTORY.md` | `VERIFIED_LIVE` | 177 files scanned, 4-tier decision applied. |
| `P0-003` | Security Scan & Legacy Test Baseline | Antigravity | `reports/audit/SECRET_SCAN_REPORT.md`, `reports/qa/BASELINE_TESTS.md` | `VERIFIED_LIVE` | Custom scanner executed (0 leaks); 20/20 legacy tests verified. |
| `P0-004` | Legacy Data & Persistence Audit | Antigravity | `docs/architecture/LEGACY_DATA_MAP.md` | `VERIFIED_LIVE` | 17 tables analyzed, WAL migration planned. |
| `P0-005` | Environment & Toolchain Lock | Antigravity | `docs/architecture/ENVIRONMENT_LOCK.md` | `VERIFIED_LIVE` | Node 24, pnpm 12, Python 3.11, Git 2.55 locked. |
| `P0-006` | Codex App Server Capability Spike | Antigravity | `reports/capability-evidence/CODEX_SPIKE.md` | `VERIFIED_LIVE` | Live multi-turn RPC passed: init -> thread -> turn -> token stream. |
| `P0-007` | Antigravity Headless CLI Spike | Antigravity | `reports/capability-evidence/ANTIGRAVITY_SPIKE.md` | `VERIFIED_LIVE` | agy -p json executed, token metrics verified. |
| `P0-008` | Browser Engine & Origin Probe Spike | Antigravity | `reports/capability-evidence/BROWSER_SPIKE.md` | `VERIFIED_LIVE` | Strict TLS probe verified; WebContentsView architecture locked (GUI in P2/P4). |
| `P0-009` | Cost Guard 0-dong Architecture | Antigravity | `docs/COST_MANIFEST.md`, `packages/cost-guard/` | `VERIFIED_LIVE` | TS module + fetch/Agent/Socket/HTTP2 + Electron interceptor, 14/14 tests pass. |
| `P0-010` | Provider Capability Matrix V1 | Antigravity | `docs/providers/CAPABILITY_MATRIX.md` | `VERIFIED_LIVE` | 6 providers analyzed, truthfulness enforced. |
| `P0-011` | Monorepo Structure RFC & ADR-000 | Antigravity | `docs/adr/ADR-000-monorepo-foundation.md` | `VERIFIED_LIVE` | pnpm workspace & TypeScript layout accepted. |
| `P0-012` | Phase 0 Exit Dossier & Review Packet R01-R03 | Antigravity | `reports/handoff/REVIEW_PACKET_R01.md` | `VERIFIED_LIVE` | Toàn bộ hồ sơ R01-R03 nộp và giải trình với ChatGPT Leader. |
| `P0-013` | Union Bot Brand & Compatibility Inventory | Antigravity | `docs/adr/ADR-001-union-bot-brand-and-compat.md`, `reports/audit/BRAND_MIGRATION_INVENTORY.md` | `VERIFIED_LIVE` | 3-tier string mapping, 0-breakage strategy locked. |
| `P0-014` | ChatGPT Leader Handoff Channel Spike | Antigravity | `reports/capability-evidence/LEADER_HANDOFF_SPIKE.md` | `VERIFIED_LIVE` | Two-way handshake tested, R00 verdict received. |
| `P0-015` | Proof-of-Fidelity Rich Response CAS | Antigravity | `docs/providers/FIDELITY_MATRIX.md`, `packages/artifact-store/` | `VERIFIED_LIVE` | CAS implemented, path traversal blocked, 8/8 tests pass + TS web asset roundtrip verified. |
| `P0-016` | Provider Policy & Automation Matrix | Antigravity | `docs/providers/POLICY_AUTOMATION_MATRIX.md` | `VERIFIED_LIVE` | Legal/technical permissions mapped, billing blocked. |
| `P0-017` | Baseline Data Flow & Trust Boundaries | Antigravity | `docs/security/DATA_FLOW_AND_TRUST_BOUNDARIES.md` | `VERIFIED_LIVE` | 4 trust zones & abuse cases defined. |
| `P0-018` | Product Release Scope & Tiers Decision | Antigravity | `docs/product/RELEASE_SCOPE_DECISION.md` | `VERIFIED_LIVE` | T0-T3 tiers defined; target release = T1 + T2. |

---

## 3. Lộ trình Các Pha Tiếp Theo (P1 – P11)

### Phase P1: Monorepo Foundation & Toolchain (11 tickets)
- `P1-001`: Root workspace setup (`pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`)
- `P1-002`: apps/desktop scaffolding (Electron + TypeScript)
- `P1-003`: apps/workspace-ui scaffolding (React + Vite + Tailwind CSS)
- `P1-004`: packages/protocol setup
- `P1-005`: packages/artifact-store linking
- `P1-006`: packages/orchestrator setup
- `P1-007`: packages/cost-guard linking & integration
- `P1-008`: Build orchestration & scripts (`pnpm build`, `pnpm test`, `pnpm lint`)
- `P1-009`: CI/CD pre-commit hooks (secret scan, type check)
- `P1-010`: Phase 1 review dossier & review packet R02
- `P1-011` [V3.1]: Union Bot package metadata, icons, app titles, updater safety

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
