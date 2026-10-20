# BÁO CÁO KHẮC PHỤC TOÀN DIỆN & KẾT QUẢ UAT THỰC TẾ (PHASE P10 / T1+T2)

- **Thời điểm hoàn thành:** 2026-10-20 21:47 Asia/Saigon
- **Căn cứ chỉ đạo:** 
  - Yêu cầu của QA/Codex tại `reports/qa/ANTIGRAVITY_MONITOR_20261020_2050.md` và `2130.md`.
  - Phê duyệt chính thức của Technical Leader trên ChatGPT Web: `TECHNICAL LEADER — APPROVED: GO_P10-T1/T2-REMEDIATION`.
- **Cam kết chi phí:** Hoàn toàn $0.00 (Zero Cost), không có API trả phí, bảo mật fail-closed.

---

## 1. CHI TIẾT KHẮC PHỤC 5 GAP SOURCE THEO YÊU CẦU

### Gap 1: Loại bỏ Shortcut trong Native Execution — Định tuyến Agent thật & Gán nhãn trung thực
- **Vấn đề cũ:** Trong `apps/desktop/src/main.js`, nhánh `expectedContent` tự trích xuất nội dung từ tiêu đề rồi gán trực tiếp vào `outputContent`, bỏ qua `antigravityService.executePrompt` / `codexService.executeTurn` nhưng vẫn gán `provider=antigravity/codex`.
- **Khắc phục:** 
  - Đã loại bỏ hoàn toàn shortcut `expectedContent` trong chế độ Native Agent.
  - Khi tác vụ là Native (`antigravity` / `codex`), hệ thống bắt buộc gọi trực tiếp `antigravityService.executePrompt()` hoặc `codexService.executeTurn()`. Nếu executor gặp lỗi hoặc không khả dụng, hệ thống fail-closed (báo lỗi thực tế hoặc `BLOCKED`), tuyệt đối không sinh output giả lập.
  - Tác vụ tiện ích nội bộ (tính toán cục bộ, sinh tệp mẫu) được tách biệt rõ ràng và gán nhãn trung thực: `provider: 'LOCAL_UTILITY'`, `role: 'LOCAL_UTILITY'`, `isNativeAgent: false`, không mạo danh Native Agent để tính đạt chuẩn T1.

### Gap 2: Tính xác thực của `verifiedByCodex`
- **Vấn đề cũ:** Trường `verifiedByCodex` bị gán mặc định `true` trong đối tượng kết quả, ngay cả khi dịch vụ thẩm tra không chạy hoặc thất bại.
- **Khắc phục:** 
  - `verifiedByCodex` hiện được tính toán chặt chẽ: `verifiedByCodex = Boolean(verifyEvidence && verifyEvidence.verified && verifyEvidence.securityBoundaryVerified && verifyEvidence.digestVerified && verifyEvidence.zeroCostConfirmed)`.
  - Nếu `codexService` không chạy, gặp lỗi hoặc artifact bị sai mã băm, `verifiedByCodex` bắt buộc là `false`.

### Gap 3: Loại bỏ Optimistic Progress & Fallback giả mạo trong `TasksInbox.tsx`
- **Vấn đề cũ:** `TasksInbox.tsx` tự động đặt trạng thái `running` (10%) trước khi có xác nhận từ backend, và dùng `setTimeout` tự gán `completed 100%` khi thiếu API.
- **Khắc phục:** 
  - Xóa bỏ hoàn toàn cập nhật lạc quan (optimistic update); giao diện giữ nguyên trạng thái cho đến khi nhận được sự kiện thực tế hoặc phản hồi từ backend.
  - Xóa bỏ hoàn toàn fallback `setTimeout` giả mạo. Khi thiếu API, giao diện hiển thị thông báo lỗi `ERR_API_UNAVAILABLE`.
  - Kiểm tra chuẩn xác `res.status`: Phân biệt rõ các trạng thái `completed`, `waiting_input`, `blocked`, `cancelled`, `cancel_requested`, `failed`; `res.success` không bị đồng nhất với `completed`.

### Gap 4: Chống Race Condition bằng Reservation Đồng bộ (Atomic Reservation)
- **Vấn đề cũ:** `activeTaskExecutions.has(taskId)` được kiểm tra trước các lệnh `await` bất đồng bộ (`listTasks`, `updateTask`) rồi mới gọi `set()`, dẫn đến nguy cơ hai lệnh gọi Start đồng thời (`Promise.all`) cùng vượt qua kiểm tra.
- **Khắc phục:** 
  - Thực hiện reservation đồng bộ (`activeTaskExecutions.set(taskId, executionEntry)`) ngay lập tức trước bất kỳ lệnh `await` nào.
  - Bọc toàn bộ quy trình thực thi trong khối `try ... finally { activeTaskExecutions.delete(taskId); }` để đảm bảo dọn dẹp khóa trong mọi trường hợp.
  - Đã kiểm thử negative test với `Promise.all([executeTask, executeTask])`: Cuộc gọi đầu tiên chiếm quyền thực thi, cuộc gọi đồng thời bị từ chối ngay lập tức với mã `ERR_TASK_ALREADY_RUNNING`.

