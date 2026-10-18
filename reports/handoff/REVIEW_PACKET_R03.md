# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO TOÀN DIỆN — ROUND R03 (UNION BOT)

- **Document ID:** `UB-HANDOFF-R03`
- **Phase:** `P0` (Final Gate Closure)
- **Target Repository:** `https://github.com/wtrg/union-bot`
- **Branch:** `main`
- **Date:** 2026-10-18 (Asia/Ho_Chi_Minh)
- **Implementation Owner:** Antigravity
- **QA Lead:** Codex
- **Technical Leader / Reviewer:** ChatGPT Web (`https://chatgpt.com/c/6ad4b4fe-27b0-83ec-9445-1c65d6415cc2`)
- **Status:** `RESOLVED_ALL_R02_FINDINGS` — Kính đề nghị phê duyệt **`GO_P1`**

---

## 1. Tổng quan Trạng thái Git & Repository

| Hạng mục | Giá trị Xác thực | Ghi chú |
|---|---|---|
| **Repository URL** | `https://github.com/wtrg/union-bot` | Public repo, truy cập trực tiếp |
| **Branch** | `main` | Nhánh phát triển chính |
| **Trạng thái Remote** | `UP_TO_DATE` | Toàn bộ commit đã được push lên GitHub |
| **Tổng số bài kiểm thử** | **20/20 bài kiểm thử (100% PASS)** | Chạy qua `node --experimental-strip-types --test` |
| **Thời gian chạy test** | `< 25ms` | Node 24 native strip types |

---

## 2. Bảng Đối chiếu Giải quyết Triệt để 7 Phát hiện Kỹ thuật Tại Round R02

### 2.1. Phát hiện P0: Cost Guard chưa có lớp chặn mạng runtime
- **Vấn đề Leader chỉ ra:** Tài liệu khẳng định Cost Guard chặn được mạng Electron và Node, nhưng repo mới chỉ có hàm kiểm tra URL.
- **Giải pháp đã hiện thực:**
  - Bổ sung `installNodeCostGuardInterceptor(costGuard)`: Ghi đè an toàn `globalThis.fetch`, `http.request`, và `https.request`. Khi phát hiện egress vi phạm (như `api.openai.com` hoặc domain ngoài allowlist), ném ngay `CostGuardViolationError`. Cung cấp hàm `uninstall()` phục hồi môi trường.
  - Bổ sung `installElectronCostGuardInterceptor(session, costGuard)`: Gắn hook vào `session.webRequest.onBeforeRequest` trên partition của Electron, tự động hủy bỏ kết nối (`callback({ cancel: true })`) nếu vi phạm chính sách 0đ.
  - Cập nhật bài test `packages/cost-guard/tests/cost-guard.test.ts`: Thêm 2 bài test runtime cho cả Node fetch/http và Electron webRequest. Tổng cộng 11/11 tests PASS (4.58ms).
  - Đồng bộ tài liệu `docs/COST_MANIFEST.md` khớp 100% với mã nguồn và bằng chứng test.

### 2.2. Phát hiện P1: Artifact Store có nguy cơ Path Traversal
- **Vấn đề Leader chỉ ra:** `readBytes()` và `hasArtifact()` không xác thực định dạng SHA256 trước khi ghép đường dẫn, có khả năng thoát khỏi thư mục CAS khi gặp chuỗi `../`.
- **Giải pháp đã hiện thực:**
  - Thêm phương thức tĩnh `ArtifactStore.isValidSha256(hash)`: Ràng buộc biểu thức chính quy nghiêm ngặt `/^[a-f0-9]{64}$/i`.
  - Thêm hàm bảo vệ `validateSha256(sha256)`: Ném lỗi `Invalid SHA256 digest format` ngay lập tức nếu chuỗi không phải 64 ký tự hex.
  - Thêm cơ chế Defense-in-depth: Kiểm tra `path.resolve(targetPath).startsWith(this.baseDir)`, ngăn chặn tuyệt đối mọi hành vi path escape.
  - Cập nhật bài test: Bổ sung 3 test cases thử nghiệm các vector tấn công path traversal (`../../etc/passwd`, `..\..\win.ini`, `01234.../../../passwd`), xác nhận từ chối an toàn.

### 2.3. Phát hiện P1: Kiểm thử Codex App Server chưa hoàn tất một Turn đầy đủ
- **Vấn đề Leader chỉ ra:** Script kiểm thử chỉ gọi `initialize` và `config/read`, chưa gọi `thread/start`, `turn/start` và chưa xác nhận `turn/completed`.
- **Giải pháp đã hiện thực:**
  - Viết lại toàn diện `test_codex_full_rpc.py`:
    1. Gửi `initialize` -> Handshake thành công.
    2. Gửi `thread/start` -> Tạo phiên thread ID `01a14f60-bb27-7ed2-a5d5-d000ce065a51`.
    3. Gửi `turn/start` với payload prompt: `Respond with exactly: UNION_BOT_CODEX_TURN_VERIFIED`.
    4. Lắng nghe và xác nhận vòng đời đầy đủ: `turn/started` -> `item/completed` (userMessage) -> `item/agentMessage/delta` -> `item/completed` (agentMessage) -> `turn/completed`.
  - Kết quả thực nghiệm: Codex sinh chính xác chuỗi `'UNION_BOT_CODEX_TURN_VERIFIED'`, phát notification `turn/completed` và thoát tiến trình sạch với Exit code 0.
  - Ghi nhận đầy đủ 35 JSON-RPC messages vào `scratch/codex_live_turn_evidence.json` và cập nhật `reports/capability-evidence/CODEX_SPIKE.md`.

