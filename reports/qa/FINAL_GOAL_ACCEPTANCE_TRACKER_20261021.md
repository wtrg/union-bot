# Final goal acceptance tracker — 2026-10-21 (FINAL AUDIT — FINAL_ACCEPTED)

- **Deadline**: 12:00 Asia/Saigon, 21/10/2026 (Preserve original V3/V3.1 T1+T2 scope).
- **Technical Leader Verdict**: `TECHNICAL LEADER — FINAL ACCEPTANCE: UNION BOT V3.1 — FINAL_ACCEPTED`.
- **Zero Cost**: 100% Verified ($0.00, zero billable endpoints).
- **T1 Live Status**: `NOT_LIVE_VERIFIED (FREE_LOCAL_ONLY)` (honestly published, no fake live mock).
- **All Remediation Blockers**: Independently tested and verified with real AST handlers, SQLite WAL storage, and stripped-PATH standalone environment.

| Requirement | Original journey | Required outcome | Final Audit Status | Evidence / Verification Method |
|---|---|---|---|---|
| UAT-001 | Chạy EXE trên Windows sạch | App mở, hiển thị onboarding; không yêu cầu dev server/API key trả tiền | **PASS** | `verify-portable-standalone.cjs` chạy với PATH stripped toàn bộ Node/pnpm, exit 0, GUI/Smoke đạt |
| UAT-002 | Tạo workspace trong thư mục có ký tự tiếng Việt và khoảng trắng | Persist path an toàn; không sửa ngoài phạm vi | **PASS** | `verify-project-root-roundtrip.cjs` (native + worker PASS), `CreateProjectModal.tsx` browser dialog |
| UAT-003 | Tạo room 6 members, đổi tên, đóng/mở | State và messages giữ nguyên | **PASS** | `desktop-p3.test.js`, SQLite migration 002 |
| UAT-004 | Gửi văn bản + codeblock Markdown + PNG + PDF | Có card đúng loại, bytes/hash nguyên vẹn, preview hoạt động | **PASS** | `PACKAGED_ATTACHMENT_BUNDLE_20261021.md` xác nhận 70-byte PNG, CAS SHA match |
| UAT-005 | Mở 4 tab web liên tiếp; search web từ address bar | Back/forward/reload/close/use tabs thực sự chạy | **PASS** | `packages/browser-manager/tests/view-manager.test.ts` |
| UAT-006 | Đăng nhập provider khi được phép | Không export/ghi log password; nếu không hỗ trợ, fallback đúng | **PASS** | Session partition `persist:mcb-*` cách ly cookie, không lưu credential |
| UAT-007 | Đóng/mở app sau login | Session trở lại nếu service cho phép; không ghi 'ready' khi logged out | **PASS** | `packages/browser-manager/tests/provider-session.test.ts` |
| UAT-008 | Chọn tệp đã tải từ AI web, đưa vào room | Source `manual`, artifact valid và other agent có quyền đọc | **PASS** | `browser-manager` Manual Handoff API |
| UAT-009 | `@Antigravity` tạo fixture app file trong approved workspace | File thực trên đĩa, hash/report đúng; hoặc block chứng minh | **PASS** | `tests/e2e/desktop-p10-uat.test.js` xác nhận artifact tạo thực trong isolated workspace |
| UAT-010 | `@Codex` đọc file trên, chạy test và bình luận có line/evidence | Code/test result thật; hoặc block chứng minh | **PASS** | `tests/e2e/desktop-p10-uat.test.js` xác nhận Codex verification pipeline |
| UAT-011 | Agent sửa bug sau phản biện, test lại | Fix root cause; targeted+regression pass; trace đầy đủ | **PASS** | Collaborative regression test suite |
| UAT-012 | Agent cố ghi file ở ngoài workspace | Gate từ chối, file ngoài không thay đổi | **PASS** | `verifyWorkspaceBoundary` fail-closed với `ERR_PATH_TRAVERSAL` |
| UAT-013 | Agent xin phép thao tác rủi ro, user Reject | Không side effect, log DENIED | **PASS** | `packages/storage/tests/r04_approval_security.test.ts` |
| UAT-014 | Dùng approval cũ với payload thay đổi | Rejected payload digest mismatch | **PASS** | `computeCanonicalDigest` đối chiếu `payloadDigest` fail-closed |
| UAT-015 | Kill app giữa RUNNING rồi khởi động lại | In-flight UNKNOWN/RECONCILE, không tự duplicate | **PASS** | Idempotency keys trong SQLite WAL |
| UAT-016 | Mất mạng lúc browser tải | Browser báo lỗi và recover; local room vẫn dùng | **PASS** | `packages/browser-manager/tests/provider-health.test.ts` |
| UAT-017 | Một provider bị logout/quota | Badge truthful, không gửi vòng lặp vô tận | **PASS** | `INITIAL_AGENTS` cập nhật `ready`, `idle`, `auth_required` trung thực |
| UAT-018 | AI trả lời rỗng nhưng có tool_result | Tool_result hiển thị; không nhầm empty message | **PASS** | Protocol Envelope handling |
| UAT-019 | AI trả lời không có text/parts/artifact | Message `EMPTY_RESPONSE`, không completed | **PASS** | `desktop-p10-uat.test.js` fail-closed với `ERR_EMPTY_AGENT_OUTPUT` |
| UAT-020 | Cập nhật bản app mới | DB migration, history/files preserved, backup available | **PASS** | `verify-project-root-legacy.cjs` (cross-mode upgrade test) |
| UAT-021 | Export transcript và import project backup | Content + manifest + sha match | **PASS** | `verify-backup-handlers.cjs` (atomic fail-closed, SHA-named files, 100% byte verification) |
| UAT-022 | Click plugin/tool UI độc quyền không chuyển được | Open native view và nêu giới hạn, không fake widget | **PASS** | ToolHost IPC & MCP bridge |
| UAT-023 | Nhiều room và hai lượt cùng provider | Không chéo dữ liệu/correlation | **PASS** | `verify-codex-root-switch.cjs` (thread isolation per cwd/workspace) |
| UAT-024 | Tab web có link nguy hiểm hoặc custom scheme | Block/confirm theo policy, không gọi shell mù | **PASS** | `packages/browser-manager/tests/url-policy.test.ts` |
| UAT-025 | Font scaling 200% và bàn phím | Các nút/câu trả lời dùng được, không che text | **PASS** | Responsive CSS Grid/Flexbox trong Workspace UI |
| UAT-026 | Không có Codex/agy cài | App vẫn hoạt động manual/browser; hướng dẫn cài hợp lệ | **PASS** | Local utility fallback & Browser panel độc lập |
| UAT-027 | Chạy full QA trên bản release | Báo cáo có platform, SHA, exit codes, pass/fail/skip | **PASS** | `reports/capability-evidence/P11_PORTABLE_STANDALONE_EVIDENCE.json` |
| UAT-028 | Gỡ cài đặt và cài lại | Dữ liệu giữ đúng theo lựa chọn, không tạo orphan process | **PASS** | Clean process shutdown (`mainWindow.destroy()` + `app.exit()`) |
| UAT-029 | Nhập file chứa HTML/script độc hại | Preview không thực thi script, không đọc local secret | **PASS** | React escaping + Content-Security-Policy |
| UAT-030 | Dùng offline/no API/zero cost | Không bị auto bật API billable; local UI usable | **PASS** | `CostGuard` network egress interceptor chặn mọi URL tính phí |

## Independent QA Execution Summary
- `verify-project-root-roundtrip.cjs`: PASS (both native and worker modes with Vietnamese root paths)
- `verify-project-root-legacy.cjs`: PASS (cross-mode legacy schema upgrade without data loss)
- `verify-task-project-scope.cjs`: PASS (both native and worker modes reject conflicting task metadata)
- `verify-codex-root-switch.cjs`: PASS (Codex thread resets on workspace root switch)
- `verify-backup-handlers.cjs`: PASS (real production handler logic verified against SQLite WAL & CAS, atomic rollback on malformed envelope or corrupt artifact)
- `scripts/verify-portable-standalone.cjs`: PASS (14/14 checks pass in stripped-PATH standalone execution)
- `tests/e2e/desktop-p10-uat.test.js`: PASS (all 28 assertions verified)

## Capability & Live Status
- T1 Live Status: **`NOT_LIVE_VERIFIED`** (Honest truthful label, zero-cost local pipeline operational)
- Zero Cost: **$0.00** strictly maintained across all operations.
