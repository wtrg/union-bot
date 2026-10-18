# UNION BOT — PHỤ LỤC TRIỂN KHAI V3.1 & LỆNH GO P0

> **Loại:** Addendum kỹ thuật bắt buộc cho `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md` (18/10/2026, 1.884 dòng).  
> **Reviewer:** ChatGPT — Technical Leader / Independent Reviewer.  
> **Implementation Owner:** Antigravity. **QA:** Codex. **Quyết định sản phẩm cuối:** Product Owner.  
> **Trạng thái review:** Đã đọc file V3.0; **chưa review source/repo, chưa chạy app, chưa xác nhận live integration**.  
> **Quyết định:** **GO cho P0** ngay; **V3.0 chưa đóng đặc tả sản phẩm hoàn toàn** cho tới khi thêm các ticket bên dưới.

## A. QUY TẮC ÁP DỤNG

1. **Tên thương hiệu và sản phẩm chính thức = `Union Bot`.** Mọi UI, Windows installer, docs, release dossier, icon/title/version product dùng tên này. `MUTI CHAT BOT` là tên dự án lịch sử; giữ alias cho báo cáo cũ và migration cần thiết. **Không tự ý đổi tên repo, thư mục dữ liệu người dùng, package IDs, SQLite IDs hoặc API schema gây mất tương thích.** Phải lập ADR và test migration trước.
2. V3.0 vẫn điều khiển lộ trình **P0–P11**. Phụ lục này **thêm ticket cụ thể**, không thay kiến trúc, không tự tạo thêm pha hoặc xóa gate an toàn đã có. Khi mâu thuẫn: quy tắc chi phí/an toàn/dữ liệu mạnh hơn thắng; các quyết định thay đổi scope/release tier cần PO ký.
3. Tài liệu này **không xác nhận** bất kỳ web AI nào có thể nhận/gửi tự động, đọc DOM, chuyển plugin, hoặc giữ đăng nhập trong embedded Chromium. Những năng lực này chỉ được bật khi có **policy review + live evidence**.
4. Quy định 0đ: không API trả phí, không server thuê, không trial đòi thẻ, không tự đổi gói, không tự gửi repo/file bí mật lên dịch vụ. Chi phí điện, mạng, máy đã sở hữu không thuộc phí dịch vụ.
5. Không sử dụng câu "đã gửi sang AI" nếu chỉ copy clipboard, mở trang hoặc nhấp Send chưa nhận ACK/quan sát lượt đúng. Không sử dụng "đã nhận đủ" khi chưa đối chiếu file bytes/hash và acknowledgment phù hợp.
6. **P0 được phép bắt đầu ngay.** P0 không có quyền tự xóa mã gốc, push, merge, force-push hoặc publish release. Thông báo gián tiếp "PO đã cho push" cần được PO xác nhận trực tiếp về **repo đích, branch, dữ liệu được đẩy, quy trình phê duyệt** trước bất kỳ thao tác remote-write. Nếu chưa xác minh thì dùng local commit, review ZIP/source và ghi `PUSH_APPROVAL_PENDING`.

## B. NHỮNG GÌ V3.0 ĐÃ CÓ — KHÔNG VIẾT LẠI

V3.0 đã chứa: Electron + WebContentsView; UI phòng chat và trình duyệt; sáu profile provider; Codex App Server; Antigravity CLI; artifact SHA256/provenance; MCP & một MCP App tự sở hữu; task graph, durable event journal/approval; Cost Guard 0đ; crash recovery; capability matrix; P0–P11; 30 UAT; reviewer handoff packet và fix plan. **Không tạo module thứ hai trùng những thành phần này.** Mỗi ticket V3.1 bên dưới phải trỏ đến module V3.0 tương ứng và chỉ mở rộng thiếu sót.

## C. RELEASE TIERS — CHỐT CÁCH TUYÊN BỐ "DÙNG ĐƯỢC"

