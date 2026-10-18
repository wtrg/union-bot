# PRODUCT RELEASE SCOPE & TIERS DECISION — UNION BOT

- **Document ID:** `UB-PROD-001`
- **Phase:** `P0`
- **Ticket:** `P0-018`
- **Date:** 2026-10-18
- **Deciders:** Product Owner (User), ChatGPT (Technical Leader), Antigravity (Implementation Owner)
- **Status:** `ACCEPTED_AND_FROZEN`

---

## 1. Định nghĩa 4 Cấp độ Phát hành (Release Tiers)

Để chấm dứt việc tự xưng "đã hoàn thành" khi mới chỉ dựng xong giao diện hoặc chỉ có vài chatbot độc lập, **Union Bot** thiết lập 4 cấp độ phát hành nghiêm ngặt:

```
[T0: Desktop Ready] 
       ↓
[T1: Agent Collab Verified] (Codex + Antigravity Live Loop)
       ↓
[T2: Six Provider Workspace] (6 Profiles + Manual Share Truth)  <-- [MỤC TIÊU CỐT LÕI UNION BOT]
       ↓
[T3: Full Automated Six AI] (Chỉ khi 6 bên hỗ trợ API tự động chính thức & 0đ)
```

| Tier | Tên Trạng thái Sản phẩm | Điều kiện Bắt buộc Đạt Chuẩn | Giới hạn & Điều Cấm Tuyên Bố |
|---|---|---|---|
| **`T0`** | `UNION_BOT_DESKTOP_READY` | Ứng dụng desktop Windows (.exe) cài đặt và khởi chạy hoàn hảo; quản lý project, phòng làm việc (rooms), tệp tin, trình duyệt nhúng, lưu trữ SQLite và bảo mật 0đ hoạt động 100%. | **Tuyệt đối không tuyên bố** "Các AI tự động làm việc chung". Đây chỉ là nền tảng máy trạm sẵn sàng. |
| **`T1`** | `UNION_BOT_AGENT_COLLAB_VERIFIED` | Hai tác tử **Antigravity** (Core Dev) và **Codex** (QA/Review) chạy trực tiếp (Live) cục bộ không dùng mock, hoàn thành trọn vẹn chu trình tự động: `Lập trình → Kiểm thử/Soát lỗi → Sửa lỗi → Thẩm tra`, truyền tệp và đối chiếu hash SHA256 thành công. | **Tuyệt đối không suy diễn** rằng 4 nhà cung cấp web (ChatGPT, Gemini, Claude, DeepSeek) cũng tự động hóa tương tự. |
| **`T2`** | `UNION_BOT_SIX_PROVIDER_WORKSPACE` | Cả 6 nhà cung cấp AI đều có phân vùng trình duyệt nhúng riêng biệt, cơ chế chia sẻ thủ công có xác thực (`MANUAL_SHARE`), bảo đảm phiên đăng nhập, bảng đánh giá năng lực trung thực (`Capability Truth`), tích hợp với T1. | **Tuyệt đối không quảng cáo** "6 AI tự động tranh luận" nếu các web AI chỉ đang vận hành qua tương tác thủ công. |
| **`T3`** | `UNION_BOT_FULL_AUTOMATED_SIX_AI` | Toàn bộ 6 nhà cung cấp AI đều tự động gửi/nhận lệnh, đối chiếu lượt phản hồi chính xác, đồng bộ tệp tin tự động và được phép bởi điều khoản dịch vụ mà không phát sinh bất kỳ khoản phí nào (0 VNĐ). | **Không thể đạt được bằng mock**, script scraping lậu vi phạm điều khoản dịch vụ, hay dùng API trả tiền. |

---

## 2. Quyết định Mục tiêu Bàn giao cho Phiên bản Đầu tiên
1. **Mục tiêu Cam kết Bàn giao:** Đạt **`T1 + T2`** làm chuẩn nghiệm thu chính thức của sản phẩm **Union Bot v1.0.0**:
   - Người dùng có một ứng dụng máy trạm Windows hoàn chỉnh, chuyên nghiệp.
   - Vòng lặp cộng tác lập trình tự động thật giữa Antigravity và Codex chạy cục bộ 100% mượt mà, chất lượng cao.
   - 4 AI hàng đầu thế giới (ChatGPT, Gemini, Claude, DeepSeek) cùng làm việc trong một không gian duy nhất, chia sẻ tài liệu và hình ảnh vào phòng họp chung với độ trung thực cao.
   - Tuyệt đối 0 phát sinh chi phí dịch vụ (0 VNĐ).
2. **Trạng thái Tier T3:** Được định vị là mục tiêu nghiên cứu và phát triển nâng cao có điều kiện; chỉ kích hoạt khi các nhà cung cấp phát hành cơ chế tự động hóa miễn phí chính thức mà không vi phạm chính sách bảo mật.

---

## 3. Tiêu chí Đóng Cổng Pha (Phase Gate Exit Criteria)
Mỗi bản phát hành bàn giao cho Product Owner và Technical Leader phải nêu rõ chính xác cấp độ Tier đã đạt được kèm theo bộ chứng cứ (`EVIDENCE_DOSSIER`), log kiểm thử và mã hash.

---

## 4. Kết luận P0-018
Phạm vi sản phẩm và tiêu chuẩn chất lượng đã được khóa chặt chẽ. Hệ thống định hướng phát triển thực chất, nói không với các tuyên bố giả tạo hoặc ảo tưởng về tính năng.
