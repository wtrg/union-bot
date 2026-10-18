# UNION BOT — TECHNICAL LEADER / INDEPENDENT REVIEW R04


**Tài liệu:** REVIEW_FIX_PLAN_R04_8DEFE3F.md **Ngày:** 2026-10-18, Asia/Ho_Chi_Minh **Repository:** https://github.com/wtrg/union-bot **Branch:** main **Reviewed HEAD (đã xác minh GitHub):** 8defe3f05c323a039fbedbbe78424bf644b531eb **Diff base:** 29d841a360f06217ec1a6866a2979fdb52344535 **Reviewer:** ChatGPT — Technical Leader / Independent Reviewer **Implementer:** Antigravity; **QA:** Codex **Quyết định:** CHANGES_REQUIRED / P0_GATE_OPEN / P1_IMPLEMENTATION_ALLOWED_WITH_NO_P1_SIGNOFF **Không được ghi nhận:** GO_P1, P0_100_PERCENT_VERIFIED, ZERO_COST_100_PERCENT_EGRESS_PROTECTED, SIX_PROVIDER_EMBEDDED_VERIFIED. 

## A. Kiểm chứng độc lập đã thực hiện và giới hạn


Đã truy cập GitHub và khóa đúng SHA HEAD; so sánh hai commit mới sau 29d841a: TASK_BOARD.md, docs/COST_MANIFEST.md, packages/cost-guard/src/cost-guard.ts, packages/cost-guard/tests/cost-guard.test.ts, reports/handoff/SOURCE_MANIFEST.txt. Đã đọc module, test, hồ sơ P0, bản MASTER PLAN V3.0. Cây source HEAD hiện có 51 file được GitHub liệt kê, **không có Electron shell, apps/desktop hay spikes/electron-browser** , chưa có pnpm-lock.yaml (lockfile thuộc P1, không là P0 blocker). 

Kiểm tra source đếm được **14 lời gọi test() tại Cost Guard và 8 lời gọi test() tại Artifact Store (22)** . Tuyên bố **22/22 PASS + 1 integration PASS** là kết quả *implementation/QA tự báo cáo* ; tại lượt review này tôi **không chạy suite Windows trên máy của implementer** , không có raw TAP độc lập và không có bằng chứng CI status (combined statuses rỗng ở bản commit trước). Tôi không phê duyệt LIVE_EXECUTED_BY_REVIEWER chỉ dựa vào số liệu báo cáo. 

**Đã ghi nhận sửa đúng hướng:** guard có thêm http2.connect và net.Socket.prototype.connect; regex SHA256 được validate khi đọc CAS; Python TLS probe không còn CERT_NONE; Codex harness đã gửi thread/start và turn/start, report có log nhận turn/completed. Những phần này KHÔNG yêu cầu viết lại chỉ để tăng số ticket. 

## B. Issue register tại commit 8defe3f


### UB-R04-001 — S1 — Tuyên bố bảo vệ 100% toàn bộ egress/chi phí chưa đúng phạm vi


**Nguồn:** packages/cost-guard/src/cost-guard.ts:183–329; docs/COST_MANIFEST.md mục 3–4. 

**Đã quan sát:** 
- Wrapper đã can thiệp globalThis.fetch, Node HTTP(S) Agent, http2.connect, net.Socket.prototype.connect **trong một process Node** , và một hook Electron session.webRequest.onBeforeRequest được export. 
- Test mới chỉ xác minh http2.connect gọi theo API trực tiếp đến hai origin không được phép. **Chưa có test dành riêng cho raw net.Socket.connect, tls.connect, custom agents, API import/capture trước khi install, redirects, child process hoặc multi-install/uninstall.** 
- Process con chạy CLI/Python/curl, native library hay ứng dụng khác không tự nhận monkey-patch của process cha. HTTP2/Socket interception không thể là bằng chứng “100% toàn bộ network”/“không thể phát sinh chi phí”. Electron hook **chưa được gắn vào một Electron app thực trong repo** . 
- isUrlAllowed() là chính sách URL/host; nó **không** kiểm tra billing credential, phí phát sinh bởi hành động trong một tài khoản có đăng ký sẵn, hoạt động qua CLI bên ngoài, redirect nội bộ của fetch, hay policy ToS. 