| Tier | Tên trên sản phẩm | Điều kiện bắt buộc | Không được tuyên bố |
|---|---|---|---|
| T0 | `UNION_BOT_DESKTOP_READY` | App Windows đóng gói dùng được, project/room/file/browser/manual share/persistence/security hoạt động | Không ghi "AI làm việc chung tự động" |
| T1 | `UNION_BOT_AGENT_COLLAB_VERIFIED` | Codex **và** Antigravity chạy live theo quyền hợp lệ, hoàn thành vòng `build → review/test → fix → verify` thật; chứng minh truyền tệp/hash/trạng thái từ agent này sang agent kia | Không suy ra bốn website cũng auto |
| T2 | `UNION_BOT_SIX_PROVIDER_WORKSPACE` | 6 profile có UI native/system-browser fallback, cơ chế manual share và capability truth cho từng dịch vụ; T1 đạt hoặc bị ghi rõ là **chưa đạt** | Không quảng cáo "6 AI tự phản hồi" nếu web chỉ manual |
| T3 | `UNION_BOT_FULL_AUTOMATED_SIX_AI` | 6 provider đều tự gửi/nhận/đối chiếu lượt đúng, transfer artifact theo capability thực tế; automation được phép và sống qua reload/restart; live tests đủ | Không đạt T3 bằng mock, clipboard thủ công, DOM không xác thực |

**Điểm cần PO xác nhận ở P0:** mức tối thiểu PO chấp nhận cho lần bàn giao thương mại/nội bộ đầu tiên. Đề nghị **T1 + T2** là đích sản phẩm Union Bot theo ý tưởng gốc. Nếu T1 bị chặn vì nhà cung cấp/tài khoản, T0 có thể giao làm bản nền, **không được đánh đồng với Union Bot đa-agent hoàn thành**. T3 là mục tiêu điều kiện, không được chi trả hoặc vượt chính sách để đạt.

## D. TICKET BỔ SUNG BẮT BUỘC

**Trạng thái đầu cho toàn bộ ticket = `TODO`; không được đánh dấu `VERIFIED` khi chỉ có design/mock.** Các ticket này phải được ghi nguyên ID trong `TASK_BOARD.md`. Khi mã V3.0 đã giải quyết, đánh `SATISFIED_BY_EXISTING` cùng path+test+evidence thay vì code lại.

### D0. P0 — Kiểm chứng hiện trạng và khóa hợp đồng

#### `P0-013` — Rename/compatibility inventory `Union Bot` — P0 gate
- **Phụ trách:** Antigravity. **File:** `docs/adr/ADR-001-union-bot-brand-and-compat.md`, `reports/audit/BRAND_MIGRATION_INVENTORY.md`.
- **Làm:** tìm tất cả chuỗi MUTI/MUTI CHAT BOT/WT Team trong display strings, appId/productName, taskbar, tray, installer, update data path, DB/project keys, docs/report paths, telemetry (nếu có), executable alias. Phân nhóm DISPLAY_ONLY / IDENTIFIER_STABLE / MIGRATION_REQUIRED; đề xuất icon/name/appId.
- **Test/accept:** dữ liệu cũ không bị mất/nhân đôi; UI/installer không lẫn tên; không đổi persistent paths trước khi có migration+backup test.

#### `P0-014` — Chứng minh kênh ChatGPT Leader handoff thực tế — P0 gate
- **File:** `reports/capability-evidence/LEADER_HANDOFF_SPIKE.md`.
- **Làm:** xác định hình thức chuyển report/source/diff đến phiên reviewer: người dùng gửi thủ công, connector được cấp quyền hoặc bridge đã test. Tạo handshake fixture không chứa secret, ghi round ID, sender, receipt, response file, SHA. Không giả định chat này tự nhìn local file.
- **Test/accept:** một packet fixture có thể đến reviewer; một file nhận xét đến đúng người sửa, round không lẫn. Nếu không có transport tự động: `MANUAL_HANDOFF_READY`, không ghi `DIRECT_BRIDGE_READY`.

