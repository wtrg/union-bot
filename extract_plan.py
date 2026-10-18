import json
import re
from pathlib import Path

export_path = Path(r"C:\Users\Lenovo\AppData\Local\Programs\antigravity\chat_export.json")
raw = json.loads(export_path.read_text(encoding="utf-8"))
data = json.loads(raw) if isinstance(raw, str) else raw
mapping = data.get("mapping", {})

def extract_heredoc(text):
    m = re.search(r"<<'EOF'\n(.*?)\nEOF", text, re.DOTALL)
    if not m:
        raise ValueError("Heredoc not found in message")
    return m.group(1)

# 1. Extract V1
v1_raw = mapping["04ce324e-f4b9-4d0e-837e-480c2293f264"]["message"]["content"]["text"]
v1 = extract_heredoc(v1_raw)
print(f"V1: length={len(v1)}, lines={len(v1.splitlines())}")

# 2. Extract V2 core
v2_c1 = extract_heredoc(mapping["62a4b42d-7221-4cac-96d7-937719217b21"]["message"]["content"]["text"])
v2_c2 = extract_heredoc(mapping["b5f6872f-fc7b-491f-8618-318caeba9a80"]["message"]["content"]["text"])
v2_c3 = extract_heredoc(mapping["c735d2dd-29d3-40c7-b833-9dbb9176a7e3"]["message"]["content"]["text"])
v2 = v2_c1 + "\n" + v2_c2 + "\n" + v2_c3
print(f"V2 core: length={len(v2)}, lines={len(v2.splitlines())}")

# 3. Assemble as in _assemble_mcb.py
def section(start, stop):
    a = v1.index(start)
    b = v1.index(stop, a)
    return v1[a:b].strip()

tech = section('# PHẦN 5 — HỢP ĐỒNG PROVIDER', '# PHẦN 15 — THỰC THI')
ops = section('# PHẦN 17 — THIẾT LẬP', '# PHẦN 20 — MẪU REPORT')
tech = tech.replace('# PHẦN ', '## THAM CHIẾU V1 — PHẦN ')
ops = ops.replace('# PHẦN ', '## THAM CHIẾU V1 — PHẦN ')

