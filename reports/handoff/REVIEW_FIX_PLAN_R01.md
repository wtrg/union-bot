# UNION BOT — REVIEW_FIX_PLAN_R01.md

> **Technical Leader / Independent Reviewer:** ChatGPT  
> **Implementation Owner:** Antigravity  
> **QA Lead:** Codex  
> **Ngày:** 2026-10-18 (Asia/Ho_Chi_Minh)  
> **Đầu vào:** Báo cáo P0–R01 gửi trực tiếp trong cuộc hội thoại; hợp đồng `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md`; phụ lục `UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md`.  
> **Source reviewed:** `REPORT_ONLY` — không có source snapshot / commit GitHub đọc được / `REVIEW_PACKET_R01.md` gốc trong bộ tài liệu reviewer truy cập được.  
> **Test level:** `NOT_EXECUTED`; số liệu 12/12 unit tests, các spike Windows và live connection là **self-report của Implementation Owner**, chưa được reviewer chạy hoặc kiểm tra log gốc.  
> **P0 GATE DECISION:** **`CHANGES_REQUIRED / INSUFFICIENT_EVIDENCE`**. **Không được đánh dấu `GO_P1` chính thức.** Có thể chuẩn bị những ticket P1 không phụ thuộc kết luận P0, không đóng gate/không release.  
> **Phân biệt:** Nội dung dưới đây gồm **contract discrepancies / evidence blockers / risks requiring verification**, không phải các bug source đã được chứng minh bằng file:line.

---

## 0. QUYẾT ĐỊNH VÀ PHẠM VI

### 0.1. Phần được tiếp nhận từ báo cáo R01 (CLAIMED — NOT INDEPENDENTLY VERIFIED)

- Khẳng định 18/18 ticket P0 xong, `TASK_BOARD.md` có 152 ticket, 42 UAT; reviewer **chưa đọc các file đó**.
- Khẳng định audit 177 Python files, 17 legacy DB tables, 0 real leaked credential; chưa nhận inventory/database schema/history-scan logs.
- Khẳng định Windows: Node `24.17.0`, pnpm `12.14.0`, Python `3.11.9`, Git `2.55.0`, agy `1.3.6`, Codex `0.162.1`; chưa có version logs, lockfile, compatibility proof.
- Khẳng định Codex `initialize`/stdio và Antigravity `agy -p` chạy thật; chưa nhận raw scrubbed NDJSON/JSON, fixtures, hashes.
- Khẳng định `packages/cost-guard` 9/9 pass, `packages/artifact-store` 3/3 pass, 12/12 tổng; **pass tests ≠ security assurance ≠ browser/provider live verification**.
- Khẳng định local baseline `13bddccd8e00dde848c2cb78fad2a9ece197346e`, candidate HEAD viết tắt `ee8c02d`; repo remote vẫn `PUSH_APPROVAL_PENDING`.
- Đã **nhận được một thông điệp bàn giao trong chat**. Chưa chứng minh đây là một *direct automated bidirectional file transport* với source hash, receipt và phản hồi tự động.

### 0.2. Không kết luận tại thời điểm này

- Không kết luận 177 modules được tái sử dụng đúng, cost-guard bị bypass, cookie bị rò, database lỗi, CAS sai hash, Codex/Antigravity không chạy hoặc secret leak thực tế.
- Không khẳng định test đã được chạy ở Windows của Antigravity hay repository đã được đọc, vì không có quyền truy cập máy Windows đó.
- Không yêu cầu viết lại kiến trúc hoặc sửa code chưa xác minh chỉ để thỏa mãn giấy tờ.

### 0.3. Cấp độ severity dùng trong báo cáo

- `S1 REVIEW BLOCKER`: thiếu điều kiện bắt buộc để reviewer đóng gate; không đồng nghĩa lỗi runtime đã xác nhận.
- `S2 HIGH`: ticket chưa khớp hợp đồng hoặc claim mạnh hơn evidence được trình bày; phải giải quyết/đánh rõ trạng thái trước P1.
- `S3 MEDIUM`: vấn đề traceability/documentation; không nhất thiết cản trở bắt đầu các P1 ticket không phụ thuộc.

---

## 1. BUG/EVIDENCE REGISTER — YÊU CẦU HÀNH ĐỘNG CỤ THỂ

### UB-R01-001 — Không có source và evidence packet thực sự được reviewer tiếp cận