#### `P0-015` — Proof-of-fidelity không chỉ text — P0 gate
- **File:** `reports/capability-evidence/RICH_RESPONSE_SPIKE.md`, `docs/providers/FIDELITY_MATRIX.md`.
- **Làm:** trên từng provider được phép thử: text có định dạng; ảnh; PDF/tệp; code block; citation/link; kết quả công cụ; widget/plugin native. Với mỗi loại, ghi nguồn gốc, hỗ trợ xem native, capture theo cơ chế chính thức, bytes có/không, import được/không, hạn chế. Không ép làm test cần tính năng trả tiền.
- **Test/accept:** có bảng `NATIVE_VIEW / PORTABLE_BYTES / INTERACTIVE_COMPATIBLE / REFERENCE_ONLY / UNAVAILABLE / NOT_TESTED` và evidence; ít nhất một ảnh và một file thực được roundtrip qua shared store, giữ hash khi có file gốc.

#### `P0-016` — Provider policy + zero-cost live matrix — P0 gate
- **File:** `docs/providers/POLICY_AUTOMATION_MATRIX.md`, `docs/COST_MANIFEST.md`.
- **Làm:** ghi ngày nguồn chính thức, account mode thực, điều kiện embedded login, automation, export, tool/plugin access và kết nối miễn phí. Tách technical availability khỏi legal/policy permission. Không lưu credential.
- **Test/accept:** mọi kênh gửi prompt tự động được đánh `UNKNOWN/BLOCKED/APPROVED_FOR_SPIKE`; không tự chuyển unknown thành supported. Mọi endpoint billing chưa xác minh bị chặn.

#### `P0-017` — Baseline data ownership/secret map — P0 gate
- **File:** `docs/security/DATA_FLOW_AND_TRUST_BOUNDARIES.md`.
- **Làm:** liệt kê renderer, browser sessions, web providers, agent processes, tool host, artifacts, local DB, Git remote, diagnostic export. Đánh dấu ai sở hữu dữ liệu nào, dữ liệu nào có thể ra Internet, trust level của kết quả từ AI/web/file.
- **Test/accept:** có sơ đồ luồng dữ liệu, abuse cases cho cross-account/workspace, prompt injection, accidental external share. Không có đường truyền tự phát browser-cookie đến agent.

#### `P0-018` — Decision log về mức độ release — P0 gate
- **File:** `docs/product/RELEASE_SCOPE_DECISION.md`.
- **Làm:** đưa T0–T3 vào quyết định PO, phân biệt "bản desktop dùng được" và "nhóm AI tự cộng tác thật". Ghi fallback/hạn chế nhà cung cấp và yêu cầu không tạo phí.
- **Test/accept:** T1 không tự suy ra hoàn thành từ UI/manual chat; T3 chỉ chứng nhận bằng live integration đã được phép.

### D1. P1–P4 — Desktop, browser, đồng bộ phiên

#### `P1-011` — Union Bot package metadata
- **File mục tiêu:** `apps/desktop/package.json`, `electron-builder` config hoặc tương đương, branding assets/docs.
- **Làm:** displayName/productName/icon/about/window title/installer shortcut/uninstaller/release file; appId cũ được xử lý qua ADR, không đổi bừa.
- **Test:** packaged EXE và uninstall hiện đúng Union Bot; chạy upgrade trên dữ liệu cũ không tạo profile rỗng hay mất session.

#### `P3-015` — Người dùng xem rõ AI đang nhận thông tin gì
- **File:** `apps/workspace-ui/src/features/context/` hoặc module phù hợp.
- **Làm:** preview trước khi gửi: recipient, room, task, selected messages/file paths, số byte, giới hạn dự kiến, external-egress warning, hành động edit/remove; phân biệt shared state vs provider-native state.
- **Test:** thay đổi recipient/file sau approval làm vô hiệu approval; thao tác từ chối không gửi bất kỳ dữ liệu nào.

