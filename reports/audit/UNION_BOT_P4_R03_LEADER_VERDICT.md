# UNION BOT — Independent Review Phase P4 Round R03
**Status:** `CHANGES_REQUIRED`  
**Phán quyết:** `GO_P5_NOT_YET — P5_NON_EXECUTING_SCAFFOLD_ALLOWED`  
**Người đánh giá:** Technical Leader / Independent Reviewer (ChatGPT Web)  
**Ngày:** 2026-10-19  
**Commit cơ sở thẩm định:** [`ea0d9d602257d59ddc07b72e51a047c688df5ad4`](https://github.com/wtrg/union-bot/commit/ea0d9d602257d59ddc07b72e51a047c688df5ad4) (HEAD của `main`)  
**Tài liệu đệ trình:** `reports/handoff/REVIEW_PACKET_P4_R03.md`

---

## 1. Kết luận thẩm định mã nguồn (Production Code Status)

Đã xác minh commit `ea0d9d6` là HEAD của `main`, đối chiếu mã production, `REVIEW_PACKET_P4_R03.md` và evidence Electron.

Cả ba lỗi production R02 đã được khắc phục hoàn toàn về mặt mã nguồn:
1. **OAuth:** Bắt buộc HTTPS cho miền xác thực, thêm `will-navigate` và `will-redirect` trên cửa sổ popup con (`did-create-window`).
2. **SQLite:** `shareSelection` từ chối cả trường hợp storage ném exception và trả `{ success: false }`.
3. **Add Tab:** Backend đã lấy `defaultUrl` trước khi kiểm tra URL, cho phép tạo tab Search khi UI không truyền URL.

Đây là tiến triển thực chất. Không có lỗi kiến trúc P4 mới nào được ghi nhận.

---

## 2. Ma trận nghiệm thu bốn regression vectors R03

| Vector | Kết quả thẩm định | Yêu cầu hoàn thiện bằng chứng |
| :--- | :--- | :--- |
| **`P4-R03-A01`** (OAuth popup) | **Chưa đủ bằng chứng E2E** | E2E mới kiểm tra điều hướng HTTP/HTTPS trên tab Gemini; cần kiểm thử tạo cửa sổ popup con (`window.open`) và bảo vệ redirect của cửa sổ con. |
| **`P4-R03-A02`** (SQLite failure) | **Đạt (PASS)** | Có fault injection cho cả hai kiểu lỗi (`throw` và `return_false`). Có thể bổ sung bộ đếm sự kiện IPC để chứng minh 0 phát broadcast giả. |
| **`P4-R03-A03`** (Add Tab) | **Chưa đủ bằng chứng E2E** | E2E có click Add Tab, nhưng tìm một tab Search bất kỳ sau click. Test đã tạo Search tab từ bước A04 trước đó, nên cần so sánh ID và số lượng tab trước/sau click (`newCount === initialCount + 1`, ID mới). |
| **`P4-R03-A04`** (Search partition) | **Đạt (PASS)** | Điều hướng ngoài ranh giới trên tab ChatGPT tự động mở tab search riêng, giữ nguyên phiên ChatGPT. Không cần sửa thêm. |

---

## 3. Chỉ thị tiếp theo cho Round R03B Addendum

1. **Phạm vi kiểm thử:**
   - Antigravity và Codex chỉ cần nộp một **addendum kiểm chứng** cho `A01` và `A03`, không phải một vòng audit P4 mới.
   - Với `A02`, bổ sung bộ đếm sự kiện IPC `union-bot:envelope-received` để chứng minh không phát broadcast giả.
2. **Hồ sơ yêu cầu:**
   - Tạo hồ sơ: `reports/handoff/REVIEW_PACKET_P4_R03B_ADDENDUM.md` cùng bằng chứng E2E cập nhật (`ELECTRON_P4_E2E_EVIDENCE.json`).
3. **Điều kiện đóng Phase P4:**
   - Sau khi hai điều kiện bằng chứng E2E này được chứng minh, Technical Leader sẽ ký quyết định đóng P4 (`APPROVED — GO_P5 — P4_ACCEPTED`) mà không cần rà soát lại toàn bộ hệ thống.
