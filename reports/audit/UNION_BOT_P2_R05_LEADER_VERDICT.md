# UNION BOT — Independent Technical Review P2 R05
**Reviewer:** Technical Leader (ChatGPT Web)
**Date:** 2026-10-19
**Evaluated Commit:** `e5d37b0c2442442b61995c5775ac5ec1b2c85677`
**Target Branch:** `main`
**Handoff Review Packet Evaluated:** `reports/handoff/REVIEW_PACKET_P2_R05.md`

---

## 1. Kết Quả Đối Với Ba Blocker S1 Từ R04

| Blocker | Kết quả review mã nguồn |
| :--- | :--- |
| **UB-P2-R04-01** — Schema và checksum | **PASS** — Đã dùng chung migration registry; có test mở chéo database. |
| **UB-P2-R04-02** — Atomic approval | **PASS** — Approval CAS và envelope/event/outbox đã nằm trong cùng transaction. |
| **UB-P2-R04-03** — Action replay | **PASS** — Đã kiểm tra durable idempotency trước khi tiêu thụ approval. |

*Xác nhận:* Ba bản sửa này có thật trong production source, không chỉ được mô tả trong báo cáo. Bộ kiểm thử cũng đã bổ sung các trường hợp mở chéo SQLite, rollback, replay và Electron kill/restart.

---

## 2. Ba Phát Hiện Chưa Đạt Gate P2 (Round R06 Directives)

| Mã | Mức độ | Phát hiện qua kiểm tra source |
| :--- | :--- | :--- |
| **`R05-F01`** | **S1 — Security** | Một envelope có nhiều action nhưng Orchestrator chỉ chuyển approval của action cuối tới SQLite (`approvalRequirement` bị ghi đè trong vòng lặp). Các action trước có thể chưa được xác thực token riêng. |
| **`R05-F02`** | **S1 — Data Integrity** | Migration thực hiện `ALTER TABLE` và `CREATE INDEX` trước khi xác minh checksum/version. Database không tương thích hoặc tampered có thể bị sửa đổi dù sau đó hệ thống từ chối mở. |
| **`R05-F03`** | **S1 — Approval Activation** | Renderer có thể gọi IPC để tạo và duyệt token liên tiếp. Main process tạo principal `OPERATOR`, nhưng chưa có bước chứng minh người dùng thực sự xem và chấp thuận action. Cần yêu cầu explicit human confirmation (`confirmedByUser`). Ngoài ra, IPC `test-kill-worker` không được mở ở production. |

---

## 3. Hướng Dẫn Sửa Mã Nguồn Cụ Thể

1. **F01 — Multi-action Approval (`apps/desktop/src/orchestrator.cjs`, `packages/orchestrator/src/orchestrator.ts`):**
   - Từ chối envelope có nhiều hơn 1 action part (`actionParts.length > 1`) với lỗi `ERR_MULTI_ACTION_UNSUPPORTED: Multiple action parts per envelope are not supported in atomic approval protocol` cho đến khi hỗ trợ atomic approval đa action.
   - Đảm bảo nếu một envelope có nhiều action mà một action có token giả, toàn bộ envelope bị DENY fail-closed.
2. **F02 — Migration Atomicity (`packages/storage/src/schema-definition.cjs`, `apps/desktop/src/schema-definition.cjs`):**
   - Kiểm tra `user_version` và migration checksum TRƯỚC khi thực hiện bất kỳ DDL nào (`ALTER TABLE`, `CREATE INDEX`).
   - Nếu database tampered hoặc version tương lai: lập tức ném `ERR_MIGRATION_TAMPERED` mà KHÔNG chạy bất kỳ câu lệnh DDL nào, bảo toàn 100% nguyên trạng database.
3. **F03 — Human Consent & Test Channel Isolation (`apps/desktop/src/main.js`, `apps/desktop/src/preload.cjs`):**
   - Trong `union-bot:approve-token`: Bắt buộc `decisionContext.confirmedByUser === true` (hoặc `decisionContext.userConfirmed === true`). Nếu renderer tự gọi mà không có flag xác nhận người dùng rõ ràng -> từ chối với `ERR_HUMAN_CONFIRMATION_REQUIRED`.
   - Trong `union-bot:test-kill-worker`: Chỉ cho phép khi ứng dụng chạy ở test mode (`process.env.NODE_ENV === 'test'` hoặc flags `--headless` / `--r04-e2e` / `--r05-e2e` / `--r06-e2e`). Ở production bình thường: từ chối fail-closed với `ERR_TEST_IPC_DISABLED`.
4. **F05 — Storage Lookup Error In-Memory Defense (`apps/desktop/src/orchestrator.cjs`):**
   - Khi storage lookup bị lỗi kết nối hoặc storage worker disconnected, KHÔNG được fallback trả cached ACK từ RAM giả như thể vừa truy vấn SQLite thành công. Phải trả lỗi fail-closed `ERR_STORAGE_UNAVAILABLE`.

---

## 4. Sáu Chỉ Thị Kiểm Thử Bắt Buộc (R06-B01 .. R06-B06)

| Vector | Điều kiện bắt buộc |
| :--- | :--- |
| **`R06-B01`** | Action đầu có token giả, action sau có token hợp lệ → toàn bộ envelope bị DENY. |
| **`R06-B02`** | DB future/tampered → lỗi được báo, không có bất kỳ thay đổi schema hay dữ liệu nào. |
| **`R06-B03`** | Script renderer tự gọi `approveToken()` nhưng không có xác nhận người dùng (`confirmedByUser !== true`) → không được APPROVED (`ERR_HUMAN_CONFIRMATION_REQUIRED`). |
| **`R06-B04`** | Chạy lại migration cross-engine TS/native/worker bảo đảm 100% nhất quán. |
| **`R06-B05`** | Storage lookup lỗi (worker ngắt kết nối) → không trả cached ACK giả từ RAM, báo `ERR_STORAGE_UNAVAILABLE`. |
| **`R06-B06`** | Renderer production không được truy cập IPC dùng để kill worker kiểm thử (`testKillWorker` bị vô hiệu hóa fail-closed khi không ở test mode). |

---

## 5. Quyết Định Chính Thức (Official Verdict)

**Verdict:** `CHANGES_REQUIRED — GO_P3_NOT_YET — P3_OFFLINE_UI_SCAFFOLD_ALLOWED`

- Ghi nhận 154/154 tests PASS ở mức TEAM_EXECUTED.
- Ba blocker cũ đã đạt, không cần làm lại.
- Chỉ cần khép các bất biến còn thiếu trong văn bản này, sau đó nộp `REVIEW_PACKET_P2_R06.md`.
- Giao diện Desktop Workspace P3 vẫn được phép triển khai song song.