#### `P4-013` — Account/profile isolation + browser state reconciliation
- **File:** browser session manager và settings, `tests/e2e/browser-profiles.spec.ts`.
- **Làm:** giữ profile riêng theo provider *và* profile/account identifier; không trộn cookies/tab/history giữa hai tài khoản, phòng và workspace; chia sẻ nội dung từ session sang room là hành động có chủ ý, gắn provenance. Không đặt URL nhạy cảm trong log.
- **Test:** hai account profile cùng provider không nhìn thấy session nhau; đổi project khi view vẫn mở không auto-chia sẻ; profile logout/expired hiển thị trạng thái đúng.

#### `P4-014` — Browser navigation vs permission state
- **File:** `tests/e2e/browser-permissions.spec.ts` + browser managers.
- **Làm:** back/forward, redirects, popup OAuth fallback, download dialog, microphone/file access, webview focus overlay (Windows DPI), app links/custom schemes; không tự vô hiệu browser security.
- **Test:** e2e `redirect → login blocked → open external → return manually`; không pretend auth session external tự chuyển về embedded.

### D2. P5 — Chuyển giao toàn bộ sản phẩm đa phương thức trong khả năng cho phép

#### `P5-013` — Fidelity contract cho rich response
- **File:** `packages/protocol/src/fidelity.ts`, `packages/artifact-store/`, `apps/workspace-ui/src/features/messages/`.
- **Làm:** mỗi part có `fidelity = original_bytes | structured_copy | rendered_preview | screenshot_only | external_reference | unavailable`; `transfer_state = local_verified | reference_only | needs_manual_export | blocked_permission | failed`; source actor, user/manual attribution, MIME, hash/version. **Không gọi screenshot là file gốc; không gọi PDF preview là PDF bytes.**
- **Test:** fixture widget tương tác, file PDF thực, ảnh PNG, copy markdown; UI/agent nhận đúng hạn chế và nguồn.

#### `P5-014` — Capability-negotiated handoff theo AI đích
- **File:** `packages/artifact-bridge/src/transfer-planner.ts`, `tests/integration/cross-provider-transfer.test.ts`.
- **Làm:** trước khi chuyển, xác định recipient hỗ trợ plain text / file bytes / image / reference / interactive. Tạo phương án giao có consent, không xóa part không thể chuyển; giữ native reference, cảnh báo missing capabilities và evidence ID.
- **Test:** gửi nội dung gồm text+PNG+PDF+native widget sang local agent: nhận đúng bytes/hash; gửi đến browser-only provider: chỉ đánh delivered khi user/provider xác nhận, không báo nhận đủ nếu widget không chuyển được.

#### `P5-015` — Semantic rendering + preview isolation
- **File:** renderer, `tests/security/rich-content-untrusted.spec.ts`.
- **Làm:** bảo toàn bảng, code, citations, audio/video attachments, tool result, annotations; preview HTML/SVG/PDF/MCP App trong boundary an toàn; `native_reference` cho plugin không tương thích.
- **Test:** XSS, malicious HTML/SVG, remote file URI, iframe privilege, giant markdown, corrupted media; không thực thi trong privileged renderer.

### D3. P8 — Chất lượng trao đổi thật, chống AI "nói có nhưng không làm"

#### `P8-013` — Context synchronization theo phiên bản/chi phí/quyền
- **File:** `packages/orchestrator/src/context-builder.ts`, `tests/integration/context-handoff.test.ts`.
- **Làm:** gửi nội dung theo room, user selection, snapshot (event ID/sha), file excerpt, source URL và phạm vi được chấp thuận; giới hạn kích thước/chunk, xác định cái nào bị lược bỏ; tách lời AI từ nguồn không tin cậy ra khỏi policy/system instruction; không gửi toàn bộ lịch sử/cookie tự động.
- **Test:** 2 task đồng thời, switch room, outdated artifact, revoked consent, long context truncation. Recipient không được nhìn dữ liệu của room khác; thông tin bị lược bỏ có manifest minh bạch.