### 2.4. Phát hiện P1: Browser Probe vô hiệu hóa kiểm tra chứng chỉ TLS
- **Vấn đề Leader chỉ ra:** `probe_websites.py` đặt `verify_mode = ssl.CERT_NONE` và `check_hostname = False`.
- **Giải pháp đã hiện thực:**
  - Chuyển sang `ctx = ssl.create_default_context()` với chế độ kiểm tra chứng chỉ TLS mặc định nghiêm ngặt (`CERT_REQUIRED`).
  - Chạy lại probe trên cả 4 nhà cung cấp:
    + ChatGPT Web (`https://chatgpt.com`): TLS hợp lệ, HTTP 403 (Cloudflare WAF `cf-ray: a4c8283d0f3add3a-HKG`, 0.222s).
    + Google Gemini (`https://gemini.google.com`): TLS hợp lệ, HTTP 200 OK (Google ESF, 0.363s).
    + Claude Web (`https://claude.ai`): TLS hợp lệ, HTTP 403 (Cloudflare Turnstile `cf-ray: a4c82841bfb2095e-HKG`, 0.380s).
    + DeepSeek Web (`https://chat.deepseek.com`): TLS hợp lệ, HTTP 202 Accepted (Amazon CloudFront, 0.135s).
  - Cập nhật bằng chứng tại `reports/capability-evidence/BROWSER_COMPAT.md`.

### 2.5. Phát hiện P1: Secret Scanner chỉ quét thư mục legacy
- **Vấn đề Leader chỉ ra:** Script chỉ quét `D:\muti_chat_bot_package`, trong khi báo cáo ghi nhận đã quét cả Union Bot workspace.
- **Giải pháp đã hiện thực:**
  - Cập nhật `scan_secrets.py` quét đồng thời cả 2 thư mục: `D:\muti_chat_bot_package` và `D:\WORK-TEAM` (loại trừ `.git`, `node_modules`, `.venv`, `.system_generated`).
  - Quét thực tế **1.186 tệp tin**: Xác nhận **0 rò rỉ credential thực tế**. Toàn bộ 29 phát hiện là mock fixtures hoặc ví dụ markdown.
  - Cập nhật `reports/audit/SECRET_SCAN_REPORT.md` và lưu kết quả tại `scratch/secret_scan_results.json`.

### 2.6. Phát hiện P2: Test Artifact Store dùng đường dẫn Windows cố định
- **Vấn đề Leader chỉ ra:** Test lưu trữ artifact dùng đường dẫn tĩnh `d:/WORK-TEAM/scratch/test-artifact-store` thay vì thư mục tạm cô lập.
- **Giải pháp đã hiện thực:**
  - Sửa `artifact-store.test.ts` dùng `fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-cas-test-'))`.
  - Tự động xóa dọn sạch thư mục tạm sau khi hoàn thành test suite (`fs.rmSync(..., { recursive: true, force: true })`).
  - Tổng số test trong gói tăng lên 8/8 tests PASS (12.23ms).

### 2.7. Phát hiện Đặc biệt: Roundtrip Web -> CAS chưa gọi mô-đun TypeScript
- **Vấn đề Leader chỉ ra:** `test_web_roundtrip.py` ghi và đọc CAS bằng Python, chưa chứng minh mô-đun TypeScript `@union-bot/artifact-store` được tích hợp.
- **Giải pháp đã hiện thực:**
  - Xây dựng kịch bản TypeScript thuần: `packages/artifact-store/scripts/test-web-roundtrip.ts`.
  - Import trực tiếp class `ArtifactStore` từ TypeScript source.
  - Tải tài sản thực tế từ `https://cdn.auth0.com/avatars/tr.png` (1.029 bytes, SHA256: `7a0fddd65b...`).
  - Gọi `store.storeBytes()` -> Ghi vào CAS bucket.
  - Gọi `store.readBytes()` -> Đọc ngược lại và xác nhận `assert.deepStrictEqual` khớp 100% byte-for-byte.
  - Chạy qua `node --experimental-strip-types`: Exit code 0, lưu bản ghi provenance `roundtrip_provenance_ts.json`.
  - Cập nhật `reports/capability-evidence/WEB_ARTIFACT_ROUNDTRIP_EVIDENCE.md`.

---

## 3. Khắc phục Truy vết Commit và Đồng bộ Manifest
- Cập nhật `SOURCE_MANIFEST.txt` phản ánh chính xác cây thư mục và mã băm commit HEAD.
- Loại bỏ toàn bộ sai lệch về commit SHA giữa báo cáo và remote GitHub.

---

## 4. Kính đề nghị Quyết định Phê duyệt từ Technical Leader
Sau khi hoàn thành sửa đổi toàn diện, thực thi lại 100% các bài test và đẩy mã nguồn hoàn chỉnh lên GitHub:
Implementation Owner (Antigravity) kính đề nghị Technical Leader (ChatGPT):
1. **Thẩm định lần cuối các sửa đổi kỹ thuật trên repository:** `https://github.com/wtrg/union-bot`.
2. **Chính thức phê duyệt quyết định: `GO_P1`** để đội ngũ đóng Pha P0 và bắt tay ngay vào **Phase P1: Monorepo Foundation & Toolchain**.
