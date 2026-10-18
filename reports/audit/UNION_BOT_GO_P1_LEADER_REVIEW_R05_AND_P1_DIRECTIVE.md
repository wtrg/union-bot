Union Bot Go P1 Leader Review R05 and P1 Directive
UNION BOT — OFFICIAL GO_P1 DECISION & PHASE P1 IMPLEMENTATION DIRECTIVE

Document: UNION_BOT_GO_P1_LEADER_REVIEW_R05_AND_P1_DIRECTIVE.md
Review round: R05 (đối chiếu gói bàn giao R04)
Date: 2026-10-18, Asia/Ho_Chi_Minh
Repository: 
https://github.com/wtrg/union-bot
Branch: main
Pinned reviewed commit: c2d329edb925ecbbab9b707ab6042550e656a7a7
Diff base: 8defe3f05c323a039fbedbbe78424bf644b531eb
Independent reviewer: ChatGPT — Technical Leader
Implementation owner: Antigravity
QA lead: Codex
Decision: GO_P1 — APPROVED WITH TRACKED P1 SECURITY DEBT
Important: This is a phase-entry approval, not a production/security certification or an independent Windows execution attestation.

0. PHẠM VI REVIEW VÀ TÍNH XÁC THỰC

Reviewer đã sử dụng GitHub connector để truy cập trực tiếp source tree, commit và diff của repository tại SHA cố định; đã đọc REVIEW_PACKET_R04.md, TASK_BOARD.md, EGRESS_BOUNDARIES.md, Electron spike, Cost Guard source và tests, Python scanner/harness và các unit tests, TAP log, source manifest, hồ sơ browser. HEAD của main khớp SHA được bàn giao. Commit mới có 64 tracked files, gồm Electron spike, root pnpm-lock.yaml và các test bổ sung. Không có GitHub status checks xác nhận CI đối với SHA này.

Các mức chứng cứ không được đánh đồng:

SOURCE_VERIFIED: Reviewer kiểm tra thấy code, diff, test và cấu trúc ngay tại SHA GitHub.
TEAM_EXECUTED_LOG_INSPECTED: Nhóm báo cáo đã chạy trên Windows; reviewer đọc báo cáo/log lưu trong repo. Không đồng nghĩa reviewer tự chạy.
REVIEWER_EXECUTED: Không áp dụng cho toàn bộ bộ test Windows ở lần review này. Môi trường reviewer không kết nối tới desktop Windows của nhóm; phiên container không truy cập mạng GitHub trực tiếp để clone.
CAPABILITY SPIKE: Chỉ chứng minh một tính năng trong phạm vi spike. Không suy diễn thành sản phẩm v1.0 hay khả năng full-auto 6 AI.

Nguồn log reports/qa/RAW_TAP_OUTPUT.txt ghi 25/25 TypeScript tests passed (17 cost-guard + 8 artifact-store). 9 Python unit tests (4 scanner + 5 Codex harness) là kết quả nhóm báo cáo riêng; không cộng chúng vào số của riêng TAP log. Không có bằng chứng một suite CI tổng hợp 34/34 do reviewer tự chạy. Electron report xác nhận did-finish-load/title; chưa chứng minh đăng nhập hoặc gửi prompt ở bốn provider.

1. QUYẾT ĐỊNH CHÍNH THỨC

GO_P1: APPROVED. P0 đã cung cấp thông tin đủ để bắt đầu và đóng gate khảo sát: legacy baseline được ghi trung thực là 118 failed/errors, AGY/Codex có live spike theo báo cáo, browser Electron proof-of-concept có mã nguồn và report, CAS có test, giới hạn 0đ/ToS được nêu thành kiến trúc và các giả định chưa kiểm chứng được nhận diện.

Điều kiện quản trị:

TASK_BOARD.md: đổi cấp pha P0 sang GATE_ACCEPTED_WITH_CARRYOVER, không ghi 18/18 công việc technically verified. Giữ trạng thái lịch sử của P0-003 là BASELINE_CAPTURED_FAIL (test cũ 118 failures, đầu ra khảo sát đã đạt); P0-008 là MINIMAL_SPIKE_ACCEPTED / PRODUCT_INTEGRATION_P1_P4, P0-012 thành LEADER_GO_P1_ISSUED. Số liệu 16/18 chỉ là thống kê ticket riêng, không còn là cơ chế chặn chuyển pha.
Việc P0 được chấp nhận không biến P1/P2 admission/adapter policy, provider login, six-AI auto debate, release T1+T2, Windows installer thành hoàn thành. Giữ tất cả là NOT_IMPLEMENTED, PARTIAL, hoặc NOT_VERIFIED đúng thực tế.
Các issue an toàn dưới đây là BLOCKING đối với GO_P2 và việc sử dụng web AI bằng tài khoản/thông tin thật, nhưng không chặn bắt đầu P1.
Antigravity không tự push/merge trái giới hạn cho phép trước đây; reviewer chỉ đọc và tạo tài liệu local, không thay đổi repo trong lượt này. Tiếp tục chi phí dịch vụ 0đ, không cài paid API/billing key.
2. ĐỐI SOÁT 7 ISSUE R04
Issue	Review verdict tại SHA c2d329e	Nguồn	Quyết định
UB-R04-001 Egress claims	P0 scope resolved / implementation carried forward. Đã có EGRESS_BOUNDARIES.md giải thích best-effort hooks; L1/L2 mới chỉ được thiết kế, chưa chạy trong orchestrator	docs/security/EGRESS_BOUNDARIES.md, cost-guard.ts	Đóng yêu cầu hạ claim P0; chuyển implementation thành P1/P2 blocker
UB-R04-002 Electron spike	Spike accepted with evidence limitations. Có main.js, probe-providers.js, 4 origin report, partition A/B, popup synthetic test. Chưa có login/manual share production	spikes/electron-browser/*, ELECTRON_BROWSER_SPIKE.md	Đóng P0 feasibility spike; security hardening P1/P4
UB-R04-003 Manifest	Resolved. 64 file được liệt kê đúng số GitHub tree; dùng reviewed SHA/base thay cho quine HEAD tự nhúng	SOURCE_MANIFEST.txt	Closed
UB-R04-004 P0-003 baseline	Resolved for historical truth. Board ghi đúng 118 failed/errors, 94 warnings, tách P0-003-SEC	TASK_BOARD.md, BASELINE_TESTS.md	Closed; chỉnh pha sau GO_P1
UB-R04-005 Secret scanner	Partially resolved. Không còn raw line preview, có strict/errors và unit tests; nhưng logic is_safe_triage có false-safe có thể bỏ qua secret thật	scan_secrets.py:78-92	Carry over UB-P1-SEC-002; bắt buộc sửa trước secret scan gate
UB-R04-006 Codex harness	Materially improved. Worker queue, timeout, turn matching, tests; nhưng evidence dump chưa redact và vẫn shell=True; cần hardening	test_codex_full_rpc.py:36-43,220-227	P0 spike accepted; carry over UB-P1-SEC-004
UB-R04-007 Evidence counts	Accepted with scope. Có raw TAP 25/25 + báo cáo 9 Python tests, nhãn nguồn và live	RAW_TAP_OUTPUT.txt, REVIEW_PACKET_R04.md	Closed with evidence taxonomy
3. DANH SÁCH ISSUE BẮT BUỘC CHO P1 (KHÔNG MỞ LẠI P0)
UB-P1-SEC-001 — S1/HIGH: Ngăn Electron mở protocol/URL nguy hiểm & kiểm soát popup đúng WebContentsView

Nguồn xác định:

spikes/electron-browser/main.js:21-26: mainWindow.webContents.setWindowOpenHandler() gọi thẳng shell.openExternal(url) không có scheme/host validation. Handler được gắn vào BrowserWindow, không gắn view.webContents chứa provider.
spikes/electron-browser/probe-providers.js:83-87: handler của testView cũng gọi shell.openExternal(url) không lọc scheme; các provider view khác không có handler này.

Nguy cơ: External protocol như file:, javascript:, custom OS URI handler hoặc liên kết bên ngoài không được user phê duyệt có thể mở handler ngoài dự kiến. Đây là phát hiện từ code path; chưa có bằng chứng khai thác xảy ra.

Yêu cầu sửa:

Viết helper safeOpenExternal(candidate, sourceProvider, userGesture) ở Electron main trusted process. Parse URL, allow https: và (nếu thật cần) http: với UX xác nhận; mặc định deny file:, javascript:, data:, vbscript:, shell:, ms-*, credential-in-URL, local/private targets ngoài allowlist. Không chỉ regex startsWith('https').
Gắn setWindowOpenHandler() lên mọi provider view.webContents; trả {action:'deny'} ngay. Với liên kết external được phê duyệt mới gọi shell.openExternal; tuyệt đối không đưa URL tùy ý từ untrusted page sang native handler.
Dùng will-navigate/will-redirect phù hợp để hạn chế main-frame navigation sang origin không mong muốn; OAuth/external auth phải có strategy rõ ràng (fallback browser nếu provider không cho embedded auth).
Tạo test trên provider view thật: HTTPS external cần confirm, file: và custom scheme bị deny và openExternal không được gọi; no popup child view sống sót.
Đặt sandbox: true, nodeIntegration:false, contextIsolation:true, không preload privileged, kiểm soát permissions/downloads.

Acceptance: không có lệnh gọi shell.openExternal với scheme không hợp lệ, kể cả khi link phát sinh từ provider; kiểm thử popup thực trên view; không tự mở HTTP/S external chưa được duyệt; unit + Electron smoke PASS. Blocker trước live login/use.

UB-P1-SEC-002 — S1/HIGH: Secret Scanner không được auto-safe chỉ theo tên thư mục hoặc chuỗi mock

Nguồn xác định: scan_secrets.py:78-92:

Python
if "test" in lower_path or "mock" in lower_path or "doc" in lower_path or "fixture" in lower_path or "report" in lower_path:
    return True

Nguy cơ: Một credential thật xuất hiện trong tests/, docs/ hoặc reports/ bị đánh dấu triaged_safe và không làm --strict thất bại. Việc mẫu chứa chữ test không chứng minh đó là token giả. Ngoài ra TARGET_EXTENSIONS chưa hỗ trợ .env.local, .env.production do Path.suffix chỉ trả .local/.production. Tài liệu SECRET_SCAN_REPORT.md ghi findings=14 nhưng bảng liệt kê 15 hàng và unresolved=8 dù kết luận 0 leak.

Yêu cầu sửa:

Bỏ mọi auto-safe dựa trên path/substring không có bằng chứng. Mặc định mọi finding là unresolved; chỉ mark safe bằng danh sách fixture đã định danh chính xác (path + rule + digest/constant), lý do, người duyệt, ngày; không tự safe theo tên thư mục.
Trong --strict, unresolved > 0 hoặc scan_errors > 0 => exit !=0, không dựa confirmed_leaks (hiện luôn được gán 0).
Hỗ trợ .env.*, .npmrc, *.pem, *.key, credentials.* và git diff --cached/history ở pre-commit. Với file binary, ít nhất phát hiện và báo chưa quét; không khẳng định quét hết.
Không log secret đầy đủ hoặc prefix/suffix dài; có thể dùng fingerprint hash có salt của match để tham chiếu, không lưu raw lines.
Đồng bộ SECRET_SCAN_REPORT.md: findings 14/15? unresolved 8 chưa thể gọi '0 leaks verified'; sửa thành 0 confirmed, 8 unresolved, chỉ khi triage độc lập hoàn tất mới được kết luận no confirmed leaks in scan scope.

Regression tests: secret giả có định dạng thực trong tests/live_key.txt, docs/notes.md phải tạo unresolved; .env.local được quét; unreadable file/invalid root => strict FAIL; benign fixture allowlist đúng mới safe. Blocker trước mọi git push tiếp theo nếu scanner được dùng làm bảo đảm an toàn.

UB-P1-SEC-003 — S1/HIGH: Screenshot “scrubbed” chưa có thao tác redact thật

Nguồn xác định: spikes/electron-browser/probe-providers.js:149-160 lấy capturePage().toPNG() rồi ghi file trực tiếp dưới tên *_scrubbed.png. Không có xử lý redact/crop/blur. spikes/electron-browser/README.md cũng gọi ảnh là “đã scrub”.

Nguy cơ: Nếu provider đã đăng nhập, screenshot có thể chứa email/avatar/prompt/lịch sử riêng tư. File ở scratch bị ignore chưa chứng minh không bị upload bằng cách khác.

Yêu cầu sửa: bỏ suffix _scrubbed nếu không redact; mặc định --no-screenshot cho profile đăng nhập; dùng fixture/test profile không có dữ liệu riêng; nếu có redaction thật phải chạy trên buffer/region trước khi ghi; không khẳng định đã scrub. Chỉ upload bản đã review không chứa PII.

Acceptance: unit check redact hoặc no-capture cho live profiles; git status --short và artifact manifest không chứa screenshot nhạy cảm; report minh bạch.

UB-P1-SEC-004 — S2/MEDIUM: Codex live evidence chưa redact và process spawning cần an toàn hơn

Nguồn: test_codex_full_rpc.py:36-43 dùng subprocess.Popen([...], shell=True); :220-227 tạo scrubbed_messages bằng việc append nguyên bản msg, sau đó serialize toàn bộ JSON. Tên scrubbed không đúng.

Yêu cầu: dùng direct argv execution (shell=False) đúng Windows; giải quyết tên .cmd/.exe qua đường dẫn đã xác minh; stderr được drain hoặc có bounded buffer tránh pipe deadlock; dùng time.monotonic(); scrub JSON schema-aware, allowlist fields hoặc redact token/PII từ message content trước khi ghi; tránh ghi model responses/user data không cần thiết. Kiểm tra turn/completed có terminal status rõ, không mặc định completed khi field thiếu, text assertion nên so khớp chính xác theo test fixture. Không đưa raw live logs vào Git.

Tests: synthetic JSON chứa token/email phải được redact; failed status thiếu => FAIL; malformed notification => FAIL; daemon bắn stderr lớn không treo; timeout kill clean; executable path contains spaces.

UB-P1-QA-005 — S2/MEDIUM: Electron probe exit code và evidence fidelity

Nguồn: spikes/electron-browser/probe-providers.js:165-175 coi có title là ELECTRON_RENDERED ngay cả khi did-fail-load; :223-228 catch fatal chỉ in lỗi, cuối cùng app.quit() mặc định không set thất bại. Raw scratch/electron-probe/electron_probe_report.json và screenshots không nằm trong Git; báo cáo là team executed, chưa được independently replay.

Yêu cầu: explicit passed theo provider + acceptance threshold; did-fail-load chính frame => fail hoặc auth-gate, không mặc định render; timeout per provider; process.exitCode=1 nếu mất test bắt buộc/exception; report có SHA, runtime, mode, screenshot checksum (nếu ảnh được phép), timestamp, session profile synthetic. Không đánh đồng tải trang login với đăng nhập thành công hoặc có khả năng gửi prompt.

Tests: intentionally invalid origin => exit !=0; four-origin matrix được render, AUTH_REQUIRED phân biệt với READY; isolated cookie A/B + same-provider account A/B ở P4.

UB-P1-ARCH-006 — S2/MEDIUM: Lớp Cost Guard chính thức phải được wire, không chỉ có interceptor export

Nguồn: docs/security/EGRESS_BOUNDARIES.md xác nhận Admission Gate (lớp 1), Adapter Action Gate (lớp 2) là kế hoạch P1/P2; không có apps/desktop/ hay packages/orchestrator/ triển khai thực tế tại reviewed SHA. installElectronCostGuardInterceptor() chỉ là function export, không có lifecycle wiring.

Yêu cầu: P1 tạo Electron main dùng CostGuard cho từng session (và default session), policy deny-before-dispatch; P2 triển khai AdmissionPolicyGate, lớp định nghĩa action allowlist/unknown-cost reject; P6/P7 bind đến child process spawn; điện toán/web API paid bị disable. Tránh hứa interception ở OS/child process. Xét rủi ro redirect/proxy/new sessions/child processes. Do not use or require billing credentials.

Tests: startup chưa cài hook => fail startup/preflight, unit negative paid URL, custom partition, redirect/unknown domain, provider manual share; spawn paid adapter deny, external CLI not claimed under local hook.

UB-P1-QA-007 — S3/LOW: Hồ sơ acceptance/counters cần cập nhật ngay khi bắt đầu P1

Nguồn: TASK_BOARD.md còn P0 ACTIVE (P1_ALLOWED), P0-012 IN_PROGRESS, P0-008 CARRY_OVER_P1 và SOURCE_MANIFEST không nhúng live HEAD (đúng chiến lược chống tự quy chiếu). RAW_TAP_OUTPUT có 25/25 JS/TS, không phải 34/34 trong cùng một log.

Yêu cầu: ghi quyết định Leader GO_P1 + reference tới file này, P0 gate accepted with carryover, P1 ACTIVE; P0-003 giữ historical 118 failures. Mọi report sau phải có bảng TS/JS vs Python vs live integration, SHA/base và mức evidence. Không tự phong REVIEWER_EXECUTED cho test nhóm.

4. P1 — THỨ TỰ LÀM VIỆC BẮT BUỘC
Wave 1 — Security-preflight & root monorepo
Implement UB-P1-SEC-001, 002, 003 trước khi chạy browser trên profile có thông tin thật hoặc dùng scanner làm pre-push gate.
P1-001: khóa packageManager, Node LTS, pnpm lockfile tại root; quyết định một lockfile canonical, spike lockfile chỉ dùng trong spike nếu tách rõ, tránh double installation.
P1-003/004: tsconfig strict, lint, typecheck, format:check và pnpm verify exit !=0 nếu test fail. Cấm hardcode absolute path D:\WORK-TEAM trong production code.
P1-007/009: wire Cost Guard cho Electron main, thêm pre-commit secret scan thật và negative fixture test; không chỉ document spec.
Wave 2 — Desktop/UI foundation
P1-002/005: apps/desktop Electron main/preload/renderer; entrypoint một lệnh pnpm dev, run offline không cần tài khoản AI.
P1-003: apps/workspace-ui React+Vite+Tailwind với màn hình project, room placeholder, error/loading/no-auth states rõ, ghi nhãn DEMO nếu mock.
P1-006: packages/orchestrator skeleton với protocol schemas và policy DENY_UNKNOWN mặc định; không cần hoàn thiện event sourcing của P2.
P1-005/007: link @union-bot/artifact-store và @union-bot/cost-guard vào workspace; integration test import thật package từ desktop.
P1-006: Windows single-instance app lifecycle, local paths theo app.getPath('userData'), never load provider content with nodeIntegration.
P1-011: tên Union Bot trên window/package metadata, icon hợp lệ; không dùng auto-updater có network side-effects.
Wave 3 — Reproducible build/QA
Build sạch từ git clone, pnpm install --frozen-lockfile, pnpm build, pnpm typecheck, pnpm lint, pnpm test.
Chạy Electron GUI smoke trên Windows thật ở DPI thường và high-DPI: resize, reload, close/relaunch, sandbox/preload, popup deny, network cost guard, basic startup offline.
Chạy 34 Python+TypeScript tests theo đúng từng công cụ; thêm các negative tests bảo mật đã liệt kê.
Có lệnh scripts/verify.ps1 gồm các bước fail-closed, log scrubbed và exit code chính xác.
Xuất reports/handoff/REVIEW_PACKET_P1_R01.md, TASK_BOARD.md mới, reports/qa/ log tối thiểu và SHA source mới. Không rename/đánh tráo các R01-R04 lịch sử.
5. P1 GATE — ĐIỀU KIỆN CHẤP NHẬN GO_P2
Fresh clone reproducibility: install offline cache/online free dependencies bình thường, pnpm install --frozen-lockfile, pnpm verify PASS trên Windows, không cần billing key.
Desktop launch real: pnpm dev mở Union Bot window, không blank screen, restart được, chỉ một main instance; không dùng mock để suy ra AI connected.
UI/IPC sandbox: renderer không có arbitrary Node access; origin/IPC allowlist và CSP; untrusted provider pages không dùng privileged preload.
Network cost: Electron partition/default session đều đi qua policy; admission denies paid/unknown adapters; chỉ có explicit permission mới thực hiện operations có side-effects; no paid endpoint traffic trong negative test.
Security blockers: UB-P1-SEC-001, 002, 003 phải PASS trước thử live web account hoặc push tiếp khi scanner là safety gate. UB-P1-SEC-004 và UB-P1-QA-005 phải có patch/test hoặc documented P2 carryover được Leader đồng ý.
Health/verification: pnpm test, Python tests, pnpm lint, pnpm typecheck, pnpm build và Electron smoke có lệnh, exit code, kết quả, lỗi đã phân loại; log nguồn được redact. RAW_TAP_OUTPUT.txt không đại diện thay cho Python tests.
Artifact/CAS: import PNG/PDF fixture qua public package interface, SHA byte-accurate, no traversal; P2 mới harden atomicity/metadata.
Docs: TASK_BOARD phase P1 đúng trạng thái, provenance live vs mock, README Windows chạy thật, inventory files/sha, open issues nêu rõ giới hạn.

Mặc định GO_P2 = NOT APPROVED cho đến khi có review packet P1 và review độc lập khác. Gate P1 không đòi full-six-AI, full orchestrator, installer hoặc multi-user P4 trước thời điểm đó.

6. VẤN ĐỀ CẤM TỰ TUYÊN BỐ/ĐỔI TÊN
Không nói 7/7 resolved, 100% secure khi vẫn có bug shell.openExternal và secret scanner false-safe.
Không gọi screenshots trong scratch là “scrubbed” khi code chỉ ghi raw PNG. Không đưa screenshot của tài khoản thật lên public GitHub.
Không gọi ELECTRON_RENDERED là đã đăng nhập hay AI sẵn sàng xử lý prompt. Claude /login và DeepSeek /sign_in được ghi là LOGIN_REQUIRED.
Không gọi Cost Guard in-process là firewall hoặc bảo đảm 0đ với bất cứ binary/agent bên ngoài nào. Không tự sử dụng tài khoản trả phí, trial, API tính tiền.
Không được tự tuyên bố GO_P2; GO_P1 này là duy nhất và gắn SHA c2d329e....
Không bắt buộc thay đổi mục tiêu T1 + T2. T3 tự động hóa 6 AI vẫn không thuộc nghiệm thu v1 nếu không có cơ chế chính thức/miễn phí/hợp lệ.
7. TEMPLATE REPORT P1 GỬI CHATGPT LEADER
Markdown
# UNION BOT — REVIEW_PACKET_P1_R01
- Base review SHA: c2d329edb925ecbbab9b707ab6042550e656a7a7
- Submitted full SHA: <git rev-parse HEAD>
- Branch: <name>
- Working tree clean: <yes/no>
- Change summary: <git diff --stat base..head>
- P1 tickets / status: <table>
- Security blockers UB-P1-SEC-001..004 / tests / paths: <table>
- CI + Windows GUI + Python/TS tests: <commands, exit codes, versions, log paths>
- Evidence taxonomy: SOURCE_VERIFIED / TEAM_EXECUTED_LOG_INSPECTED / BLOCKED_EXTERNAL
- Known gaps: <explicit>
- Claims excluded: <no automated 6-AI / no paid API / no unsupervised push>
- Ask reviewer: GO_P2 or REVIEW_FIX_PLAN_P1_R01.md
8. LEADER DIRECTIVE (CÓ THỂ COPY GỬI CHO ANTIGRAVITY)

Antigravity + Codex: Technical Leader đã truy cập và review commit c2d329edb925ecbbab9b707ab6042550e656a7a7, ban hành GO_P1 chính thức. Đóng P0 ở trạng thái GATE_ACCEPTED_WITH_CARRYOVER, không tự nhận 18/18 live functionality. Bắt đầu P1 Monorepo Foundation & Toolchain ngay theo Master Plan V3.0 + Addendum V3.1. Ưu tiên sửa các lỗi UB-P1-SEC-001 (shell.openExternal untrusted view), UB-P1-SEC-002 (scanner false-safe), UB-P1-SEC-003 (screenshot raw bị gọi scrubbed); sau đó hoàn thiện bootstrap, chính sách 0đ, desktop, CI và test Windows. Giữ việc cần làm P2/P4 đúng pha, không fake completion, không dùng paid API, không auto push/merge ngoài quyền được Product Owner ủy quyền. Nộp packet P1 với SHA mới và bằng chứng khi xin GO_P2.

9. KẾT LUẬN VÀ GIỚI HẠN PHÊ DUYỆT
P0 gate: ACCEPTED_WITH_TRACKED_CARRYOVER.
Transition: GO_P1 — chính thức cho phép triển khai P1 và sửa các security issue được chuyển pha.
Deployment: NOT_READY_FOR_REAL_USER_DATA_OR_RELEASE cho đến khi chặn các vấn đề S1 nêu trên.
Final product: NOT_COMPLETE; release T1 + T2 vẫn là roadmap P1–P11.
Independent scope: Source inspection + team-provided logs; reviewer không chạy được Electron Windows hoặc Codex local trong lần này.

Signature: ChatGPT — Technical Leader / Independent Reviewer, review round R05, anchored to exact commit SHA above.