#### `P8-014` — Delivery/receipt & output verification
- **File:** `packages/orchestrator/src/delivery-ledger.ts`, `tests/integration/receipt-verification.test.ts`.
- **Làm:** trạng thái tối thiểu `PREPARED → SUBMITTED → ACK_OBSERVED → CONTENT_CAPTURED → ARTIFACT_VERIFIED`; mỗi bước có evidence. Tool execution cần `exit status + effects verification`; website capture phải liên kết đúng reply turn. Timeout sau send = `UNKNOWN_NEEDS_RECONCILIATION`, không báo failed chắc chắn hoặc tự gửi lại.
- **Test:** mất mạng trước/giữa/sau submit, 2 replies out of order, empty text với tool output, duplicate ACK, restart sau side effect. Không có false COMPLETED/DELIVERED.

#### `P8-015` — AI team discussion controller với tranh luận có căn cứ
- **File:** `packages/orchestrator/src/discussion/`, `tests/integration/multi-agent-debate.test.ts`.
- **Làm:** round theo roles, @mention, reply-to IDs, claims/objections/evidence, versioned decisions, revision history, unresolved conflicts, owner override; dừng khi gate pass, quota/auth, max rounds hoặc human stop. Model không tự bỏ điều kiện nghiệm thu.
- **Test:** Codex phản biện lỗi có test fail, Antigravity sửa, Codex run again; khác SHA => review stale; provider không phản hồi => marked absent không fabricated consensus; retry không duplicate dispatch.

#### `P8-016` — Fair scheduling/backpressure theo provider
- **File:** `packages/orchestrator/src/scheduler/`, `tests/integration/scheduler-quota.test.ts`.
- **Làm:** per-provider serialized turn khi session không hỗ trợ song song, rate caps chính thức được kiểm chứng, queue fairness theo room, cancellation, bounded attempts, quota pause, Windows memory/tab resource throttling; model local không tự mạo danh provider thương hiệu.
- **Test:** 100 fixture tasks + 2 live test có quyền, không cross-answer, không starvation vô hạn, không auto retry quota, memory bounded.

### D4. P9 — Web providers và lời hứa về khả năng gốc

#### `P9-007` — Capability truth probe cho từng website (4 ticket con)
- **ID con:** `P9-CG7`, `P9-GM7`, `P9-CL7`, `P9-DS7`.
- **File:** `docs/providers/<provider>.md`, `tests/manual/provider-fidelity-checklist.md`.
- **Làm:** đo native UI, login, available tools, text, file, image, citation, download, native widget, automatic send/read (nếu hợp lệ); đánh dấu `MANUAL`, `REFERENCE_ONLY`, `AUTO_VERIFIED` riêng từng modality, kèm account mode, ngày test.
- **Test:** yêu cầu bất khả thi (plugin độc quyền không xuất) => nút open-native hoạt động và UI nêu rõ, không tạo bản sao giả.

### D5. P10–P11 — Nghiệm thu thực tế, cập nhật và tài liệu

#### `P10-013` — Cross-provider acceptance journey
- **File:** `tests/e2e/union-bot-team-journey.spec.ts`, `reports/qa/TEAM_JOURNEY_EVIDENCE.md`.
- **Làm:** owner tạo task với tệp, Antigravity thay đổi source, Codex đọc và test, owner mở web provider rồi đưa artifact vào room, ChatGPT Leader nhận packet qua kênh thật và phát fix plan, Antigravity áp dụng, kiểm thử lại.
- **Test:** xác định **mỗi chuyển giao** là automatic/manual, được phép/không, có file bytes/hash và receipt; không chấp nhận chỉ screenshot một phòng chat có 6 avatar.