**Cách sửa bắt buộc ở P0 (không cần viết firewall):** 
- Sửa tất cả claim thành: *best-effort in-process runtime guards + allow/deny policy; chưa chứng minh bao phủ mọi network stack hoặc mọi hoạt động bên ngoài process* . Không ghi 100% egress blocked nếu không có bằng chứng phù hợp. 
- Thiết kế tài liệu docs/security/EGRESS_BOUNDARIES.md ghi: lớp một **admission policy trước spawn/dispatch** (paid_api_enabled=false, unknown_cost=deny, không tự dùng billing key, không tự upgrade); lớp hai per-adapter action gate; lớp ba in-process network hooks chỉ là defense-in-depth. 
- 
- 
- Thêm P1/P2 ticket để thực sự gọi admission gate **trước** spawn Codex/Antigravity/adapters và tạo Electron sessions; kể cả CLI có network riêng ngoài process thì chỉ cấp action đã được phép, không mô tả guard Node ngăn được toàn bộ. 

**Đóng issue:** Claim trung thực + threat matrix, không có đường thực thi paid adapter được mặc định bật; code và negative tests được nộp. End-to-end actual egress coverage được kiểm tại P1/P2/P10, không được tuyên bố hoàn thành trong P0. 

### UB-R04-002 — S1 — P0-008 chưa chứng minh Electron WebContentsView thật


**Nguồn:** MASTER PLAN V3.0 P0-008 ghi *“Electron shell thử 4 website; thử login trên user-controlled test profile; fallback”* . reports/capability-evidence/BROWSER_COMPAT.md chỉ có Python urllib HTTP/TLS probe. TASK_BOARD.md:P0-008 ghi GUI gate tại P2/P4 nhưng đánh VERIFIED_LIVE. 

**Cách xử lý tối thiểu, không dựng full UI:** 
- 
- Khởi động BrowserWindow và WebContentsView, sandbox:true, contextIsolation:true, nodeIntegration:false; **không cấp preload đặc quyền** cho provider pages; route navigation an toàn. 
- Lặp cho ChatGPT, Gemini, Claude, DeepSeek. Mỗi origin ghi did-finish-load, did-fail-load, một screenshot scrub (không lộ user info), trạng thái login/challenge **chỉ khi nhìn được thật** , và sự kiện fallback ra trình duyệt mặc định bằng hành động người dùng. 
- Chứng minh hai partition tách biệt bằng **fixture site/local profile được điều khiển bởi đội QA** ; không xuất cookie thật, không copy Chrome profile. Nếu website chặn embedded login, ghi BLOCKED_EXTERNAL, vẫn xem fallback có hoạt động không. 
- 

**Đóng issue:** Có source Electron spike + log/screenshot Windows scrub + 4 dòng verdict rõ và partition A/B test. Hoặc PO phê duyệt bằng văn bản chính thức chuyển P0-008 sang gate P1 và giữ nhãn CARRY_OVER, **không được tự ghi P0-008 VERIFIED_LIVE** . P4 vẫn chịu trách nhiệm trình duyệt sản phẩm đầy đủ. 

### UB-R04-003 — S2 — Source manifest còn stale


**Nguồn:** reports/handoff/SOURCE_MANIFEST.txt:3 ghi HEAD Commit SHA: 2e6608000aaf38ffb1a0ffec88d93b938be050fd; GitHub main thực tế tại review là 8defe3f05c323a039fbedbbe78424bf644b531eb. 

**Sửa:** Không thể nhét “chính SHA của commit chứa manifest” vào manifest rồi tạo commit mới mà vẫn gọi nó là HEAD — tạo vòng lặp tự quy chiếu. Chuẩn hóa source_review_sha = commit trước tài liệu handoff, branch_head_at_submission = giá trị ghi trong packet/tin nhắn sau khi push; minh bạch parent/HEAD. Sinh file manifest từ git ls-tree -r của **pinned source sha** , không tự báo “latest HEAD” trong blob sẽ bị thay khi commit. Kiểm git rev-parse HEAD tại lúc nộp packet. 

**Đóng:** GitHub source/packet review trỏ tới các SHA thật, không mâu thuẫn; test manifest có quy tắc self-reference rõ. 

### UB-R04-004 — S2 — Ticket P0-003 và baseline legacy bị mô tả sai


**Nguồn:** TASK_BOARD.md:P0-003 ghi Custom scanner executed (0 leaks); 20/20 legacy tests verified. Nhưng reports/qa/BASELINE_TESTS.md ghi **118 errors/failures, 94 warnings, exit 1** . P0-003 trong MASTER V3.0 là baseline test trước thay đổi, không phải bài scanner. 