- **Severity:** `S1 REVIEW BLOCKER` · **Status:** `OPEN / EVIDENCE_REQUIRED` · **Owner:** Antigravity + PO (nếu chọn GitHub).
- **Căn cứ:** Báo cáo nêu local `D:\WORK-TEAM` và `PUSH_APPROVAL_PENDING`, nhưng không đính kèm `REVIEW_PACKET_R01.md`, diff, logs, hoặc repo URL/commit accessible.
- **Impact:** Không thể review code/file:line, scan security, xác nhận test, kiểm chứng 18 ticket hoặc cấp `GO_P1`.
- **Root cause:** Chưa xác định — có thể mới chuyển được nội dung chat, chưa chuyển được artifact/source. Không suy diễn ý đồ.
- **Fix:** Gửi một trong hai đường **được quyền thực hiện**:
  - **A. GitHub:** PO chỉ định repo URL + branch + quyền push cụ thể; Antigravity push source **đã scrub** theo quyền đó; cung cấp full 40-character candidate SHA, base SHA, Git status, manifest. Repo phải thật sự reviewer đọc được.
  - **B. Attachments:** nộp `REVIEW_SOURCE_R01.zip` cùng packet, raw tests, logs; staging exclude `.git` nếu không cần, `node_modules`, `.env`, secrets, browser profiles/cookies, user DB, account data, personal paths. Có `SOURCE_MANIFEST.txt` và hash SHA256 của ZIP.