#### `P10-014` — Security adversarial multi-profile & context leak
- **File:** `tests/security/identity-isolation.spec.ts`.
- **Làm:** kiểm thử account X/Y của cùng dịch vụ, project A/B, remote HTML, prompt injection trong README/AI reply, malicious MCP metadata, file symlink/junction, renderer IPC spoofing, egress without consent.
- **Test:** không chéo session, không leak local file/token, lệnh bên ngoài không thể tự nâng quyền.

#### `P11-011` — Safe/manual update + rollback contract
- **File:** `docs/user/UPGRADE_ROLLBACK_VI.md`, `tests/e2e/upgrade-rollback.spec.ts`.
- **Làm:** cập nhật offline hoặc qua file release được user xác thực; có backup DB/schema, compatibility version, rollback path an toàn. Không cần triển khai auto-update server hay remote updater cho bản 0đ.
- **Test:** từ bản A lên B, giữ projects/sessions theo khả năng nền tảng, artifact hashes; failure giữa migrate không phá dữ liệu. Rollback DB chỉ khi tương thích hoặc dùng backup.

#### `P11-012` — Union Bot brand & final claims audit
- **File:** `reports/release/BRAND_AND_CLAIMS_AUDIT.md`.
- **Làm:** tên sản phẩm, installer, About, docs, icons, version; so sánh T0–T3 với thực tế; công bố danh sách kênh manual-only; miễn phí thật theo cost manifest.
- **Test:** fresh Windows install, log nguồn thật, không câu marketing "6 AI tự động" khi evidence chưa đạt.

## E. CÁC BÀI KIỂM THỬ MỚI PHẢI ĐƯỢC ĐĂNG KÝ TRONG UAT

| Test ID | Tình huống | Tiêu chuẩn pass |
|---|---|---|
| `UAT-031` | Ảnh thật ChatGPT/Web export → shared room → local agent | Bytes và SHA khớp; nếu chỉ screenshot, label đúng `screenshot_only` |
| `UAT-032` | Tệp PDF + lời giải markdown + native interactive widget trong một reply | Giữ từng part và fidelity; widget không hỗ trợ chỉ mở native, không giả là interactive |
| `UAT-033` | Provider nhận long context đã lược bớt | Có manifest phần gửi/bỏ; không rò context room khác |
| `UAT-034` | Codex review SHA A; Antigravity sửa sang SHA B | Review của SHA A không duyệt SHA B; phải review lại |
| `UAT-035` | Hai phòng đồng thời gửi cùng một provider | Đúng reply/thread/correlation; không trộn nội dung |
| `UAT-036` | Một web provider quota/login hết hạn lúc thảo luận | UI hiện giới hạn, không tự đổi account hoặc dùng billable API |
| `UAT-037` | App chết sau khi gửi tác vụ chưa nhận ACK | Trạng thái UNKNOWN; không tự gửi lại tác vụ có side effect |
| `UAT-038` | Clipboard/manual file chuyển từ AI web | Provenance `user_manual`; không mạo danh live capture |
| `UAT-039` | Hai account cùng provider, project A/B | Cookie/session/attachments không chéo; không egress trái consent |
| `UAT-040` | Nhận packet R01 → Leader review → FIX PLAN → R02 | Issue IDs traceable, source SHA, before/after logs; không fake reviewer |
| `UAT-041` | Installer `Union Bot` nâng cấp profile legacy | App data/account/session không mất do đổi brand; backup/restore pass |
| `UAT-042` | Bấm tải/export tool/plugin proprietary không hỗ trợ | Thông báo limitation + native link; không fake phần tử |

## F. ĐIỀU KIỆN XÁC NHẬN KẾT NỐI TRỰC TIẾP CHATGPT LEADER

Một tin nhắn "Antigravity đã kết nối" hoặc đưa văn bản vào phiên chat **chưa đủ** để chứng minh máy local có kênh gửi/nhận source tự động và liên tục. Chỉ đánh `DIRECT_REVIEW_TRANSPORT_VERIFIED` nếu:

1. Có transport xác định (manual relay cũng được, nhưng phải gắn label `MANUAL_RELAY`).
2. Auth sender/recipient, source SHA, round/correlation ID, append-only event record.
3. ChatGPT có thể đọc **mã nguồn thật** theo quyền được cấp (GitHub accessible hoặc archive attached), không chỉ lời mô tả của agent.
4. File `REVIEW_FIX_PLAN_Rxx.md` thật quay về đúng workspace, hash checked, không kích hoạt tool ngoài ý muốn.
5. Duplicate packet, missing attachment, wrong SHA, timeout, stale review có kết quả rõ.

Khi Agent nộp một vòng review, Leader sẽ xác định phạm vi chứng cứ; không có source thì `REPORT_REVIEW_ONLY`, không ghi code audit completed; không chạy test trên Windows thì phân biệt `LOG_INSPECTED` với `EXECUTED`.

## G. HƯỚNG DẪN ANTIGRAVITY PHẢI LÀM NGAY TRONG P0

1. Đọc V3.0 và addendum V3.1 này, đưa toàn bộ các ID ở mục D vào `TASK_BOARD.md` với `phase`, `dependencies`, `owner`, `acceptance`, `evidence_path`, `status`.
2. Bắt đầu `P0-001..012` như V3.0; đồng thời thực hiện `P0-013..018`; không cần chờ thêm review để inventory/verify/spike an toàn.
3. Trước khi viết code mới: trả lời `KEEP / WRAP / REFACTOR / RETIRE` cho mỗi module legacy, kèm test và chứng cứ.
4. Sau khi hoàn thành P0, nộp **`REVIEW_PACKET_R01.md`** cùng `SOURCE_MANIFEST`, repo snapshot/commit hash (nếu cho phép), audit reports, live probe logs redacted, cost/policy matrix, raw test command/exit codes, screenshot khi phù hợp, `TASK_BOARD.md`.
5. Báo cáo bằng 4 trạng thái khác nhau: **`VERIFIED_LIVE`, `VERIFIED_MANUAL`, `BLOCKED_EXTERNAL`, `NOT_TESTED`**. `PASS_MOCK` là một cột kiểm thử nội bộ, **không tương đương** `VERIFIED_LIVE`.
6. P0 gate chỉ được chốt sau khi ChatGPT Leader nhận đúng packet và rà soát; nếu thiếu source/evidence, review decision phải là `CHANGES_REQUIRED` hoặc `INSUFFICIENT_EVIDENCE`.
7. Sau review ChatGPT trả **`REVIEW_FIX_PLAN_R01.md`**; Antigravity sửa, Codex test, nộp `R02`. Lặp theo hợp đồng V3.0.

### Lệnh nguyên văn dùng trong nhóm

> Antigravity: triển khai **Union Bot** dựa trên `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md` và `UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md`. Khởi động P0 ngay, thêm tất cả ticket bổ sung, không thay code khi chưa baseline audit. V3.0 vẫn là kiến trúc và roadmap chuẩn; V3.1 chốt tên Union Bot, độ trung thực đa phương thức, giao thức chuyển giao giữa AI, tiêu chuẩn nhận diện review thật, release tiers. Tuyệt đối không fake live status, không phát sinh phí, không remote push/merge khi thiếu PO authorization cụ thể. Kết thúc P0 bằng `REVIEW_PACKET_R01.md` có nguồn code, diff, log, capability matrix, test evidence và bug list, gửi để ChatGPT Leader review độc lập.

---

**Kết luận Technical Leader:** `GO_P0_WITH_V3_1_ADDENDUM`. V3.0 là nền vững nhưng còn khoảng trống để *khóa chất lượng sản phẩm*; các ticket mới bên trên là điều kiện bổ sung, không có chỉ thị viết lại phần đã hoàn chỉnh. Không có tuyên bố nào ở đây đồng nghĩa code hoặc live six-provider đã được reviewer kiểm thử.