**Sửa:** P0-003 = LEGACY_TEST_BASELINE_CAPTURED kèm kết quả FAIL (118 errors/failures, exit 1); tạo ticket khác cho secret scan. Không dùng 22 test hiện tại của hai package thay số 118 legacy. P0-012 giữ AWAITING_LEADER_APPROVAL cho tới sau review. Không tự cộng 18/18 nghiệm thu trước chữ ký reviewer. 

**Đóng:** Ticket board, baseline report, review packet và release gate khớp nhau; 118 legacy được lưu làm baseline lịch sử, không yêu cầu sửa hết trong P0. 

### UB-R04-005 — S2 — Secret scanner còn nguy cơ rò nội dung nhạy cảm vào log


**Nguồn:** scan_secrets.py:15–31,38–64; reports/audit/SECRET_SCAN_REPORT.md có tổng phát hiện 29 và 18 cùng tồn tại. 

**Chứng cứ:** preview: line.strip()[:100] đưa nguyên đầu dòng có thể chứa bí mật thật vào scratch/secret_scan_results.json. except Exception: pass bỏ qua lỗi đọc, không fail-closed. Skip if any(skip in root ...) có thể vô tình bỏ qua thư mục khác. Script không có bằng chứng quét Git history. Báo cáo “0 secrets” chỉ chứng minh đã triage kết quả scanner hiện tại, không chứng minh tuyệt đối. 

**Sửa:** 
- 
- 
- 
- 

**Đóng:** Scanner không tự tạo leak mới, report số liệu nhất quán, policy với Git history đúng phạm vi. 

### UB-R04-006 — S2 — Codex harness cần test pass/fail chính xác và timeout thật


**Nguồn:** test_codex_full_rpc.py (không thay đổi trong diff R04). Script proc.stdout.readline() blocking trong vòng while time.time()-start<45, nhưng một lần readline() có thể treo vô hạn. return True nếu nhìn thấy **bất kỳ** turn/completed mà không đối chiếu threadId, turnId, terminal status hoặc khẳng định agent text mong đợi; event ID được log None. 

**Sửa:** Queue reader thread hoặc asyncio/watchdog deadline; parse schema đúng phiên bản; lấy turn.id nested; assert 1 thread, 1 turn có ID, turn/completed đúng ID và terminal completed, output bằng UNION_BOT_CODEX_TURN_VERIFIED; lỗi khác ID/không có text/cancel/timeout => exit nonzero, terminate/kill child sạch. Lưu NDJSON đã scrub. 

**Đóng:** 5 test synthetic (pass, wrong turn, missing text, cancel, silent timeout) + một live test (hoặc BLOCKED_EXTERNAL ghi rõ do auth/quota); không coi exit code do proc.terminate() là Codex pass. 

### UB-R04-007 — S2 — Live evidence/test counts phải có mức tin cậy rõ


**Nguồn:** TASK_BOARD.md, REVIEW_PACKET_R03.md, docs/providers/CAPABILITY_MATRIX.md, docs/COST_MANIFEST.md. 

**Sửa:** Định nghĩa và áp dụng nhãn SOURCE_VERIFIED, TEAM_EXECUTED_LOG_INSPECTED, REVIEWER_EXECUTED, MOCK_TESTED, NETWORK_PROBE_ONLY, NOT_TESTED, BLOCKED_EXTERNAL. Số **14+8=22 test declarations** là source-verified; PASS/latency là team-reported cho đến khi có raw TAP, exit 0 và/hoặc reviewer chạy lại. Web→CAS avatar là public web binary fixture, KHÔNG phải hình AI sinh hoặc cross-AI handoff đầy đủ. Quota của Codex trong phiên planType:plus KHÔNG chứng minh Free tier có khả năng tương đương. 

**Đóng:** Có raw TAP scrub, phiên bản runtime, exit code và mapping ticket→evidence; hạ claims không có log. Không cần tích hợp web AI tự động trong P0. C. Điểm được chuyển sang pha sau, **không** làm P0 blocker 
- ArtifactStore hiện chặn traversal input ../ bằng SHA256; bảo vệ symlink/junction, atomic write, file already exists hash verification, provenance persistence, MIME verification và cleanup via after() hook nên được mở ticket **P5** . 
- TypeScript strict, package lockfile pnpm-lock.yaml, reproducible build, lint, Electron main/preload, Python/Node scripts cleanup, CI, NSIS installer là **P1/P11** , không ép hoàn thành trong P0. 
- Web-provider account/login/manual share end-to-end trong product thật là **P4/P9** ; P0 chỉ cần spike tương ứng. 
- 

## D. Quyền tiến hành P1 trong khi P0 chưa đóng