lead = '''# MUTI CHAT BOT — KẾ HOẠCH TRIỂN KHAI TOÀN DIỆN V3.0
## Full Delivery Blueprint • Windows Desktop • 0đ • 6 AI • ChatGPT Leader Code Review

> **Bản giao thực thi cuối đến release ứng dụng sử dụng được** — ngày 18/10/2026.  
> **Đối tượng:** Antigravity Implementation Owner, Codex QA Lead, ChatGPT Leader Reviewer, và chủ dự án Product Owner.  
> **Một file duy nhất:** Kiến trúc, lộ trình chi tiết, mã hợp đồng, bộ kiểm thử, quản lý release, vòng review/sửa lỗi, checklist bàn giao.  
> **Nguyên tắc tối thượng:** Không fake, không mất nguồn dữ liệu, không thuê server, không API tính phí, không tự push/merge, không gọi “hoàn thành” khi chưa test từ file EXE đóng gói.  
> **Tình trạng:** Đây là **kế hoạch cho agent xây dựng**, không phải ứng dụng đã được xây hoặc mã nguồn đã qua review.

### QUY ƯỚC ƯU TIÊN VÀ PHẠM VI

1. Các mục **A–H (V3 Delivery Contract)** là chuẩn vận hành và nghiệm thu bắt buộc. Lộ trình **P0–P11** trong mục D là lịch trình DUY NHẤT; mọi mô tả giai đoạn khác thuộc phụ lục kỹ thuật chỉ dùng để tra cứu, không thay thế P0–P11.
2. **Phụ lục I, II** lấy từ đặc tả kỹ thuật V1 để giữ chi tiết schema, UI, giao thức, bảo mật, kiểm thử; khi trùng đường dẫn/kiểu/tên trường thì **B2–B5/V3** là nguồn chuẩn. Agent phải tạo ADR và migrator nếu thay đổi schema trong code thật.
3. Phải audit mã MUTI CHAT BOT đang có trước khi quyết định thay, tạo mới hay nâng cấp. Không thể khẳng định repo `wtrg/wt-team` đã được đọc đầy đủ chỉ từ URL; nguồn local/commit SHA phải được agent xác minh.
4. **Các khả năng phụ thuộc dịch vụ bên ngoài không thể ép hoạt động.** Chứng nhận DESKTOP_RELEASE_READY không đồng nghĩa FULL_AUTOMATED_SIX_AI. Sản phẩm vẫn phải dùng được với chế độ native/manual đúng sự thật.
5. **ChatGPT Leader là reviewer trong hội thoại của người dùng**, không tự động nhìn repo hay điều khiển Antigravity khi chưa có connector/bridge thực sự và cấp quyền. Handoff tối thiểu là báo cáo + file source/diff + log + ảnh/traces; khi được cung cấp, leader thực hiện review và tạo kế hoạch sửa lỗi cụ thể cho vòng đó.
6. Chuỗi vận hành khép kín: **audit → code → test → review → fix → test lại → package → smoke → release dossier → chủ dự án nghiệm thu**. Agent không tự gọi lệnh `push`, `merge`, `publish`, mua dịch vụ hoặc đăng bài khi chưa có ủy quyền riêng.

### MỤC LỤC NGẮN

- **A** Bàn giao cuối và release tiers · **B** Kiến trúc/quy ước code/dữ liệu · **C** Bảo mật, bền vững, 0đ · **D** 12 pha từ audit đến Windows installer · **E** Phụ thuộc nhiệm vụ · **F** UAT kiểm thử người dùng · **G** ChatGPT Leader ↔ Antigravity ↔ Codex review loop · **H** Build/test/release vận hành.
- **I** Quy trình chạy thật và mô hình giới hạn 6 AI · **J** Mẫu hồ sơ giao việc đầu tiên, trạng thái lỗi và bằng chứng · **K** Nguồn tài liệu chính thức 2026.
- **Phụ lục I–II** Hợp đồng provider, bảng SQLite, UX, artifact, MCP, kiểm thử hồi quy, bảo mật và các script tham khảo từ v1 (không thay thế V3).

---
'''

v2lines = v2.splitlines()
v2body = '\n'.join(v2lines[3:])

