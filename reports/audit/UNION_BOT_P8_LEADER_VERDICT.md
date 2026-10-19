# BÁO CÁO THẨM ĐỊNH CỦA TECHNICAL LEADER — PHASE P8 (ROUND R01)

- **Thời gian thẩm định:** 2026-10-20
- **Trạng thái:** `CHANGES_REQUIRED / GO_P9 BLOCKED`
- **Phiên làm việc:** ChatGPT Web Session (`https://chatgpt.com/c/6ad64b63-ad44-83ec-90ca-83cacbc26da5`)
- **Commit được thẩm định:** `2383a634e58f78515d90839c159f4e113ba320b8`

---

## 1. Nội dung thẩm định chi tiết từ Technical Leader

> **CHANGES REQUIRED — P8 CHƯA ĐƯỢC PHÊ DUYỆT GO_P9**
>
> Tôi đã audit trực tiếp commit `2383a634e58f78515d90839c159f4e113ba320b8`, `REVIEW_PACKET_P8.md`, core `task-graph.ts`, CJS Electron service, unit tests và `ELECTRON_P8_E2E_EVIDENCE.json`.
>
> DAG/cycle detection, canonical boundary và phần lớn schema/IPC implementation là có thật. Tuy nhiên có 3 blocker ở chính Consensus/Orchestration core, nên chưa thể ký `APPROVED — GO_P9`.

### P8-R01-001 — BLOCKER: Consensus có thể tự phê duyệt khi không có vote thật
Trong `executeNode()`, nếu REVIEW không trả vote:
```typescript
if (node.votes.length === 0) {
  this.submitVote(graph.id, node.id, {
    voterId: `agent-${node.assignedRole.toLowerCase()}`,
    voterRole: node.assignedRole,
    decision: 'APPROVE',
    rationale: 'Review approved by assigned agent policy',
  });
}
```
- Điều này đặc biệt nguy hiểm vì standard pipeline gán REVIEW là `QA_SECURITY`.
- Kết quả: không có QA agent nào thực sự review, engine vẫn tự tạo `QA_SECURITY: APPROVE` và thỏa `requiredRoles`.
- E2E hiện tại cũng không chứng minh consensus thật. Check `results.consensusVotesRecorded` chỉ kiểm tra có node REVIEW, không kiểm tra vote nào tồn tại.
- **Yêu cầu:** Tuyệt đối không synthesize APPROVE. Thiếu required vote phải `WAITING_APPROVAL` hoặc fail-closed.

---

### P8-R01-002 — BLOCKER: Review REJECT → FIX không chạy được qua runGraph()
Khi consensus thất bại:
```typescript
node.status = 'FAILED';
...
candidate FIX.status = 'PENDING';
```
Nhưng `node-fix` phụ thuộc `node-review`, và `getRunnableNodes()` chỉ cho dependency: `COMPLETED || SKIPPED`.
Do REVIEW đang `FAILED`, FIX không runnable.
Sau đó `runGraph()` gặp:
```
runnable.length === 0 + anyFailed === true → graph.status = FAILED
```
Vì vậy vòng tự động được mô tả:
`Review → Reject → Fix → Re-review → Verify`
thực tế không hoạt động trong graph scheduler.
Unit test P8-012 che khuất lỗi này vì nó không dùng `runGraph()` để kiểm tra vòng remediation. Test tự gọi:
```typescript
executeNode(review)
executeNode(fix)
review.status = 'PENDING'
executeNode(review)
executeNode(verify)
```
tức là test tự điều phối bằng tay và bypass dependency scheduler cần được nghiệm thu.

---

### P8-R01-003 — SECURITY BLOCKER: Vote identity/role chưa được xác thực
IPC expose: `union-bot:task-graph-submit-vote` và `submitVote()` hiện đẩy thẳng:
```typescript
node.votes.push({
  ...vote,
  timestamp: ...
});
```
Không thấy binding giữa:
`voterId ↔ authenticated agent/session ↔ assigned reviewer ↔ voterRole`
cũng không chống một voter gửi nhiều phiếu.
Do đó caller được IPC cho phép có thể khai báo:
```json
{
  "voterId": "fake-security",
  "voterRole": "QA_SECURITY",
  "decision": "APPROVE"
}
```
và góp phần thỏa `requiredRoles`.
Consensus engine tính toán đúng trên dữ liệu đầu vào, nhưng nguồn gốc phiếu chưa đáng tin cậy.

---

## 2. Kế hoạch khắc phục Round R02 (Yêu cầu bắt buộc)

1. **No synthetic approval:**
   - Không có vote ⇒ không consensus.
   - Required role thiếu ⇒ fail-closed / `WAITING_APPROVAL`.
2. **Sửa state machine remediation:**
   - `runGraph()` phải tự chạy thật vòng lặp hoàn chỉnh:
     `PLAN → IMPLEMENT → REVIEW (reject) → FIX → REVIEW (lại) → VERIFY`.
   - Không được test bằng cách manually reset state từ bên ngoài.
   - Dependency scheduler phải hỗ trợ dependency từ node REVIEW khi REVIEW reject và kích hoạt FIX.
3. **Trusted vote registry & binding:**
   - Vote phải gắn với voter đã đăng ký trong trusted voter/reviewer registry hoặc session/agent lookup.
   - Role của voter được xác thực từ registry, không cho phép caller tự khai khống `voterRole`.
   - Idempotency & deduplication: Một voter chỉ có 1 active vote cho một target version/digest (hoặc replace có kiểm soát).
   - Vote phải gắn với `reviewedDigest` (hash nội dung/artifact được review). Khi code/artifact thay đổi (`currentDigest !== reviewedDigest`), vote lập tức bị từ chối hoặc vô hiệu hóa (`ERR_STALE_VOTE_DIGEST`).
4. **Hệ thống kiểm thử hồi quy bắt buộc (Regression Suite):**
   - Missing-vote fail-closed / waiting.
   - Forged QA_SECURITY vote denied (`ERR_UNAUTHORIZED_VOTER` hoặc `ERR_ROLE_MISMATCH`).
   - Duplicate-voter handled deterministically (update vote thay vì duplicate vote).
   - Stale digest vote denied (`ERR_STALE_VOTE_DIGEST`).
   - Full automated `runGraph()` rejection → fix → re-review → verify success path không can thiệp thủ công.
   - Real Electron E2E kiểm tra real votes, authenticated voter identity, reviewed digest, và required-role approval.
