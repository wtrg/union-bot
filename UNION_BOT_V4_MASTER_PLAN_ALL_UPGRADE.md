# UNION BOT V4 — MASTER PLAN ALL UPGRADE
## Goal-Driven Multi-Agent Project Operating System

**Mã tài liệu:** UB-V4-MASTER-20261021  
**Phiên bản:** 1.0 — Handoff-ready / Source-grounded  
**Ngày:** 21/10/2026  
**Dự án nguồn:** [`wtrg/union-bot`](https://github.com/wtrg/union-bot)  
**GitHub baseline được tham chiếu:** `main@d4c87ea7705cf7276628f214297952b724b49686`  
**Phạm vi:** nâng cấp Union Bot V3.1, không viết lại từ đầu.  
**Product Owner (PO):** người dùng; **Implementer duy nhất:** Antigravity; **QA/Coordinator kỹ thuật:** Codex; **BA / kiến trúc / reviewer độc lập:** ChatGPT Web khi có kênh trao đổi thực; **Advisory:** Gemini, Claude, DeepSeek theo khả năng đã xác minh.  
**Ngân sách:** 0đ phí dịch vụ *phát sinh*; không API tính phí, mua credit, tự đổi gói, thuê server. Phần mềm hiện có/quyền sử dụng sẵn vẫn phải kiểm tra quota và chính sách.  
**Remote Git:** PO sẽ **cấp phép push cho từng phần**; tài liệu này **không** tự cấp phép push, merge hay publish.  
**Tình trạng:** đây là **kế hoạch bắt buộc triển khai**, KHÔNG phải báo cáo đã hoàn thành V4.

---

## 0. LỆNH TRIỂN KHAI CHO ANTIGRAVITY — ĐỌC TRƯỚC

1. Nhận tài liệu này làm **hợp đồng triển khai V4**; thực hiện tuần tự từ `U00` đến `U12`, được chạy song song những ticket có dependency rõ. Không tự mở scope mới, không phá dữ liệu cũ, không thay thế các service nền đang có khi chỉ cần mở rộng.
2. Trước bất kỳ chỉnh sửa: ghi **local HEAD/dirty worktree** và đối chiếu với GitHub `main@d4c87ea` (đây là ảnh chụp lúc lập plan, không phải khẳng định local HEAD là commit đó). Bảo toàn thay đổi chưa commit; tuyệt đối không reset hoặc ghi đè công việc của người khác.
3. **Antigravity là người duy nhất viết code V4.** Codex review kiến trúc, chạy kiểm thử thật, điều phối kỹ thuật; ChatGPT Web review code/commit qua GitHub khi PO hoặc cầu nối có quyền gửi link thực tế. Các agent tư vấn chỉ phản biện.
4. Mỗi milestone: `implement → local test → Codex QA → tạo review packet → chờ PO cho phép push phần đó → push nhánh review → gửi chính xác commit/PR link cho ChatGPT Web → nhận findings → sửa → QA lại → gate`. Nếu PO chưa cho phép push, chỉ tạo local commit/diff và trạng thái `AWAITING_PUSH_APPROVAL`.
5. **Không gắn nhãn DONE** cho một adapter khi nó chỉ mở được website, chưa gửi và nhận đúng lượt; **không gọi model live** nếu chưa chứng minh được quyền sử dụng/quota và chi phí 0đ. Mock chỉ là test mock.
6. Không giả người dùng, vượt CAPTCHA, bypass anti-bot, trích xuất cookie/mật khẩu, scrape API nội bộ không được phép, phá giới hạn dịch vụ hay phát tán dữ liệu dự án lên cloud không được PO phê duyệt.
7. Workflow đã được PO phê duyệt phải tự chạy tiếp **cho tới completion hoặc blocker thật**, nhưng vẫn dừng ở approval/cost/quota/security/privacy/unknown outcome. Không tự retry side effect không biết kết quả, không tự merge/main/deploy.
8. Khi một hạng mục cần khả năng nền tảng/provider chưa hỗ trợ: **capability gate + assisted/manual handoff**; không tái tạo giả công cụ độc quyền của ChatGPT/Gemini/Claude. Phải có trải nghiệm vẫn dùng được với provider đó ở trạng thái limited.
9. Mỗi gate nộp **một packet gọn**, chứa SHA/PR, source diff, kết quả tests, ảnh/log đã làm sạch, capability changes, blockers tối đa 5 và verdict đề nghị. Không gửi raw token, cookie, OTP, PIN hay screenshot nhạy cảm.
10. Không thay thế các vòng QA Windows portable cũ bằng unit mocks; giữ nguyên regression P0–P11/V3.1, migration và dữ liệu lịch sử, và tái chạy chúng sau nâng cấp.

### 0.1. Chính sách ưu tiên khi xung đột

`Security + explicit PO approval + 0đ` > `Data integrity + privacy + truthful evidence` > `V4 ticket contract` > `V3/V3.1 compatibility` > `nice-to-have UX`. Tính năng mới không được làm yếu hard gates. Lỗi tương thích phải làm ADR và migration trước khi sửa API/schema.

### 0.2. Các quyết định mặc định đã chốt (không cần hỏi lại)

- UX: `Group Chat` = **bảng điều hành ngắn gọn**, không mirror toàn bộ chat gốc; có link mở bằng chứng/phiên gốc theo quyền hạn.
- `/chat` = BA/discovery giữa PO + ChatGPT + Codex; phản biện, thu thập thiếu sót, chưa thực thi. Khi ChatGPT session chưa có bridge tự động, làm handoff có xác nhận chứ không giả phản hồi.
- `/work` = lập/freeze plan, một vòng peer critique, PO approve plan/goal, sau đó vòng `Antigravity build ↔ ChatGPT GitHub review ↔ Codex milestone QA` liên tục.
- ChatGPT chịu trách nhiệm **BA + Master Plan + review code**, Codex **QA + technical task routing**, Antigravity **implementer duy nhất**. ChatGPT không tự tuyên bố kiểm thử Windows nếu không có evidence từ Codex.
- User sẽ cấp **quyền push riêng cho từng phần** sau khi Antigravity báo hoàn tất, ưu tiên nhánh `review/v4/<milestone>`; cấm auto push khi thiếu quyền, cấm merge `main`/release/publish nếu không có phê duyệt riêng.
- Browser: tận dụng Electron hiện tại và Chrome/Edge thật khi cần, **không** chuyển engine sang WebView2 chỉ vì giả định khắc phục CAPTCHA. Shared browser-use phải có quyền, lock và evidence; login không được bypass.
- V4 phát triển tăng dần, app luôn có **manual mode** khi web provider blocked; V4 không được quảng cáo “full six AI automated” khi chưa chứng minh T3.

---

## 1. BASELINE THỰC TẾ V3.1 — CÁI GÌ GIỮ, CÁI GÌ THIẾU

### 1.1. Source đã đối chiếu

Tham chiếu tại commit nêu trên: `apps/desktop/src/main.js`, `preload.cjs`, `browser-service.cjs`, `orchestrator.cjs`, `task-graph-service.cjs`, `codex-service.cjs`, `antigravity-service.cjs`, `storage-service.cjs`, `tool-host.cjs`, `mcp-service.cjs`; UI `apps/workspace-ui/src/App.tsx`, `ChatRoom.tsx`, `BrowserPanel.tsx`, `TasksInbox.tsx`; các package `protocol`, `storage`, `artifact-store`, `browser-manager`, `agent-codex`, `agent-antigravity`, `orchestrator`, `cost-guard`. Xem `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md`, `UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md`, `reports/release/RELEASE_DOSSIER.md` và `reports/qa/NATIVE_LIVE_PREFLIGHT_20261021.md`.

| V3.1 đang có trong source | Điểm cần giữ / nhận xét |
|---|---|
| Electron 33 + React 18/Vite/TypeScript; preload IPC | Giữ shell, tách service logic để giảm `main.js` ~8k dòng; không đập đi viết lại. |
| Projects, Rooms, ChatRoom, TasksInbox, ApprovalInbox, BrowserPanel | Giữ UI và nâng cấp theo 2 chế độ `/chat`, `/work`, project control. |
| `Orchestrator.dispatchEnvelope()` nhận schema, idempotency và lưu SQLite | Luồng message bình thường **không đồng nghĩa** tự gửi tới AI web. Cần routing riêng và receipt thật. |
| `TaskGraphService`: DAG, PLAN/IMPLEMENT/REVIEW/FIX/VERIFY, consensus | Giữ engine, mở rộng `Goal/Plan/Milestone/WorkflowSupervisor`; không nhân đôi engine. |
| Codex App Server stdio JSON-RPC, Antigravity `agy` CLI | Adapter thực đã có; **T1 native live full-roundtrip vẫn `NOT_LIVE_VERIFIED`** theo preflight. |
| 4 web tabs `WebContentsView`, session partitions, health checks | UI/giao diện gốc khi tương thích; web handler chủ yếu capture DOM, chưa có acknowledged send–receive transaction đủ mạnh. |
| CAS SHA-256, SQLite WAL, migrations, transcript backup | Tái sử dụng; thêm provenance, artifact lineage, snapshot/goal schema. |
| ToolHost approval/cost guard và MCP tools | Giữ hard gates; MCP nội bộ không đồng nghĩa native tool của từng dịch vụ web. |
| P10/P11 QA release | Preserve, tái chạy; P10 evidence ghi rõ `ELECTRON_INTEGRATION_MOCK_NATIVE_TRANSPORT`, không được diễn giải là native model live. |

### 1.2. Các điểm chênh đặc biệt cần sửa trước tích hợp

- `App.tsx` còn `INITIAL_AGENTS` hardcode `ready/idle/auth_required`; BrowserPanel thể hiện `READY_OR_LANDING` bằng nhãn `✓ Ready`; phải tách `surface_loaded` khỏi `authenticated` và `capability_verified`. Screenshot Cloudflare thực tế của PO là regression case mới.
- Web transport `captureWebSessionResponse()` chọn selection hoặc DOM assistant gần nhất, tối đa 2.000 ký tự, **không xác minh correlation với prompt vừa gửi**. Không được dùng để ký nhận `DELIVERED/COMPLETED` khi thiếu send transaction và authoritative turn reference.
- `App.handleSendMessage()` gọi `dispatchEnvelope()` rồi lưu/broadcast nội bộ; thiếu conversation router lắng nghe room/mention, thực thi provider và đưa phản hồi đã xác nhận về room.
- `CodexService.executeVerification()` có thể kiểm tra file/hash/syntax cục bộ; điều đó **không** tự chứng minh Codex model đã mở turn và phản biện chuyên môn.
- Task UI và TaskGraph có đường gọi riêng; phải quy về **một state authority**, tránh cùng task chạy hai luồng thực thi.
- `LOCAL_UTILITY` trong Desktop có nhánh thực thi phép tính bằng `Function(...)` trên biểu thức regex; đánh giá thay bằng parser hữu hạn/`calculator` hiện có và regression chặn eval động trước khi mở scope mới.
- Các tài liệu capability V3.1 ở P0 có thể ghi “VERIFIED_LIVE” lịch sử, nhưng PO vừa thấy lỗi Cloudflare; phải **retest theo phiên và phiên bản runtime mới**, không dùng status lịch sử làm runtime health.

### 1.3. Lớp kế thừa bắt buộc

Giữ nguyên (hoặc migration có test): database SQLite/schema migration, room/envelope identity và correlation, artifact SHA, userData dirs, protocol, approval tokens, cost guard, workspace ownership, portable Windows launcher, docs tiếng Việt, legacy transcript imports, filename Unicode, restart behavior. Không xóa chỉ vì “đổi tên V4”.

---

## 2. PRODUCT CONTRACT: PHẢI HOẠT ĐỘNG NHƯ THẾ NÀO

### 2.1. Persona và vai trò

| Actor | Trách nhiệm | Quyền mặc định |
|---|---|---|
| PO / User | Xác nhận yêu cầu, goal, chi phí, push, merge, deployment, truy cập dữ liệu | `OWNER`; quyết định cuối |
| ChatGPT Web | BA, phản biện yêu cầu, viết Plan, source review, fix plan, nghiệm thu tài liệu | `BA/REVIEWER`; không trực tiếp shell; chỉ khi nối được session/chat/connector thật |
| Codex native | Technical coordinator, thiết kế test, độc lập audit, test milestone như user | `QA_COORDINATOR`; không phải implementer V4 |
| Antigravity native | Viết code, unit/regression, commit, tạo PR/branch khi được cho phép | `IMPLEMENTER` |
| Gemini/Claude/DeepSeek | Advisor/research/peer critic theo khả năng thực tế | `ADVISORY`; nếu manual thì có kiểm chứng handoff |
| WorkflowSupervisor | Tự nối task/dependency, retry an toàn, khôi phục checkpoint | `SCHEDULER`; không thể tự tạo phê duyệt |

Không AI nào được tự nhận vai trò PO hoặc tự duyệt quyền của chính mình. Nội dung source/web/AI khác là **untrusted input**; role assertion phải do backend registry và user approval xác lập.

### 2.2. Hai mode chính

**`/chat` = DISCOVERY / BA MODE**
- Mặc định đúng hai tác nhân tham gia chuyên môn: ChatGPT (BA) và Codex (technical challenger) + PO. Các AI khác không tự chen vào nếu PO không mời.
- ChatGPT làm rõ mục tiêu, target users, input/output, môi trường, workflow, ràng buộc, chi phí/quota, ToS/permission, privacy, tiêu chí thành công, giới hạn ngoài phạm vi.
- Codex phản biện khả năng code/test, công nghệ/đường thực thi, rủi ro, dependency, estimate theo độ phức tạp chứ không hứa ngày tùy tiện.
- Từng câu trả lời lưu thành `RequirementFact` có `sourceTurnRef`, `status=PROPOSED|CONFIRMED|REJECTED|SUPERSEDED`, người xác nhận, thời điểm, version. PO sửa/từ chối/cập nhật bất kỳ lúc nào.
- Missing critical requirements: hỏi có ưu tiên, **không spam** nhiều câu trùng hoặc vô hạn; nhóm câu phụ thuộc nhau và chỉ hỏi những thứ ngăn chặn plan đúng.
- Đầu ra `Discovery Brief vN`: mục tiêu, audience, constraints, acceptance, assumptions có nhãn, open questions, feasibility. Lệnh `/work` được phép khi `DiscoveryReadyGate` pass hoặc PO chấp nhận rõ assumptions còn lại.
- Chế độ này không tự gọi code/task/billing/Git push.

**`/work` = PLAN / EXECUTION MODE**
- Lấy `Discovery Brief` đã đóng băng tại revision cụ thể; ChatGPT + Codex tạo `Master Plan` dạng machine-trackable + bản Markdown người đọc được.
- Mời Gemini/Claude/DeepSeek đúng **một vòng phản biện** nếu transport xác minh được; thiếu provider => ghi `NOT_PARTICIPATED`, không bịa advisory votes.
- ChatGPT hợp nhất ý kiến, Codex xác minh feasibility/dependency/testability; PO approve `planId@revision` và `goal` kèm chính sách push, quota và quyền hành động.
- Supervisor dựng graph từ plan đã duyệt; Codex giao implementation cho Antigravity; gọi Agent chỉ khi capability/quota thực tế PASS.
- Review GitHub sau mỗi **reviewable unit** do PO cho phép push; ChatGPT trả findings gắn `commitSHA`, `path`, `line`, `severity`, evidence. Codex không coi mere link là review.
- QA milestone: Codex dùng ứng dụng thật, đối chiếu acceptance, screenshot/log/artifact; nếu FAIL tạo bug→fix plan→repair→retest. Sau PASS tự mở milestone kế tiếp.
- Thành công cuối chỉ khi tất cả acceptance criteria bắt buộc có evidence và owner sign-off; không tự công bố sản phẩm hoàn tất khi còn `NOT_LIVE_VERIFIED`.

### 2.3. Chat nhóm: ít chữ nhưng đủ bằng chứng

Mỗi thông báo nhóm là `ActivityEvent` chiếu từ execution thực: `GOAL_CREATED`, `BRIEF_READY`, `PLAN_APPROVED`, `TASK_ASSIGNED`, `COMMIT_READY`, `PUSH_APPROVAL_REQUESTED`, `PUSHED`, `REVIEW_RECEIVED`, `BUG_OPENED`, `FIX_READY`, `QA_PASSED`, `MILESTONE_COMPLETE`, `WAITING_USER`, `GOAL_COMPLETE`, `BLOCKED`.
Không đăng toàn bộ transcript vào group. Deep link đến session gốc, review packet, screenshot/cas, bug, PR theo quyền.

### 2.4. Native feature preservation — chức năng AI không bị giản lược

- ChatGPT/Gemini/Claude/DeepSeek tiếp tục dùng **giao diện và tính năng gốc được tài khoản hỗ trợ**; Union Bot chỉ quản lý session references, handoff, job request và receipts. Không clone canvas/artifacts/Gems/GPTs một cách giả mạo.
- Khả năng `FULL_NATIVE_VIEW`, `EXPORT_BYTES`, `UPLOAD_FILE`, `SEND_TEXT`, `SEND_IMAGE`, `READ_REPLY`, `TOOL_RESULT`, `STREAM`, `AUTOMATION_ALLOWED` kiểm chứng **riêng**, theo provider/mode/session/version, có source và thời điểm.

---

## 3. KIẾN TRÚC ĐÍCH V4 — REUSE FIRST

- `Electron Main` nhận IPC và bootstrap, tách service modules nhỏ.
- `ConversationRouter` giải quyết intent, mode, recipients, correlation, inbox/outbox, delivery receipts.
- `DiscoveryService` điều khiển hỏi đáp và tính nhất quán fact/decision.
- `PlanRegistry` lưu `Goal`, `Plan revision`, Milestone DAG, acceptance, baseline commit.
- `WorkflowSupervisor` dùng TaskGraph hiện có làm engine thực thi duy nhất.
- `ProviderTransportBroker` chọn `native_rpc`, `approved_web_transport`, `assisted_manual` hay `unavailable`.
- `EvidenceBroker` quản lý artifact bytes, screenshot, diff, test, receipt và links qua CAS/SQLite.
- `GitHubReviewBroker` ghi push request, PR/commit, review packet và ChatGPT callback/handoff.
- `ActivityProjection` render sự kiện audit đã xác minh thành messages ngắn gọn trong group.

---

## 4. HỢP ĐỒNG DỮ LIỆU VÀ GIAO THỨC

Entities: `Project`, `DiscoverySession`, `RequirementFact`, `OpenQuestion`, `Goal`, `PlanRevision`, `Milestone`, `WorkItem`, `NativeThreadRef`, `WebThreadRef`, `DeliveryAttempt`, `Evidence`, `GitChangeSet`, `ReviewFinding`, `QARecord`, `ActivityEvent`, `PermissionGrant`, `RunCheckpoint`.

SQLite migration strategy:
- Monotonic `v4_001...` migrations in `packages/storage/src/schema-definition.cjs`.
- Test SQLite native (`node:sqlite`) and worker modes.
- Strict rollback handling on failure.

---

## 5. ROADMAP TRIỂN KHAI V4: 13 GATE U00–U12

- U00: Baseline, Risk Audit & Compatibility
- U01: Schema V4, Event Authority & Core Contracts
- U02: `/chat`: Discovery, BA Questioning & Project Memory
- U03: Provider Capability & Native Runtime Truth
- U04: Two-Way Conversation Router & Thread Receipts
- U05: Artifact Handoff & Multimodal Fidelity
- U06: `/work`: Plan Registry, Critical Review & Goal Approval
- U07: WorkflowSupervisor: Continuous Durable Orchestration
- U08: GitHub Push Approval & ChatGPT Code Review Loop
- U09: Real Browser-Use & Context Bridge
- U10: Pragmatic Low-Noise UX & Accessibility
- U11: Security, Reliability, Observability & Performance
- U12: End-to-End UAT, Windows Portable, Migration & Release Dossier