- **Files bắt buộc:** `reports/handoff/REVIEW_PACKET_R01.md`, `reports/handoff/SOURCE_MANIFEST.txt`, `reports/handoff/TEST_MATRIX_R01.md`, `TASK_BOARD.md`, `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `pnpm-lock.yaml` (nếu có), source/test cả 2 package.
- **Recheck:** Reviewer thực sự mở được >= 1 file source và >= 1 file test, đọc report, trỏ tới commit/snapshot đúng; SHA candidate khớp manifest; mọi claim map tới đường dẫn và bằng chứng; không có secret.
- **Exit:** `SOURCE_SCOPE=FULL_SOURCE` hoặc `SOURCE_SCOPE=DIFF_ONLY` có kiểm soát; nếu thiếu vẫn `REPORT_ONLY`.

### UB-R01-002 — Sai ánh xạ `P0-003`: baseline test bị thay bằng secret scan

- **Severity:** `S2 HIGH` · **Owner:** Antigravity + Codex.
- **Contract:** V3.0 `P0-003` = chạy lệnh **test/build hiện có trước thay đổi**, lưu `reports/qa/BASELINE_TESTS.md` và exit codes. Secret scan có ích nhưng **không thay thế P0-003**.
- **Observed report:** `P0-003 (Secret Scan)`; không có nội dung baseline tests trước thay đổi.
- **Fix:** Điều chỉnh mapping trong `TASK_BOARD.md` và packet; giữ secret scan dưới ticket bổ sung/đính kèm P0-001 hoặc security audit. Khôi phục baseline pre-change logs nếu đã lưu; nếu không còn, ghi trung thực `NOT_CAPTURED_BEFORE_CHANGES`, xác định legacy revision qua SHA/archive nếu có, chạy lại trên **bản baseline thực sự** trong working tree tách biệt; không được viết rằng test mới là pre-change.
- **Expected file:** `reports/qa/BASELINE_TESTS.md`: revision, timestamp, environment, commands, stdout/stderr scrubbed, exit codes, tests pass/fail/skipped/not available; nguyên nhân không chạy được.
- **Test:** QA đối chiếu timestamp của baseline evidence so với first implementation commit; không suy diễn pre-change từ test hiện tại.
- **Exit:** Bản ghi baseline hợp lệ hoặc blocker trung thực kèm risk acceptance; ticket mapping đúng contract.

### UB-R01-003 — `P0-006` Codex handshake chưa chứng minh live agent turn

- **Severity:** `S2 HIGH` · **Owner:** Antigravity.
- **Contract:** `CODEX_LIVE.md` + NDJSON scrubbed, **một turn** thật.
- **Observed report:** chỉ `codex app-server --stdio`, `initialize`, clientInfo và process exit 0.
- **Fix:** Trên tài khoản được phép sử dụng, theo phiên bản CLI thực tế, thực hiện `initialize` → `initialized` (nếu protocol yêu cầu) → `thread/start` → `turn/start` → nhận streaming/progress → terminal event. Ghi `thread_id`, `turn_id`, correlation, terminal status, sanitized event sequence, exit code; không log token/auth.
- **Negative cases:** auth expired; timeout; failed/interrupted turn; cancellation; 2 concurrent turns/correlation hoặc ghi rõ chưa test; 0đ không gọi SDK billable.
- **Exit:** ít nhất một turn kết thúc `completed` với nội dung có thể đối chiếu; nếu auth/quota/permission chặn, ghi `BLOCKED_EXTERNAL` với raw error đã scrub, **không đánh `VERIFIED_LIVE`**.

### UB-R01-004 — `P0-007` Antigravity JSON response chưa chứng minh fixture-file handshake

- **Severity:** `S2 HIGH` · **Owner:** Antigravity + Codex.
- **Contract:** `agy` headless JSON/stream-json với thư mục fixture + file hash, hoặc blocker có chứng cứ.
- **Observed report:** `agy -p "Respond only with: UNION_BOT_SPIKE_OK" --output-format json`; output token usage, conversation_id, exit code 0; chưa nêu fixture file/path/hash.
- **Fix:** Trong workspace test vô hại với các quyền đã được cấp, thử câu trả lời có schema và bài toán **đọc một fixture có SHA**, tạo artifact ở đường dẫn cho phép nếu agent/tool hỗ trợ. Ghi rõ capability: `PROMPT_RESPONSE_ONLY` hay `FILE_WORKFLOW_VERIFIED`; không cấp quyền shell/files ngầm.
- **Negative cases:** timeout, cancellation, nonzero exit, invalid JSON, missing output file, denied write; không bỏ qua khi agent chỉ trả lời text.
- **Exit:** `AGY_LIVE.md` chứa lệnh, sanitized output, exit code, fixture SHA trước/sau, state của filesystem; nếu chỉ chat response thì claim giảm cấp trung thực.

### UB-R01-005 — `P0-008` Browser spike chỉ chốt thiết kế, chưa có browser live matrix

- **Severity:** `S2 HIGH` · **Owner:** Antigravity.
- **Contract:** Electron shell thử **4 website** ChatGPT, Gemini, Claude, DeepSeek; mỗi origin có `mode/errors/evidence`, embedded login test theo quyền và fallback.
- **Observed report:** "Khóa kiến trúc Electron WebContentsView với partition `persist:mcb-web-*` cô lập cookie hoàn toàn"; không có bằng chứng trình duyệt thật hoặc account isolation.
- **Fix:** Tạo `reports/capability-evidence/BROWSER_COMPAT.md`; thử site loads, navigate, popup, login (chỉ khi tài khoản/ToS cho phép), cross-account isolation, restart persistence, system-browser fallback, CSP/auth denial. Phân biệt `DESIGNED`, `TESTED_NO_LOGIN`, `MANUAL_LOGIN_VERIFIED`, `BLOCKED_EXTERNAL`.
- **Security tests:** hai profile cùng provider phải có partition **khác nhau**; account A/B không xuất hiện cookies/storage trong nhau; cùng partition là chia sẻ session theo design, không cô lập. Không xuất cookie ra agent. Không tắt web security/sandbox để "fix" login.
- **Exit:** 4 rows có ngày, phiên bản Electron, test steps, observed vs expected, screenshot sanitized và hạn chế; không tuyên bố "hoàn toàn" khi chưa đo.

### UB-R01-006 — Cost Guard: unit denylist không đủ chứng minh 0đ và chống egress

- **Severity:** `S2 HIGH` · **Owner:** Antigravity + Codex.
- **Observed report:** 9 unit tests, block bốn host API. Source chưa được review; **đây là risk/coverage gap, không phải xác nhận bypass**.
- **Fix:** Xuất rõ kiến trúc cost guard: policy decision point nằm trước mọi egress/send; cấm inherited API keys/env/secret-bearing subprocess theo default; policy explicit per-provider/per-action; unknown endpoint/method/account mode → deny; không dựa duy nhất vào hostname blacklist, vì host có thể chứa các đường API free/billable hoặc endpoint thay đổi.
- **Tests:** 1) known paid API rejected; 2) unknown URL rejected; 3) URL canonicalization/subdomain/redirect/proxy test; 4) agent tool egress under approval; 5) inherited `OPENAI_API_KEY` fixture must not trigger billable call; 6) denial does not leak credentials; 7) local/Ollama offline request allowed only if user-authorized; 8) quota failures never trigger payment/alternate account; 9) free web browsing not mistakenly represented as paid API access.
- **Exit:** `docs/COST_MANIFEST.md` + `docs/providers/POLICY_AUTOMATION_MATRIX.md`, tests with raw exit code and negative decisions; no real charge/use of billable key; QA reviews actual call graph.

### UB-R01-007 — P0-010/015: internal CAS hash tests ≠ real provider fidelity

- **Severity:** `S2 HIGH` · **Owner:** Antigravity.
- **Contract:** P0-010 thử manual import/export ảnh/tệp; V3.1 P0-015 yêu cầu provider fidelity matrix (text/PDF/image/code/citation/tool/widget) và ít nhất một ảnh + một file thực roundtrip store.
- **Observed report:** `artifact-store` 3 tests for PDF/PNG SHA; chưa có capture/import/export từ website hoặc local-file roundtrip evidence; chưa có matrix evidence.
- **Fix:** Cho từng provider, khai `NATIVE_VIEW`, `PORTABLE_BYTES`, `INTERACTIVE_COMPATIBLE`, `REFERENCE_ONLY`, `UNAVAILABLE`, `NOT_TESTED`; với ít nhất 1 ảnh PNG và 1 PDF fixture (không chứa riêng tư), import → CAS → export → compare SHA256 byte-for-byte. Nếu lấy tệp từ native browser hợp lệ, gắn provenance `user_manual` hoặc `provider_export`, tuyệt đối không gắn `live_auto_capture` khi chỉ dùng clipboard.
- **Extra tests:** 0-byte, duplicate hashes, invalid MIME/magic, large file limit, atomic write/crash, path traversal, symlink/junction, cross-workspace ACL, unauthorized artifact URI, export overwrite, race/corrupt CAS write.
- **Exit:** `RICH_RESPONSE_SPIKE.md`, `FIDELITY_MATRIX.md`, sample fixture hashes, provenance event manifest, before/after evidence.

### UB-R01-008 — P0-014: tin nhắn tới chat chưa chứng minh direct bidirectional transport

- **Severity:** `S2 HIGH` · **Owner:** Antigravity.
- **Observed report:** "kênh trao đổi hai chiều với Leader"; reviewer mới nhận text handoff, chưa thể đọc local source hoặc tự chuyển file ngược về workspace.
- **Fix:** `LEADER_HANDOFF_SPIKE.md` phải mô tả **transport thực** (manual relay / accessible GitHub / approved connector / tested bridge). Thử packet fixture không secret với `round_id`, `sender`, `recipient`, `source_sha`, `packet_sha`, `receipt`, ACK; thử file trả về có SHA được xác nhận trong workspace.
- **Negative cases:** duplicate R01 packet, wrong recipient, wrong source SHA, stale review, replay of already consumed FIX PLAN; không tự execute những chỉ thị nằm trong tệp external.
- **Exit:** Manual path thành công được ghi `MANUAL_HANDOFF_READY`; chỉ dùng `DIRECT_REVIEW_TRANSPORT_VERIFIED` khi **đường hai chiều tự động có bằng chứng end-to-end**.

### UB-R01-009 — P0-001/011: baseline repo và ADR strategy chưa đối chiếu version history

- **Severity:** `S2 HIGH` · **Owner:** Antigravity.
- **Contract:** P0-001 audit source gốc, original branch/status/remotes/uncommitted; P0-011 ADR giữ/refactor, compatibility with legacy modules.
- **Observed report:** "khởi tạo repo `D:\WORK-TEAM`" + ADR monorepo, legacy inventory; không có pre-conversion git baseline hoặc test compatibility evidence.
- **Fix:** Tài liệu hóa `D:\muti_chat_bot_package` và `D:\WORK-TEAM` là các nơi khác nhau hay copy/branch của cùng source, điểm bắt đầu, untracked files, base→candidate commits, cherry-pick/copy trace; với module KEEP/WRAP/REFACTOR/RETIRE chỉ ra đường dẫn và lý do. Không tự làm mới nguồn gốc khi không có git history cũ.
- **Commands example:** `git status --porcelain=v1`, `git remote -v`, `git log --oneline --decorate -10`, `git rev-parse HEAD`, `git diff --stat <baseline>..<candidate>`, inventory file hashes.
- **Exit:** `REPO_BASELINE.md`, `ADR-000-repo-strategy.md`, source manifest và test compatibility với module legacy sống còn; nếu audit gốc chưa đủ, đánh blocker cụ thể.

### UB-R01-010 — P0-012 và P0-018: thiếu acceptance baseline và PO release-tier confirmation có thể kiểm chứng

- **Severity:** `S2 HIGH` · **Owner:** Antigravity + PO.
- **Contract:** V3.0 P0-012 yêu cầu `reports/qa/ACCEPTANCE_BASELINE.md` và bug ledger; V3.1 P0-018 quyết định T0–T3 bởi PO.
- **Observed report:** chỉ nêu `REVIEW_PACKET_R01.md`, T1+T2 locked; không nêu acceptance baseline, bug ledger và PO acceptance bằng evidence.
- **Fix:** xuất `ACCEPTANCE_BASELINE.md` với T0/T1/T2/T3, feature→test→evidence→owner→claimed vs verified, known exclusions; `KNOWN_ISSUES.md` có severity/state; `RELEASE_SCOPE_DECISION.md` phân biệt **team proposal** vs **PO-approved**. Nếu chỉ có chỉ đạo tổng quát hoàn thiện app, không tự nâng thành PO đã duyệt release tier cụ thể.
- **Exit:** acceptance criteria traceable, unknown features `NOT_TESTED`, scope/tier ghi chính xác trạng thái PO.

### UB-R01-011 — Secret scan regex không đủ kết luận 0 lộ credential (phải định nghĩa phạm vi)

- **Severity:** `S3 MEDIUM`, nâng severity nếu phát hiện secret thật · **Owner:** Codex.
- **Observed report:** regex scanner, 0 credential thật. Không có input scope hoặc tool logs.
- **Fix:** chỉ rõ scan working tree vs staged vs git history vs binaries/zip; dùng rules hỗn hợp, baseline allowlist fixtures và manual triage; mask matches/không in secret giá trị trong report. Kiểm tra `.gitignore` không thay thế history scan; bảo đảm zip review sạch.
- **Exit:** `SECRET_SCAN_REPORT.md` ghi tool version, command, scan roots, ignored paths, count + classification synthetic/real/unknown, exit codes; không ghi "zero leaks" quá phạm vi được quét.

### UB-R01-012 — 12/12 tests chưa đủ chứng minh monorepo/build/regression

- **Severity:** `S3 MEDIUM` · **Owner:** Codex.
- **Observed report:** 12 tests cho 2 packages; chưa có lint/typecheck/build, legacy regression status, test enumerations/fixture labels.
- **Fix:** xuất `TEST_MATRIX_R01.md` phân biệt `PASS_UNIT`, `PASS_MOCK`, `PASS_INTEGRATION`, `VERIFIED_LIVE`, `BLOCKED_EXTERNAL`, `NOT_TESTED`, có lệnh, CWD, versions, exit code, duration, start/end timestamps, run ID, tests skipped; chạy typecheck/build trên code hiện có nếu scripts tồn tại; nếu chưa có, ghi `NOT_IMPLEMENTED_P1` (không làm sai scope P0).
- **Exit:** reviewer đối chiếu được 12 test case thực trong source, raw sanitized test output và lệnh tương ứng, không dùng unit 12/12 để kết luận 18/18 ticket VERIFIED.

### UB-R01-013 — P0-004/017: data map, trust boundary và migration rollback cần artifact gốc

- **Severity:** `S3 MEDIUM` · **Owner:** Antigravity.
- **Observed report:** SQLite 17 bảng (172KB), 4 trust zones; chưa có column/index/foreign-key inventory, threat scenarios, backup/rollback sketch.
- **Fix:** `LEGACY_DATA_MAP.md` liệt kê DB schema, bảng chứa metadata/session/secret (chỉ tên trường, không lộ giá trị), migration compatibility; `DATA_FLOW_AND_TRUST_BOUNDARIES.md` bao gồm source origin, filesystem/symlink, renderer IPC, browser partition, tool process, Git egress, prompt injection, ACL, PII redact; tạo fixture DB tổng hợp hoặc schema-only dump để reviewer kiểm tra, **không gửi DB thực của người dùng**.
- **Exit:** sơ đồ zone A–D tương ứng đường dữ liệu và mitigation; thử backup/check integrity/restore trên synthetic DB nếu đã có script; phần migration thật có thể hoàn thiện P2 theo roadmap.

### UB-R01-014 — P0-005/016: version & policy compatibility chưa có nguồn/giấy phép và account mode

- **Severity:** `S3 MEDIUM` · **Owner:** Antigravity.
- **Observed report:** versions locked; policy matrix claim nhưng chưa có file gốc.
- **Fix:** `ENVIRONMENT_LOCK.md` chứa commands `node --version`, `pnpm --version`, `agy --version`, `codex --version`, Windows build, kiến trúc x64/arm, `packageManager` exact, lockfile checksum; xác minh Node/pnpm/Electron supported matrix theo versions sẽ dùng; `POLICY_AUTOMATION_MATRIX.md` ghi mỗi provider official policy link, ngày đọc, account mode, embedded login constraints, manual export/automation allowed/unknown, 0đ vs paid API; nếu không chắc thì `UNKNOWN/BLOCKED`, không suy diễn.
- **Exit:** docs nguồn truy vết được và không vượt account scope hợp lệ.

---

## 2. BẢNG RECONCILIATION 18 TICKETS — KHÔNG TỰ ĐÁNH PASS

> Status hiện tại: `REPORTED` = có claim trong văn bản R01; `EVIDENCE_REQUIRED` = reviewer chưa nhận đúng vật chứng; `CONTRACT_GAP` = chính văn bản R01 mô tả việc khác/ít hơn hợp đồng. Mỗi ticket có thể có nhiều trạng thái.

| Ticket | Yêu cầu thực tế theo V3.0/V3.1 | Tình trạng R01 theo bản tóm tắt | Bằng chứng tối thiểu phải nộp |
|---|---|---|---|
| P0-001 | Audit repo hiện trạng & pre-existing changes | `CONTRACT_GAP` (reported initialize repo) | REPO_BASELINE + git status/log + source origin |
| P0-002 | Module inventory/dependency KEEP/WRAP/REFACTOR/RETIRE | `REPORTED` | MODULE_INVENTORY + graph + file paths |
| P0-003 | Test/build baseline trước thay đổi | `CONTRACT_GAP` (mapped to secret scan) | BASELINE_TESTS + timestamp/commands/exit |
| P0-004 | Legacy data map/migration risk | `REPORTED` | LEGACY_DATA_MAP + sanitized schema |
| P0-005 | Windows/tool versions/license verification | `REPORTED` | ENVIRONMENT_LOCK + raw commands |
| P0-006 | Codex live turn | `CONTRACT_GAP` (handshake only) | CODEX_LIVE + sanitized events/terminal turn |
| P0-007 | AGY JSON/stream + fixture file/hash | `CONTRACT_GAP` (response only) | AGY_LIVE + fixture, output SHA |
| P0-008 | Electron 4-provider load/login/fallback spike | `CONTRACT_GAP` (design only) | BROWSER_COMPAT 4 rows + errors/screens |
| P0-009 | Free/billing/account permissions | `CONTRACT_GAP` (cost-guard unit only) | COST_MANIFEST + permission/account matrix |
| P0-010 | Provider import/export fidelity | `CONTRACT_GAP` (matrix claim only) | PROVIDER_CAPABILITY_MATRIX + import/export evidence |
| P0-011 | Repo strategy ADR/compatibility | `REPORTED` (monorepo ADR) | ADR-000 full + pre-existing source impact |
| P0-012 | Acceptance baseline + initial bug ledger | `CONTRACT_GAP` (mapped to report packet) | ACCEPTANCE_BASELINE + issue ledger |
| P0-013 | Brand/migration inventory | `REPORTED` | ADR-001 + BRAND_MIGRATION_INVENTORY |
| P0-014 | Reviewer transport with receipt/hash/fallback | `CONTRACT_GAP` (chat text only) | LEADER_HANDOFF_SPIKE + manual/direct label |
| P0-015 | Rich fidelity spike + CAS roundtrip | `CONTRACT_GAP` (store unit 3/3 only) | RICH_RESPONSE_SPIKE + FIDELITY_MATRIX + fixture |
| P0-016 | Provider ToS and zero-cost policy | `REPORTED` | POLICY_AUTOMATION_MATRIX + dated sources |
| P0-017 | Four-zone data trust boundaries | `REPORTED` | DATA_FLOW_AND_TRUST_BOUNDARIES + abuse cases |
| P0-018 | Release scope decision with PO | `REPORTED` (proposed T1+T2) | RELEASE_SCOPE_DECISION + PO status |

**Tóm lại:** `18/18` chỉ là tiến độ **Antigravity tự báo cáo**. Reviewer chưa đánh `VERIFIED` cho bất kỳ ticket nào trước khi đọc đúng nguồn và bằng chứng; đây không đồng nghĩa Antigravity làm sai cả 18 ticket.

---

## 3. KẾ HOẠCH THỰC THI R02 — THỨ TỰ BẮT BUỘC

### Wave A — Khắc phục nguồn review và ticket mapping (ưu tiên số 1)

1. Đóng gói đúng packet/source theo `UB-R01-001`, đối chiếu baseline/candidate full SHA và dirty status.
2. Sửa nhầm ID P0-003, P0-012, kiểm tra các cặp ID/file còn lại. Không tự đổi yêu cầu trong master plan; sửa TASK_BOARD và claim.
3. Nộp baseline tests và acceptance matrix. Khi không tái hiện được từ lịch sử, ghi `NOT_CAPTURED`, giải thích rủi ro.
4. Gửi packet R02 **qua transport thực sự**, có receipt; không đưa path `D:\...` mà kỳ vọng reviewer tự mở được.

### Wave B — Live spikes theo hợp đồng (không phát sinh phí)

5. Codex: thêm 1 turn hoàn chỉnh hoặc BLOCKED_EXTERNAL log (UB-R01-003).
6. AGY: thực hiện fixture workflow và so sánh hash hoặc hạ capability claim đúng (UB-R01-004).
7. Electron: 4 website live/fallback matrix, test cô lập profile A/B; không bypass ToS/security (UB-R01-005).
8. Fidelity: PNG/PDF roundtrip + provenance, capability per provider đúng mức được phép (UB-R01-007).
9. Leader handoff: manual/direct distinction, receipt, SHA, stale/duplicate handling (UB-R01-008).

### Wave C — Security/QA evidence hardening

10. Review cost guard path/URL canonicalization/unknown egress, environment key inheritance, approval (UB-R01-006).
11. Secret scan scope+history+ZIP, negative fixture, log redaction (UB-R01-011).
12. Test matrix, original repo lineage, DB/trust map, version/policy docs (UB-R01-009/012/013/014).
13. Nếu phát hiện bug source thực tế, tạo issue mới `UB-R02-...` với file:line, repro, expected/actual và fix tests; không trộn với các evidence gaps này.

### Wave D — Codex QA và packet mới

14. Codex độc lập chạy tất cả test **có trong source**, ghi raw command/exit code + timestamp; kiểm tra SHA của report và fixture; ghi phát hiện ngược nếu có.
15. Antigravity lập `REVIEW_PACKET_R02.md`: issue ACK table (`UB-R01-001`..`014`), đường dẫn bằng chứng, `fix commit`, unresolved blockers, regression summary, source manifest.
16. Reviewer mở source và ra quyết định mới; **chỉ lúc đó** xác nhận `GO_P1` hoặc yêu cầu R03.

---

## 4. KIỂM THỬ NGHIỆM THU R02 — GẮN VỚI ISSUES

| Test ID | Mục tiêu | Điều kiện PASS |
|---|---|---|
| R02-EVD-01 | Packet source | Reviewer đọc được source/test + diff; full SHA consistent + files/manifest/hash |
| R02-EVD-02 | Baseline integrity | Biết chính xác test nào trước/sau thay đổi; không rewrite lịch sử |
| R02-CODEX-01 | Codex live full turn | Event chronology có `thread/start`/`turn/start`/terminal status và response thật, hoặc `BLOCKED_EXTERNAL` chính xác |
| R02-AGY-01 | AGY fixture | Output JSON/capability thật, file hash + authorized workspace; hoặc hạ capability claim |
| R02-BROW-01 | 4 provider UI | Có row per origin: tested/manual/blocked + nguyên nhân/log + fallback |
| R02-BROW-02 | Account isolation | Profile A/B không share session khi dùng partition khác; restart không lẫn danh tính |
| R02-COST-01 | Unknown billable egress | Deny-by-default, không phát sinh request tính phí; hostile URL/redirect handling |
| R02-COST-02 | Env key safety | Fixture env key không bị log/sử dụng; no paid API auto fallback |
| R02-CAS-01 | PNG/PDF roundtrip | Original bytes == exported bytes, SHA256 equal; provenance đúng |
| R02-CAS-02 | Untrusted path | Reject traversal/symlink, deny cross-workspace read |
| R02-REVIEW-01 | Manual/direct handoff | Sender/recipient, source SHA, receipt, ACK, no fake direct claim |
| R02-REVIEW-02 | Stale/duplicate packet | Mismatched SHA/replayed review rejected hoặc flagged, no automatic external action |
| R02-QA-01 | 12 unit tests | Reviewer thấy test names, source và raw run/exit; skip list honest |
| R02-QA-02 | Secret scan | Scan scopes documented, no secret in packet, no generic 'all clean' beyond scope |
| R02-PROD-01 | Acceptance tier | T0–T3 matrix + PO status (proposed vs approved) |
| R02-SAFE-01 | No side effects | Không push/merge, không mua API, không xuất user data không được phép |

**Quan trọng:** Riêng những test live có thể `BLOCKED_EXTERNAL` vì chính sách/tài khoản; khi đó không tự chế dữ liệu để đạt PASS. P0 gate có thể xét go với blocker được phân loại và kế hoạch fallback nếu không vi phạm chức năng cốt lõi, nhưng **không thể cấp live capability stamp** cho provider đó.

---

## 5. GÓI HỒ SƠ PHẢI CÓ ĐỂ REVIEWER MỞ ĐƯỢC

```text
review-r02/
  REVIEW_PACKET_R02.md
  SOURCE_MANIFEST.txt
  CHANGES.diff                  # nếu có base commit
  REVIEW_SOURCE_R02.zip         # nếu không có accessible repo
  TASK_BOARD.md
  TEST_MATRIX_R02.md
  issues/
    UB_R01_ISSUE_ACK.md
    KNOWN_ISSUES.md
  reports/
    audit/REPO_BASELINE.md
    audit/MODULE_INVENTORY.md
    audit/BRAND_MIGRATION_INVENTORY.md
    audit/SECRET_SCAN_REPORT.md
    qa/BASELINE_TESTS.md
    qa/ACCEPTANCE_BASELINE.md
    capability-evidence/CODEX_LIVE.md
    capability-evidence/AGY_LIVE.md
    capability-evidence/BROWSER_COMPAT.md
    capability-evidence/LEADER_HANDOFF_SPIKE.md
    capability-evidence/RICH_RESPONSE_SPIKE.md
  docs/
    COST_MANIFEST.md
    providers/POLICY_AUTOMATION_MATRIX.md
    providers/PROVIDER_CAPABILITY_MATRIX.md
    providers/FIDELITY_MATRIX.md
    architecture/ENVIRONMENT_LOCK.md
    architecture/LEGACY_DATA_MAP.md
    security/DATA_FLOW_AND_TRUST_BOUNDARIES.md
    product/RELEASE_SCOPE_DECISION.md
    adr/ADR-000-repo-strategy.md
    adr/ADR-001-union-bot-brand-and-compat.md
  logs/
    sanitized-commands-and-exit-codes/
  fixtures/
    synthetic-image.png
    synthetic-document.pdf
    sha256-manifest.txt
