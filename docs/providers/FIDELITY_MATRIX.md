# RICH RESPONSE FIDELITY MATRIX — UNION BOT

- **Document ID:** `UB-PROV-002`
- **Phase:** `P0`
- **Ticket:** `P0-015`, `P5-013`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Định nghĩa Mức độ Bảo toàn Đa phương thức (Fidelity Tiers)
Nhằm chống hiện tượng AI "nói có nhưng không làm" và không đánh đồng ảnh chụp màn hình với file gốc:
- **`PORTABLE_BYTES`**: Tệp tin hoặc dữ liệu nhị phân hoàn chỉnh được bảo toàn nguyên vẹn byte và hash SHA256 (ví dụ: file PDF tải về, ảnh gốc PNG/JPG, file mã nguồn).
- **`NATIVE_VIEW`**: Hiển thị trực tiếp trong môi trường gốc của nhà cung cấp (ví dụ: giao diện Canvas của ChatGPT, Artifacts của Claude) mà không thể trích xuất toàn bộ trạng thái tương tác ra ngoài.
- **`INTERACTIVE_COMPATIBLE`**: Tiện ích tương tác có thể render an toàn trong sandbox cục bộ của Union Bot (ví dụ: biểu đồ Mermaid, HTML/SVG tĩnh, công cụ MCP).
- **`REFERENCE_ONLY`**: Chỉ lưu URL hoặc trích dẫn tham chiếu, người dùng mở bằng trình duyệt hệ thống hoặc tab nhúng.
- **`UNAVAILABLE`**: Tính năng độc quyền không hỗ trợ xuất hay tương tác ngoài nền tảng của nhà cung cấp.
- **`NOT_TESTED`**: Chưa kiểm thử trong phiên hiện tại.

---

## 2. Bảng Ma trận Độ trung thực theo Nhà Cung Cấp

| Loại dữ liệu / Modality | Antigravity (Local) | Codex (Local) | ChatGPT (Web) | Gemini (Web) | Claude (Web) | DeepSeek (Web) |
|---|---|---|---|---|---|---|
| **Văn bản định dạng (Markdown / Tables)** | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` |
| **Khối mã nguồn (Code Blocks)** | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` |
| **Hình ảnh tĩnh (PNG / JPG / WEBP)** | `PORTABLE_BYTES` | `REFERENCE_ONLY` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` |
| **Tài liệu Tệp (PDF / DOCX / TXT)** | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` |
| **Trích dẫn & Liên kết Nguồn (Citations)** | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` | `PORTABLE_BYTES` |
| **Kết quả Công cụ (Tool / Execution Outputs)**| `PORTABLE_BYTES` | `PORTABLE_BYTES` | `NATIVE_VIEW` | `NATIVE_VIEW` | `NATIVE_VIEW` | `NATIVE_VIEW` |
| **Tiện ích Tương tác (Widgets / Canvas / Artifacts)**| `INTERACTIVE_COMPATIBLE` | `UNAVAILABLE` | `NATIVE_VIEW` | `UNAVAILABLE` | `NATIVE_VIEW` | `UNAVAILABLE` |
| **Plugin / GPTs / Gems Độc quyền** | `UNAVAILABLE` | `UNAVAILABLE` | `NATIVE_VIEW` | `NATIVE_VIEW` | `UNAVAILABLE` | `UNAVAILABLE` |

---

## 3. Quy tắc Bắt buộc Khi Chuyển Giao Dữ liệu (Cross-AI Handoff Rule)
1. **Tuyệt đối không gọi Screenshot là File gốc:** Nếu một hình ảnh là ảnh chụp màn hình của văn bản/trang web, trường metadata phải ghi rõ `fidelity: "screenshot_only"`.
2. **Tuyệt đối không gọi Preview là File bytes:** Bản xem trước PDF thu nhỏ phải đánh dấu `fidelity: "rendered_preview"`, chỉ khi người dùng tải file bytes thực sự về và khớp SHA256 thì mới gắn nhãn `fidelity: "original_bytes"`.
3. **Giữ nguyên nhãn Provenance:** Mọi phần nội dung (part) phải ghi nhận nguồn gốc: `source_actor`, `provider`, `turn_id`, `capture_method` (`auto_captured` hoặc `user_manual`).

---

## 4. Kết luận P0-015
Hệ thống Union Bot có khung phân định rõ ràng về năng lực biểu diễn dữ liệu của từng đối tác AI, bảo đảm tính minh bạch tuyệt đối với người dùng.