more = r'''

---
# I. VẬN HÀNH 6 AI TRONG BẢN DÙNG ĐƯỢC — TEST TUYÊN BỐ & CHẤT LƯỢNG

## I1. Bản đồ quyền năng phải kiểm thử độc lập cho từng provider

Mỗi provider phải có hồ sơ JSON dưới `docs/providers/` kèm bảng trong UI, ít nhất các cột: `provider_id`, `runtime`, `login_method`, `version`, `cost_status`, `free_limit_known`, `native_tab`, `prompt_manual`, `prompt_automated`, `response_text`, `response_stream`, `image_export`, `file_export`, `structured_output`, `tool_events`, `workspace_write`, `test_run`, `cancel`, `resume`, `observed_live_at`, `evidence`, `limitations`. Không bao giờ thay `unknown` bằng `true`.

Mỗi năng lực dùng trạng thái `UNTESTED`, `SUPPORTED_VERIFIED`, `MANUAL_ONLY`, `BLOCKED_POLICY`, `BLOCKED_COST`, `BLOCKED_AUTH`, `UNAVAILABLE`, `REGRESSED`. Một provider chỉ được báo Ready khi thực sự đạt năng lực yêu cầu của luồng hiện tại. Tình trạng AI đang đăng nhập chưa đủ chứng minh có thể gửi prompt tự động hoặc dùng plugin.

**Định nghĩa bắt buộc:**

- `OPEN_NATIVE`: tab hiển thị, điều hướng và phiên dùng được. Không suy ra đọc được câu trả lời.
- `MANUAL_TRANSFER`: người dùng chọn/copy/import nội dung, metadata phải ghi `user_manual`, không mạo danh direct provider response.
- `AUTOMATED_TEXT`: tác vụ tự động gửi nhận có đối chiếu correlation và confirmation thực tế, được dịch vụ cho phép.
- `AUTOMATED_RICH`: ảnh/tệp/bộ phận đa phương thức được đồng bộ bytes + hash, không chỉ screenshot.
- `AGENT_EXEC`: tác vụ thực thi bằng Codex/Antigravity đã qua permission và có log/artefact xác minh.

**Bản miễn phí tối thiểu công bố:** một app Windows cài được, phòng chat thực, trình duyệt hỗ trợ 4 trang AI hoặc mở browser hệ thống, các thành viên hiện đủ 6 profile, chuyển tệp thủ công, Codex/Antigravity ở mức đã kiểm chứng, review loop với hồ sơ bằng chứng. **Không quảng cáo** sáu AI tự tranh luận liên tục nếu bốn web provider chỉ đang ở mức manual.

## I2. Kế hoạch QA chức năng theo dữ liệu thật

| Chức năng | Đầu vào thật | Đầu ra đúng | Trường hợp âm tính bắt buộc |
|---|---|---|---|
| Room | Workspace A, room B | Tin nhắn lưu đúng room, actor, thời gian | Đổi room khi stream không gán nhầm |
| Text | Unicode Việt + markdown + code | Hiển thị đúng, copy nguyên văn | XSS được escape, link xấu bị chặn |
| Image | PNG/JPEG hợp lệ do user chọn | Preview và sha256 trùng | Image bomb, invalid MIME, corrupted file bị từ chối |
| Document | PDF/DOCX/XLSX/MD/TXT hợp lệ | Xem/tải/mở bằng app hệ thống được xác nhận | Không tự chạy macro/script hoặc thực thi active PDF |
| Diff | Git worktree có thay đổi thật | Hiển thị đúng file, base hash, patch | Stale base SHA không được duyệt |
| Approval | Lệnh dự kiến + hash + TTL | Chỉ lệnh đã xem được dispatch 1 lần | Token hết hạn, nội dung đổi hoặc double-click bị chặn |
| Provider | Login/expiry/quota thật | State phản ánh đúng | Mất mạng không coi là đã gửi/đã hoàn thành |
| Restart | Đang làm dở/đang stream | Resume hoặc UNKNOWN cần reconcile | Không replay lệnh có side effect |
| Cost Guard | Adapter mô phỏng tính phí | Blocked trước egress | Env có API key vẫn không tự bật paid route |
| Security | Remote HTML và file tải ngoài | Không có Node/IPC đặc quyền | IPC forged / arbitrary file path bị từ chối |
| Release | File `.exe` package | Mở được, tạo room, lưu file, restart | Dev pass nhưng packaged fail => release fail |

## I3. Chất lượng phản biện chéo (không fake consensus)

1. Với task lớn, mỗi nhận xét cần `claim`, `scope`, `file:line` hoặc `eventId`, `evidenceRef`, `severity`, `proposedFix`, `verifyCommand`; ý kiến lý thuyết phải ghi `unverified`.
2. Mỗi phản biện lưu phiên bản source (`git SHA` / worktree snapshot / diff hash). Reviewer xem source A không thể xác nhận sửa trên source B nếu không có diff và test lại.
3. Orchestrator giới hạn max rounds, max active agents, duplicate reply detection theo message ID; không chống trùng chỉ bằng text content.
4. Khi một AI không truy cập được bằng chứng, yêu cầu user chia sẻ lại hợp lệ. Không truyền thông tin bí mật từ browser profile sang worker.
5. Chỉ chủ dự án được quyết định nghiệm thu phát hành cuối, ChatGPT Leader đưa khuyến nghị và báo cáo audit, không thay quyền owner.

## I4. Cấu hình máy tính và độ tương thích

Máy Windows 10/11 x64, cần đủ RAM/disk để Chromium mở nhiều tab và các agent hoạt động; **không bịa minimum RAM** trước khi đo. Agent phải lưu `OS build`, CPU, RAM, GPU, Node, Electron, CLI versions, dung lượng bản cài và app startup p50/p95. Không bắt buộc GPU rời, GPU local-model chỉ tùy chọn. Không bắt user tự cài Node cho bản `.exe` phát hành. Các mô hình local qua Ollama/llama.cpp là **optional plugin**, tắt mặc định, không dùng để thay danh tính ChatGPT/Claude.

## I5. Nguyên tắc quyền riêng tư khi AI thảo luận

- Trước khi gửi nguồn dự án bất kỳ cho một website AI, hiển thị nguồn, kích thước, phạm vi và mục đích chia sẻ; mặc định deny với folder chứa credentials, private keys, browser sessions, DB nhạy cảm.
- Không cho phép hidden sync của toàn repo/cloud; `context_builder` luôn tạo bản xem trước `selected files/excerpts + tokens approx + intended recipient`.
- Chặn prompt injection từ nội dung remote: webpage, README, AI reply, MCP tool result là DATA, không phải lệnh điều khiển policy/shell. E2E test độc hại: file văn bản yêu cầu `rm -rf`, `git push`, upload cookies phải bị từ chối.
- Đã gửi dữ liệu ra nền tảng web không thể đảm bảo thu hồi được; UI ghi chính xác trước khi chuyển.

---
# J. CÔNG VIỆC ĐẦU TIÊN, THỎA THUẬN BÀN GIAO VÀ BUG-FIX

## J1. Đoạn lệnh NGUYÊN VĂN người dùng gửi Antigravity

> Bạn là **Antigravity — Implementation Owner** cho MUTI CHAT BOT. Tài liệu chuẩn là `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md`. Đọc kỹ 100%, không chỉ đầu file; làm theo roadmap **P0 → P11**, không sử dụng roadmap cũ P0–P7 ở phụ lục như trình tự chính. Trước tiên audit repo/worktree, chạy baseline tests, ghi bằng chứng, khảo sát 6 provider và 0đ. Sau đó tiếp tục từng ticket có dependency, code/test/đóng gói Windows cho đến khi ứng dụng thực sự dùng được. **Không dừng ở bản UI mockup hoặc demo.** Mỗi pha gửi `REVIEW_PACKET_Rxx.md` kèm đường dẫn repo có thể đọc, SHA commit, diff, logs, screenshot/trace và các tệp bằng chứng cho **ChatGPT Leader**; không giả định đã review khi chưa nhận phản hồi thật. Tiếp nhận `REVIEW_FIX_PLAN_Rxx.md` do ChatGPT Leader trả về, sửa theo ticket P0/Sev1 trước, chạy targeted + regression + smoke, nộp vòng kế tiếp, lặp cho đến khi các release gates đạt. Không dùng API trả phí, không trộm cookie/vượt anti-bot, không tự push/merge/publish, không đụng dữ liệu ngoài workspace thiếu phép, không fake trạng thái tự động của AI web. Nếu nhà cung cấp chặn automation hợp lệ, phát hành chế độ manual native có giải thích, không âm thầm giả hoàn thành. Nếu phải xin quyền cho thao tác cụ thể, dừng riêng thao tác đó và nêu chính xác lý do.

## J2. Lệnh gửi Codex QA

> Bạn là Codex — QA & Security Lead. Đọc `MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md`; audit repo baseline, tách hợp đồng/schema, xây test matrices và regression suite cho **P0–P11**. Thực thi typecheck, lint, unit, contract, integration, E2E Windows packaged, security, cost guard và crash/recovery tests trong điều kiện có thể. Review diffs Antigravity trước vòng ChatGPT Leader, cung cấp file `reports/handoff/REVIEW_PACKET_Rxx.md` với source SHA, bảng test có lệnh/exit code/log thật, kỹ thuật tái hiện, limitations. Nếu chưa chạy được live provider ghi `NOT_RUN`, không được thay bằng MOCK PASS. Không tự push/merge/publish. Không phê duyệt bất kỳ ticket nào chỉ dựa trên báo cáo của chính Antigravity.

## J3. Gói đầu ra chuẩn một vòng review

**Tên file:** `reports/handoff/REVIEW_PACKET_R01.md`, `R02`, ...; đính kèm repo GitHub có thể truy cập bởi reviewer (hoặc ZIP mã nguồn đã scrub nếu repo riêng), không chỉ chụp ảnh màn hình. **Báo cáo thiếu source/diff không đủ để review code độc lập.**

```yaml
round: R01
phase: P0
repository: <actual-repo-URL-or-local-artifact>
commit_sha: <actual-hash>
base_sha: <actual-parent-hash>
worktree_dirty: true/false
source_attached: true/false
changed_files:
  - path: <path>
    reason: <reason>
claimed_done_tickets: [P0-001]
commands:
  - command: <literal-command>
    exit_code: <number or null>
    log_path: <existing path>
    ran_on: <OS/version/machine>
provider_evidence:
  - provider: codex
    mode: <native/manual/blocked>
    evidence_path: <existing artifact>
limitations: []
known_bugs: []
request_for_reviewer: <what you want independently inspected>
```

## J4. Quy định ChatGPT Leader tạo FIX PLAN sau khi review thực tế

Sau khi có source/diff/log từ agent và đọc hoặc mở được chúng, reviewer trả tối thiểu: (1) **kết luận về phạm vi thật đã đọc**; (2) issue register Sev0–Sev3; (3) bug ID, affected files/lines, evidence và các bước tái hiện; (4) root-cause **đã xác minh** hoặc hypothesis có gắn nhãn; (5) patch design chi tiết, ràng buộc tương thích; (6) regression tests yêu cầu, commands và expected results; (7) thứ tự sửa, dependency, code ownership; (8) security/cost impact; (9) điều kiện nghiệm thu/không nghiệm thu; (10) các vấn đề còn chặn do thiếu bằng chứng.

Mỗi issue theo đúng template:

```markdown
### MCB-BUG-R01-001 — [Mô tả ngắn]
Severity: Sev0/Sev1/Sev2/Sev3
Status: OPEN / FIX_IN_PROGRESS / NEED_VERIFY / VERIFIED / BLOCKED
Location: path/to/file.ts:L12-L50; functionName()
Evidence: reports/qa/log-...txt or screenshot / test trace
Repro: [Setup] -> [Action] -> [Observed]
Expected: ...
Cause: VERIFIED / HYPOTHESIS + explanation
Fix plan: step-by-step file/module changes
Regression: tests/... + command
Acceptance: asserts on bytes/events/UI, exact failure & success criteria
Security & cost impact: ...
Dependencies: ...
```

**Độ chính xác:** reviewer không tự nhận đã chạy test trên máy Windows của user nếu chỉ đọc log; phân biệt `LOG_REVIEWED`, `CODE_REVIEWED`, `REPRODUCED_LOCAL`, `WINDOWS_E2E_VERIFIED`, `BLOCKED_BY_ACCESS`. Agent không tự đánh dấu `VERIFIED` vì đã đọc fix plan.

## J5. Giao thức nhận/sửa/review vòng kế

1. Nhận `REVIEW_FIX_PLAN_Rxx.md`, so sánh với SHA gốc và cập nhật `reports/bugs/BUG_REGISTER.md`.
2. Với mỗi bug, Antigravity tái hiện bug ban đầu (nếu có thể), thêm test thất bại trước patch, ghi command + log. Nếu không tái hiện, không đoán fix; báo bằng chứng khác biệt môi trường.
3. Sửa tối thiểu ảnh hưởng, giữ contract. Viết unit/contract/e2e regression.
4. Chạy riêng test fail trước đó, sau đó suite liên quan, cuối cùng `pnpm verify` và `pnpm smoke:win` khi ảnh hưởng release.
5. Nộp diff nối `base_sha → new_sha`, regression log, screenshot hoặc video, ảnh hưởng với các ticket khác, tình trạng unresolved.
6. Reviewer đối chiếu claims với diff/test evidence; cập nhật issue `VERIFIED` hoặc `REOPENED` và phát file `REVIEW_FIX_PLAN_R(x+1).md` nếu cần.
7. Không lặp review cho đến hết quota không kiểm soát: gói nhiều bug mỗi lần; dừng khi chặn quyền hoặc chi phí, không tự suy rằng user đã cấp quyền thanh toán.
8. Khi không còn release-blocker, chuẩn bị release candidate và kiểm thử clean Windows thực; Leader đề nghị nghiệm thu, **chủ dự án xác nhận**.

## J6. Release tiers & các mốc bàn giao

- `ENGINEERING_INCOMPLETE`: chưa có executable/user journey.
- `OFFLINE_WORKSPACE_READY`: room/browser/file offline chạy + stored data nhưng agent live có thể chưa ổn.
- `DESKTOP_RELEASE_CANDIDATE`: installer, tài liệu, verify suites, security/cost gates và status matrix hoàn tất.
- `DESKTOP_RELEASE_READY`: end-to-end trên packaged Windows hoàn tất, không có Sev0/Sev1 hoặc Sev2 chặn luồng chính, có dấu xác nhận của PO.
- `FULL_AUTOMATED_SIX_AI`: nhãn mở rộng **chỉ khi** sáu provider tự động kết nối hợp lệ, được live-test thực tế; không bắt buộc để đạt Desktop Release Ready.

Không dùng tên marketing “six AI fully connected” trừ khi chứng minh cấp `FULL_AUTOMATED_SIX_AI`. Manual-only là sản phẩm dùng được nhưng không được quảng cáo là tự trị hoàn toàn.

---
# K. NGUỒN ĐỐI CHIẾU KỸ THUẬT (ĐỌC LẠI KHI CÀI ĐẶT)

Ngày kiểm tra lần đầu: 18/10/2026. Các website, chính sách đăng nhập và SDK đổi theo thời gian; không suy quyền sử dụng từ một trang marketing hoặc pricing.

1. Electron WebContentsView: https://www.electronjs.org/docs/latest/api/web-contents-view — dùng `WebContentsView`, không dùng `BrowserView` deprecated.
2. Electron Session: https://www.electronjs.org/docs/latest/api/session — `persist:` cho lưu phiên local nhưng không cam kết website chấp nhận nhúng.
3. Electron Security: https://www.electronjs.org/docs/latest/tutorial/security/ — remote Node off, context isolation, sandbox, permission request, sender validation.
4. Electron WebView caution: https://www.electronjs.org/docs/latest/api/webview-tag — không chọn `<webview>` làm mặc định.
5. Codex App Server: https://developers.openai.com/blog/codex-as-a-platform — event-based thread/turn/approval, app-server có harness riêng; mô hình access/billing tách biệt.
6. Codex App Server sign-in: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server — chỉ dùng luồng OAuth được hỗ trợ; thử `initialize`/`initialized`/`thread/start`/`turn/start`/terminal event.
7. Codex Preview Limitations: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations — không giả rằng mọi built-in tool hoặc plugin đều được truyền qua.
8. Google Antigravity CLI Headless: https://www.antigravity.google/docs/cli/headless/ — `agy -p ... --output-format stream-json`, JSON/NDJSON, terminal states/exit code; phải thử version thật.
9. Google Antigravity start: https://www.antigravity.google/docs/getting-started?tab=cli — xác minh auth/runtime/platform.
10. MCP Apps: https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html — `ui://` resources và host sandbox, không phải sao chép plugin độc quyền.
11. MCP Apps official repository: https://github.com/modelcontextprotocol/ext-apps — version SDK, host support, examples.
12. Playwright Electron Testing: https://playwright.dev/docs/api/class-electron — user journey tests trên Electron thật.

**Đóng băng dependencies:** Agent dùng các version ổn định, phù hợp lockfile, đã kiểm tra license và CVE; danh sách version chính thức được ghi trong `docs/architecture/ENVIRONMENT_LOCK.md`. Không tự hardcode latest number vào plan rồi coi là đã cài.

---
# PHỤ LỤC I — ĐẶC TẢ KỸ THUẬT TRIỂN KHAI TỪ V1

> Các nội dung kỹ thuật phía dưới bổ sung hình thức schema, protocol, UI, Artifact, MCP, threat model. Đây là **reference** có thể điều chỉnh bằng ADR khi phát hiện bất nhất; **không** sử dụng roadmap P0–P7 v1 thay P0–P11 V3. Khác biệt tên folder/type/schema ưu tiên các mục B và C V3 ở trên. Ví dụ code và SQL phải được biên dịch/migration/test lại, không tự gắn VERIFIED.

'''