### Gap 5: Quản lý Vòng đời Hủy Tác vụ (Cancellation Lifecycle)
- **Vấn đề cũ:** Hủy tác vụ chỉ đặt cờ boolean mà không theo dõi xác nhận dừng từ executor.
- **Khắc phục:** 
  - Khi người dùng bấm Cancel, hệ thống cập nhật trạng thái tác vụ thành **`cancel_requested`** và phát sóng sự kiện.
  - Executor nhận tín hiệu ngắt (`cancelFn`), dừng subprocess và chuyển trạng thái tác vụ sang **`cancelled`** với thông điệp rõ ràng `Cancelled by user`. Nếu executor gặp sự cố bất thường, trạng thái chuyển thành `failed`.

### Bổ sung: Phân định Rõ ràng Môi trường Chạy
- `run-union-bot.bat`: Được định vị chuẩn xác là **Local Workspace Runner (Chạy trực tiếp từ mã nguồn, không installer)** dành cho môi trường phát triển và nghiệm thu cục bộ.
- Đóng gói độc lập P11: Tài liệu hướng dẫn sử dụng đã làm rõ lộ trình đóng gói standalone bundle nhúng trọn gói runtime cho người dùng cuối.

---

## 2. BẰNG CHỨNG KIỂM THỬ THẬT (FOCUSED TEST EVIDENCE)

Toàn bộ các kiểm thử đều chạy trên Windows Electron thật và ghi nhận bằng chứng tự động:

1. **Bộ kiểm thử UAT Desktop P10 mở rộng (`tests/e2e/desktop-p10-uat.test.js`):**
   - Lệnh thực thi: `pnpm uat`
   - Kết quả: **PASS (1/1 suite, 23/23 checks đạt 100%)**
   - Tệp bằng chứng: [`reports/capability-evidence/ELECTRON_P10_UAT_EVIDENCE.json`](file:///d:/WORK-TEAM/reports/capability-evidence/ELECTRON_P10_UAT_EVIDENCE.json)
     - `hasUnionBotAPI: true`
     - `taskCreated: true`
     - `rolePreservedAsImplementer: true`
     - `execSuccess: true`
     - `execStatusCompleted: true`
     - `isNativeAgent: true` (Xác thực tác vụ đi qua Antigravity native route)
     - `reactiveUpdateReceived: true`
     - `doubleDispatchBlocked: true` (Start lặp lại bị chặn)
     - `concurrentDoubleStartBlocked: true` (Promise.all đồng thời bị chặn với ERR_TASK_ALREADY_RUNNING)
     - `cancelRequestedTransition: true` (Trạng thái chuyển tiếp cancel_requested được ghi nhận)
     - `cancelFinalizedAsCancelled: true` (Hoàn tất hủy thành cancelled sau khi executor xác nhận)
     - `persistedCompleted: true` (Độ bền vững SQLite WAL)
     - `traversalDenied: true` (Chặn path traversal fail-closed)
     - `localUtilityVerified: true` (Tác vụ tiện ích được gán nhãn LOCAL_UTILITY trung thực)
     - `diskFileCreated: true` (Tệp `scratch/hello.txt` tạo thật trên ổ đĩa)
     - `diskContentMatches: true` (Nội dung `HELLO UNION BOT` chính xác từng byte)
     - `diskByteSizeMatches: true` (15 bytes)
     - `diskDigestMatches: true` (SHA-256 CAS khớp)
     - `verifiedByCodex: true` (Có bằng chứng xác minh thực tế)
     - `codexZeroCostConfirmed: true` (Chi phí $0.00 được xác nhận)
     - `codexBoundaryVerified: true` (Ranh giới workspace được xác nhận)
     - `codexDigestVerified: true` (Mã băm SHA-256 được xác nhận)
     - `escapedFileBlocked: true` (Tệp vượt ranh giới không tồn tại trên đĩa)

2. **Kiểm thử Hồi quy Phase P9 (`tests/e2e/desktop-p9.test.js`):**
   - Lệnh thực thi: `node --test tests/e2e/desktop-p9.test.js`
   - Kết quả: **PASS (2/2 tests)** — Cả `P9-E2E` và `P9-PROD-E2E` đều vượt qua sạch sẽ. Blocker `P9-R03-002` không tái diễn.

3. **Kiểm thử GUI Smoke Test (`pnpm smoke:gui`):**
   - Kết quả: **PASS** — Cửa sổ hiển thị bình thường, CostGuard bảo vệ egress, IPC hoạt động tin cậy.

4. **Kiểm thử Quét Bí mật (`python scan_secrets.py --strict`):**
   - Kết quả: **PASS** — 911 tệp được quét, **0 leaks**.

5. **Kiểm tra Kiểu dữ liệu & Biên dịch Giao diện:**
   - Lệnh thực thi: `pnpm typecheck; pnpm build`
   - Kết quả: **0 errors**, bundle hoàn thành trong 1.19s.
