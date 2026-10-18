# CAPABILITY EVIDENCE: CODEX APP SERVER SPIKE & MULTI-TURN RPC

- **Document ID:** `UB-EVID-001`
- **Phase:** `P0`
- **Ticket:** `P0-006` (Khắc phục phát hiện `UB-R01-003` của Technical Leader)
- **Date:** 2026-10-18
- **Test Executable:** `C:\Users\Lenovo\AppData\Roaming\npm\codex.ps1`
- **Component Tested:** `codex app-server --stdio`
- **Author:** Antigravity & Codex
- **Status:** `VERIFIED_LIVE` (Exit code 0, thread/start + turn/start + turn/completed Full Turn Lifecycle Verified)

---

## 1. Mục tiêu Kiểm chuẩn Theo Chỉ thị Leader Review R01 & R02
Giải quyết triệt để phát hiện `UB-R01-003` và phản hồi R02 của Technical Leader:
> *"Codex mới báo cáo handshake initialize, chưa chứng minh chạy một turn thật. Phải gọi thread/start, turn/start và xác nhận turn/completed."*

---

## 2. Khảo sát Lược đồ Giao thức Đầy đủ (Generated Schema)
Lệnh sinh schema giao thức:
```powershell
codex app-server generate-json-schema --out d:\WORK-TEAM\scratch\codex_schema
```
Đã phân tích toàn bộ 39 tệp JSON Schema trong `codex_schema`, xác nhận danh mục phương thức client hợp lệ:
- Khởi tạo: `initialize`
- Quản lý phiên: `thread/start`, `thread/read`, `thread/compact/start`
- Vòng lặp đàm thoại (Turn lifecycle): `turn/start`, `turn/steer`, `turn/interrupt`
- Sự kiện thông báo (ServerNotification): `turn/started`, `item/started`, `item/agentMessage/delta`, `item/completed`, `turn/completed`.

---

## 3. Mã nguồn Kịch bản Kiểm thử Thực tế (`test_codex_full_rpc.py`)
Kịch bản gửi liên tiếp chuỗi lệnh JSON-RPC 2.0 qua `stdio` tới tiến trình `codex app-server --stdio`:
1. `initialize` với `clientInfo`: `union-bot-agent/1.0.0`
2. `thread/start` để tạo phiên làm việc mới trên Codex daemon
3. `turn/start` gửi prompt thử nghiệm: `Respond with exactly: UNION_BOT_CODEX_TURN_VERIFIED`
4. Lắng nghe và xác nhận vòng đời turn: `turn/started` -> `item/agentMessage/delta` -> `item/completed` -> `turn/completed`.

---

## 4. Nhật ký Thực thi Thật (Full Turn Execution Log)
```
=== Testing Codex App Server Real Turn Execution (thread/start & turn/start) ===
1. Sending initialize...
   Initialized successfully!
2. Sending thread/start...
   Thread started successfully with ID: 01a14f60-bb27-7ed2-a5d5-d000ce065a51
3. Sending turn/start with test prompt...
   Notification: turn/started (Turn ID: None)
   Notification: item/completed (type: userMessage)
   Notification: item/completed (type: agentMessage)
   Notification: turn/completed (Turn ID: None)

Total messages received: 35
Turn started: True
Turn completed: True
Agent response text: 'UNION_BOT_CODEX_TURN_VERIFIED'
=== TEST RESULT: PASS (Full Turn Execution Verified) ===
```

- **Mã thoát (Exit Code):** `0`
- **Kết quả xác nhận:**
  - `initialize` thành công.
  - `thread/start` tạo thành công thread ID: `01a14f60-bb27-7ed2-a5d5-d000ce065a51`.
  - `turn/start` kích hoạt thành công turn prompt.
  - Nhận đầy đủ chuỗi notifications: `turn/started`, `item/completed` (userMessage), `item/completed` (agentMessage), và `turn/completed`.
  - Agent sinh văn bản phản hồi khớp 100%: `'UNION_BOT_CODEX_TURN_VERIFIED'`.
  - Toàn bộ 35 messages JSON-RPC được lưu trữ tại `scratch/codex_live_turn_evidence.json`.

---

## 5. Kết luận P0-006 & R02 Resolution
Đã chứng minh 100% vòng đời một Turn thực tế (`thread/start` + `turn/start` -> `turn/completed`) của Codex App Server qua JSON-RPC stdio hoạt động trơn tru trên môi trường Windows.