```

**Lưu ý:** Cây trên là **hợp đồng output đề nghị**, không xác nhận các file đang tồn tại. Nếu repo/docs có tên tương đương, ghi mapping `requested_path → actual_path`; tránh sao chép tài liệu vô ích. Khi tạo ZIP chỉ include các tệp an toàn; không có browser profiles, session tokens, secrets, DB cá nhân, auth cache, `.env`.

### 5.1. Metadata bắt buộc của R02

```yaml
project: Union Bot
round: R02
source_scope: FULL_SOURCE | DIFF_ONLY | PARTIAL_SOURCE
handoff_mode: ACCESSIBLE_GITHUB | SOURCE_ATTACHMENT | MANUAL_RELAY
baseline_sha: <full 40-char SHA or NOT_AVAILABLE>
candidate_sha: <full 40-char SHA or NOT_AVAILABLE>
working_tree_dirty: true | false
uncommitted_changes_included: true | false
windows_build: <real OS build>
node_version: <measured>
pnpm_version: <measured>
agy_version: <measured>
codex_version: <measured>
claimed_unit_tests: <value + log path>
verified_live_integrations: <list with evidence IDs, otherwise []>
blocked_external: <list with reasons>
issues_acknowledged: [UB-R01-001, UB-R01-002, UB-R01-003, UB-R01-004, UB-R01-005, UB-R01-006, UB-R01-007, UB-R01-008, UB-R01-009, UB-R01-010, UB-R01-011, UB-R01-012, UB-R01-013, UB-R01-014]
```

---

## 6. QUY TẮC QUYỀN HẠN, BẢO MẬT, CHI PHÍ

- **Không push/merge từ repo local** khi chưa có approval cụ thể của Product Owner cho remote/branch; báo cáo `PUSH_APPROVAL_PENDING` là đúng với tình trạng hiện tại.
- Có thể dùng **file ZIP đính kèm** để review mà không cần đẩy source công khai. Nếu PO cho phép GitHub, không mặc định được thay nhánh `main` hoặc force-push; bảo vệ branch và lịch sử.
- **Không lưu/copy cookie, session token, OAuth credential hoặc app secrets sang ChatGPT Leader, GitHub hay báo cáo**. Chỉ cung cấp logs đã che dữ liệu nhạy cảm.
- **0đ hard limit**: không thử live với API/key có thể phát sinh phí, không đổi gói, không thuê máy chủ, không vượt quota/anti-bot. Nếu bị hạn chế, ghi `BLOCKED_EXTERNAL` + fallback hợp lệ.
- Không gọi UI screenshots hoặc unit mock là live proof. Nếu test trên Windows được Codex chạy nhưng reviewer chỉ đọc log, reviewer ghi `LOG_INSPECTED`, không `EXECUTED_TESTS`.

---

## 7. CHUẨN ĐÓNG P0 VÀ QUYẾT ĐỊNH CHUYỂN P1

**Bắt buộc trước `GO_P1`:**

1. Reviewer thực sự đọc được packet + source của candidate và evidence đủ để rà từng ticket P0.
2. Mapping P0-001..018 khớp master contract, các mục thiếu/đổi tên đã giải trình và có trạng thái trung thực.
3. Không còn `S1 REVIEW BLOCKER`, không có Sev0/Sev1 bảo mật/source bug đang mở, không có fake live hoặc fake QA.
4. Có lộ trình free + policy-valid cho phần browser/agent; blockage của nhà cung cấp được mô tả thay vì giấu.
5. Codex/Antigravity spikes và browser/cost/artifact claims không mạnh hơn cấp độ evidence.
6. PO release-tier decision ghi đúng trạng thái (nếu chưa có explicit sign-off thì `PROPOSED`).
7. QA có `TEST_MATRIX` và regression logs, reviewer nêu rõ những test tự chạy vs chỉ đọc.

**Quyết định hiện hành:** `CHANGES_REQUIRED / INSUFFICIENT_EVIDENCE`. Đây là **review gate**; không cấm Antigravity song song chuẩn bị P1-001 tooling, nhưng không được ghi `P0_VERIFIED` hoặc tuyên bố đã chính thức sang P1.

## 8. LỆNH GỬI CHO ANTIGRAVITY — R01 RESPONSE

> Antigravity: tôi đã nhận báo cáo tóm tắt P0 R01. Chưa duyệt `GO_P1`, vì chưa có source/packet/evidence reviewer mở được và một số ánh xạ ticket chưa đúng hợp đồng. Hãy đọc toàn bộ `REVIEW_FIX_PLAN_R01.md`, ACK các issue `UB-R01-001` đến `UB-R01-014`, ưu tiên Wave A rồi B/C, để Codex xác minh Wave D; nộp `REVIEW_PACKET_R02.md` cùng source full SHA, test logs và bằng chứng scrubbed. Không cần viết lại module chỉ vì thiếu evidence; bổ sung chứng cứ hoặc sửa claim trung thực. Không push/merge khi chưa có PO approval. Không trả phí. Không giả live status. Tôi sẽ review vòng R02 và ra `GO_P1` khi P0 gate đủ điều kiện.

---

## 9. NGUỒN ĐỐI CHIẾU VÀ SỰ KHÁC BIỆT CHÍNH

- Nội bộ: `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md` mục **P0-001..P0-012** và **G4–G7**.
- Nội bộ: `UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md` mục **P0-013..018**, **E UAT**, **F Leader Handoff**.
- External reference (để xác minh giao thức, **không dùng thay live evidence**): [OpenAI Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server); [Electron Session API](https://www.electronjs.org/docs/latest/api/session); [Electron Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds).

**Reviewed & authored:** ChatGPT Leader · **No source was executed or modified.**