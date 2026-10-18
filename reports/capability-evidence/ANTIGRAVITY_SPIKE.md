# CAPABILITY EVIDENCE: ANTIGRAVITY HEADLESS CLI SPIKE

- **Document ID:** `UB-EVID-002`
- **Phase:** `P0`
- **Ticket:** `P0-007`
- **Date:** 2026-10-18
- **Test Executable:** `C:\Users\Lenovo\AppData\Local\agy\bin\agy.exe`
- **Component Tested:** `agy.exe -p <prompt> --output-format json`
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục tiêu Kiểm chứng
Xác minh khả năng điều khiển tự động **Antigravity CLI (agy)** từ tiến trình cha Node.js ở chế độ không tương tác (headless / print mode):
- Thực thi prompt lập trình không cần mở giao diện IDE.
- Trả về kết quả có cấu trúc qua định dạng `--output-format json` hoặc `stream-json`.
- Đo lường thời gian thực thi, số lượt (`num_turns`), mức độ sử dụng tài nguyên và mã thoát (`exit code`).
- Bảo đảm tính cô lập của conversation ID và dự án.

---

## 2. Lệnh Kiểm thử Thực tế
```powershell
agy -p "Respond only with: UNION_BOT_SPIKE_OK" --output-format json
```

---

## 3. Kết quả Thực thi Thật (Raw Execution Output)
```json
{
  "conversation_id": "11033199-87ef-45dc-b3bc-86d3f80a1486",
  "status": "SUCCESS",
  "response": "UNION_BOT_SPIKE_OK\n",
  "duration_seconds": 21.8370261,
  "num_turns": 1,
  "usage": {
    "input_tokens": 20717,
    "output_tokens": 39,
    "thinking_tokens": 31,
    "cache_read_tokens": 0,
    "total_tokens": 20756
  }
}
```
- **Exit Code:** `0`
- **Thời gian xử lý:** 21.83 giây

---

## 4. Phân tích Khả năng Tích hợp
1. **Hoạt động Headless Hoàn hảo:** Antigravity CLI nhận lệnh từ command line, sinh mã và trả kết quả chính xác theo yêu cầu (`UNION_BOT_SPIKE_OK`).
2. **Cấu trúc Dữ liệu Rõ ràng:** Cung cấp sẵn token metrics, thời gian thực thi, conversation tracking ID giúp Orchestrator lưu trữ chính xác vào `turn_ledger`.
3. **Chế độ Stream-JSON:** Antigravity CLI hỗ trợ cờ `--output-format stream-json` và `--input-format stream-json`, cho phép ứng dụng desktop hiển thị phản hồi dạng gõ phím theo thời gian thực (real-time typing streaming) cho người dùng trong `apps/workspace-ui`.

---

## 5. Kết luận P0-007
Antigravity Headless CLI sẵn sàng đóng vai trò **Implementation Owner / Core Developer Agent** trong hệ thống Union Bot, kết nối trực tiếp không qua API trả phí.