**P1_IMPLEMENTATION_ALLOWED_WITH_NO_P1_SIGNOFF** : Antigravity có thể **thực hiện P1-001..P1-010 trên branch/worktree phù hợp** theo quyền GitHub đã được PO cấp trước, đặc biệt P1-005 Electron starter giúp giải quyết P0-008, không chỉ nghiên cứu. Nhưng không được tự đánh dấu P0_COMPLETE, GO_P1 hoặc P1_SIGNED_OFF. Việc push/merge giữ nguyên quy tắc xác nhận từ PO đối với đích/nhánh nếu chưa có ủy quyền trước đó; không sử dụng API trả phí. 

Đây là quyền triển khai song song để tránh circular dependency *P0 đòi Electron trong khi Electron foundation ở P1* , **không phải thay đổi retroactive gate** . Đóng P0 vẫn đòi Electron spike hoặc PO chấp thuận điều chỉnh gate. 

## E. Thứ tự sửa / người phụ trách
|
|
| 1 — Core claims & traceability | Antigravity | UB-R04-001/003/004/007 | Status & manifests thật, CI/TAP proof |
| 2 — Minimal Electron spike | Antigravity | UB-R04-002 | Source, Windows screenshots, 4 provider verdicts |
| 3 — Security & Codex QA | Codex + Antigravity | UB-R04-005/006 | Scanner safe; live turn harness truth-tested |
| 4 — Review handoff | Antigravity | Nộp packet R04 mới hoặc R05, pin SHA | Full HEAD, files, raw logs scrubbed 

**Không làm:** lập project mới vô ích; xây full app P4 trong P0; bypass Cloudflare/ToS/CAPTCHA; monkey-patch cho ra cảm giác “100%” mà không có evidence; call paid APIs; ghi log bí mật; tự đóng issue khi thiếu test; force push/merge trái phép. 

## F. Checklist nghiệm thu GO_P1 chính thức

- **P0-008:** Electron WebContentsView chạy thực tế hoặc PO phê duyệt chuyển rõ sang P1/P4; trạng thái các provider phân loại đúng. 
- **P0-003:** Legacy baseline vẫn là 118 lỗi (báo cáo), không biến thành 20/20; board canonical mapping và evidence. 
- **Cost Guard:** hạ claim 100%; admission-gate spec & test; không tự động dùng paid/billing; rõ child process/TLS/HTTP2 limitations. 
- **Secret scan:** không xuất raw preview, có thống kê lỗi/tổng và triage nhất quán, chạy scope repo đúng. 
- **Codex full turn:** turn/completed đúng ID, assert nội dung/status, không treo; đủ bằng chứng hoặc blocked report. 
- **Source/traces:** source snapshot và packet pinned đúng SHA, không self-referential HEAD claim; unit count 22 khai báo + raw logs xác minh PASS. 
- **Review policy:** Không nâng NETWORK_PROBE_ONLY thành EMBEDDED_LOGIN_VERIFIED; không nâng TEAM_EXECUTED thành REVIEWER_EXECUTED. 

**Khi các mục này đạt:** GO_P1 là phê duyệt qua gate P0 và thực thi P1; **không** có nghĩa app v1.0.0 hoàn thành, sáu AI được full auto, hoặc chi phí cloud bằng 0đ với mọi tài khoản. 

## G. Hướng dẫn gửi lại cho ChatGPT Leader


**Antigravity / Codex:** Đã nhận review R04 tại source SHA 8defe3f05c323a039fbedbbe78424bf644b531eb. Xử lý UB-R04-001..007 theo phạm vi; ưu tiên Electron spike P0-008, sửa ticket board legacy, scanner không leak, Codex turn correlation, cost admission policy & claim. Tiếp tục làm P1 thực chất song song để có Electron shell, **nhưng không tự nghiệm thu P0** . Khi nộp tiếp, hãy gửi repo URL + pinned full commit SHA + review packet + raw TAP/NDJSON đã scrub + log Electron Windows. Nếu hoàn tất, Leader sẽ xét GO_P1. Không paid API, không fake status, không tự force-push/merge. 

## H. Links source đã review

- Tree: 
- Cost Guard: 
- Tests: 
- Board: 
- Manifest: 
- Codex harness: 
- Secret scan: 

**Kết luận cuối:** CHANGES_REQUIRED — P1_IMPLEMENTATION_ALLOWED_WITH_NO_P1_SIGNOFF. Kế hoạch này không sửa code trên GitHub và không thay lời phê duyệt từ PO.