footer = '''\n\n---\n# KẾT THÚC KẾ HOẠCH V3 — BÀN GIAO CHO AGENT\n\n**ĐIỀU KIỆN HOÀN THÀNH DUY NHẤT:** gói source + installer Windows + tài liệu người dùng + test/security/recovery/packaged smoke logs + capability matrix được đối soát + review fix loop đã xử lý blocker + Product Owner xác nhận dùng được. Những giới hạn nhà cung cấp cần ghi `BLOCKED_EXTERNAL` hoặc `MANUAL_ONLY` minh bạch. Không hứa đầy đủ quyền năng plugin/chatbot web bằng kỹ thuật không được cấp phép.\n'''

body = lead + v2body + '\n' + more + tech + '\n\n---\n# PHỤ LỤC II — LỆNH MÔI TRƯỜNG VÀ KỊCH BẢN KIỂM THỬ CHI TIẾT TỪ V1\n\n' + ops + footer

# Apply modifications from message 8d3f29d5-160c-4b53-96df-90636cc11b45
body = body.replace('> **Quy tắc ưu tiên:** Phần V2 ở đầu file thay thế/sửa mọi điểm xung đột với bản V1 được chép nguyên phía cuối để bảo toàn chi tiết. Các phần V1 không xung đột vẫn có hiệu lực.', '> **Quy tắc ưu tiên:** Phần A–K V3 và roadmap P0–P11 thay thế mọi điểm xung đột trong phụ lục tham khảo V1. Các đặc tả V1 không xung đột vẫn có hiệu lực.')
body = body.replace('**Chưa nằm trong v2 release:**', '**Chưa nằm trong release V3:**')
body = body.replace('sửa theo ticket P0/Sev1 trước', 'sửa các lỗi Sev0/Sev1 trước')
body = body.replace('chế độ (v2 **không có chế độ trả phí**)', 'chế độ (V3 **không có chế độ trả phí**)')
body = body.replace('---\n\n\n---\n# I.', '---\n\n# I.')

out_path = Path(r"d:\WORK-TEAM\MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md")
out_path.write_text(body, encoding="utf-8")

print(f"Assembly complete! File: {out_path}")
print(f"Bytes: {out_path.stat().st_size}, Lines: {len(body.splitlines())}")
print(f"Gates verification: {[(x, body.count(x)) for x in ['P0 —', 'P11 —', 'REVIEW_FIX_PLAN_R', 'MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md', '## I1.', '## J1.']]}")
print(f"Fences: {body.count('```')}, Parity: {body.count('```') % 2}")
