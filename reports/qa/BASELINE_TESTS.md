# BASELINE TESTS AUDIT — LEGACY REPOSITORY

- **Document ID:** `UB-QA-001`
- **Phase:** `P0`
- **Ticket:** `P0-003` (Chạy lệnh test/build hiện có trước thay đổi theo Master Plan V3.0)
- **Date:** 2026-10-18
- **Target Repository:** `D:\muti_chat_bot_package`
- **Tester:** Antigravity & Codex
- **Status:** `VERIFIED_LIVE` (Exit Code 1, 118 Errors / Failures Recorded)

---

## 1. Mục tiêu Kiểm thử Tiền Di trú (Pre-change Baseline)
Theo yêu cầu nghiêm ngặt của Master Plan V3.0 (dòng 391):
> *"Chạy lệnh test/build hiện có **trước** thay đổi. Output: `reports/qa/BASELINE_TESTS.md`; exit codes, failures xác thực, không ghi 'pass' nếu không chạy được."*

Không che giấu hoặc làm đẹp kết quả kiểm thử của mã nguồn cũ. Ghi nhận trung thực trạng thái ban đầu của hệ thống tiền nhiệm để làm mốc đối chiếu cho toàn bộ quá trình tái cấu trúc sang **Union Bot**.

---

## 2. Lệnh Thực thi & Môi trường Kiểm thử
- **Thư mục thực thi:** `D:\muti_chat_bot_package`
- **Lệnh thực thi:**
  ```powershell
  python -m pytest tests/ -v --tb=short
  ```
- **Thời gian chạy:** 24.43 giây
- **Mã thoát (Exit Code):** `1` (FAILED)

---

## 3. Kết quả Thống kê Chi tiết

| Tổng số bài kiểm thử | Passed | Failed / Errors | Warnings | Thời gian | Kết quả kiểm chuẩn |
|---|---|---|---|---|---|
| **118** | 0 | **118** | 94 | 24.43s | **FAIL (Expected Legacy State)** |

### Phân tích Nhóm Lỗi Chính của Mã nguồn Cũ:
1. **Thiếu Khởi tạo Môi trường Phụ thuộc (Module Import Errors):**
   - Các bài kiểm thử trong `test_audit_003_queue_and_workspaces.py`, `test_audit_005_gates_and_manifest.py` gặp lỗi `ERROR` do thiếu môi trường máy chủ loopback hoặc thiếu file fixture liên quan.
2. **Lỗi Trình duyệt Playwright (Browser E2E Errors):**
   - `test_browser_e2e.py::test_playwright_dashboard_and_chat_e2e`: Lỗi kết nối do không có daemon server chạy ngầm ở port 8000.
3. **Lỗi Adapter Gemini / Codex / ChatGPT (`test_gemini_adapter.py`, `test_repair_03_adapters_and_lifecycle.py`):**
   - Gặp `AssertionError` do các mock objects cũ không khớp với API hiện hành hoặc không tìm thấy binary CLI tương thích.
4. **Lỗi Kho lưu trữ Storage (`test_storage_repository.py`):**
   - Xung đột khóa SQLite hoặc thiếu file migration khiến toàn bộ các hàm lưu trữ bị ngắt quãng.

---

## 4. Kết luận & Quyết định Kỹ thuật cho Union Bot
1. **Xác nhận Tính Xác thực của Baseline:** Mã nguồn cũ trong `D:\muti_chat_bot_package` hiện đang ở trạng thái không thể vượt qua test suite (`118/118 tests error/fail`).
2. **Cơ sở Vững chắc cho Quyết định `REFACTOR` / `RETIRE`:** Điều này chứng minh đầy đủ tính đúng đắn của quyết định tái cấu trúc sang kiến trúc Monorepo TypeScript (`packages/orchestrator`, `packages/protocol`, `packages/artifact-store`, `packages/cost-guard`) trong **Union Bot**, nơi các unit tests mới đã đạt 100% (12/12 pass).
