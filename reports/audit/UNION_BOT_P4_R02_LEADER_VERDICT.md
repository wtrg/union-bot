# UNION BOT — Independent Review Phase P4 Round R02
**Status:** `CHANGES_REQUIRED`  
**Phán quyết:** `GO_P5_NOT_YET — P5_NON_EXECUTING_SCAFFOLD_ALLOWED`  
**Người đánh giá:** Technical Leader / Independent Reviewer (ChatGPT Web)  
**Ngày:** 2026-10-19  
**Commit cơ sở phê duyệt:** [`3f41df7c3dc67b2fd516c2cf32455be5734aa139`](https://github.com/wtrg/union-bot/commit/3f41df7c3dc67b2fd516c2cf32455be5734aa139) (HEAD của `main`)  
**Tài liệu đệ trình:** `reports/handoff/REVIEW_PACKET_P4_R02.md`

---

## 1. Đánh giá chung

- Đã kiểm tra commit `3f41df7c3dc67b2fd516c2cf32455be5734aa139` (HEAD của `main`), mã production, `REVIEW_PACKET_P4_R02.md`, ma trận OAuth và bằng chứng Electron E2E.
- Các bản vá R02 có thật: Đội đã cải thiện việc chặn loopback/metadata, kiểm tra URL trước khi tạo WebContentsView, cách ly session và sửa provenance của thao tác chia sẻ.
- Báo cáo 205/205 PASS ghi nhận từ Antigravity/Codex (`TEAM_EXECUTED`).

---

## 2. Kết quả sáu regression vectors Round R02

| Vector | Nội dung | Kết quả thẩm định |
| :--- | :--- | :--- |
| **T01** | Chặn tạo tab với URL nguy hiểm | **Đạt** |
| **T02** | Không vượt ranh giới provider khi điều hướng/redirect | **Đạt một phần**; test chưa bao phủ redirect thực tế |
| **T03** | Chặn private/loopback, security init fail-closed | **Bản sửa có thật**; nhánh lỗi khởi tạo chưa được fault-inject |
| **T04** | OAuth cùng partition | **Có allowlist**; chưa chứng minh phiên đăng nhập và popup được cô lập suốt vòng đời |
| **T05** | Provenance khi share từ tab nền | **Đã sửa** |
| **T06** | SQLite ghi thất bại không ACK/broadcast | **Bài test đang thử tab không tồn tại**, không thử lỗi ghi SQLite |

---

## 3. Ba phát hiện cần đóng trước GO_P5

### UB-P4-R02-001 — S1: Ranh giới OAuth chưa được bảo vệ xuyên suốt
- Tại `browser-service.cjs:125–191`, popup OAuth hợp lệ được mở bằng `action: 'allow'` và dùng session của provider. Nhưng các handler `will-navigate` và `will-redirect` hiện được gắn trên view cha, chưa có chính sách tương đương trên cửa sổ con.
- `isAllowedForProvider` so khớp hostname mà chưa bắt buộc HTTPS. Một URL dạng `http://accounts.google.com/` vẫn có thể vượt kiểm tra allowlist.
- **Yêu cầu:** Popup OAuth phải giữ đúng session, kiểm soát mọi điều hướng tiếp theo, từ chối HTTP trên các miền xác thực và có bài kiểm thử chuỗi redirect/callback thực tế hoặc bằng fixture được kiểm soát.

### UB-P4-R02-002 — S1: T06 chưa kiểm thử lỗi lưu SQLite
- Tại `main.js:2221–2227`, `t06FailClosedStorageHandled` được tính bằng cách gửi một `tabId` không tồn tại, hàm trả lỗi trước khi gọi SQLite.
- `shareSelection` đã bắt exception khi storage ném lỗi, nhưng cần kiểm tra thêm trường hợp storage trả về `{ success: false }`.
- **Yêu cầu:** Fault-inject hai trường hợp storage ném lỗi và storage trả `{ success: false }`; cả hai phải trả thất bại, không broadcast và không tạo tin nhắn giả.

### UB-P4-R02-003 — S2: Nút "+ Add Tab" chưa hoạt động đúng
- Trong `BrowserPanel.tsx:179–183`, nút tạo tab mới chỉ gửi `providerId: 'search'` mà không gửi URL.
- `browser-service.cjs:309–337` kiểm tra `validateUrl(url)` trước khi áp dụng URL mặc định, khiến thao tác tạo tab bị từ chối.
- **Yêu cầu:** Nếu không cung cấp URL, backend dùng `defaultUrl` từ provider registry rồi mới kiểm tra chính sách; E2E phải click chính nút Add Tab và xác nhận tab mới xuất hiện.

---

## 4. Chỉ thị R03 — Bốn regression vectors bắt buộc

| Vector | Điều kiện PASS |
| :--- | :--- |
| **P4-R03-A01** | Popup OAuth và redirect được kiểm soát trong cùng partition, HTTP auth bị DENY |
| **P4-R03-A02** | SQLite ghi thất bại hoặc trả `{ success: false }` → không ACK, không broadcast |
| **P4-R03-A03** | Click "+ Add Tab" → tạo tab Search có URL mặc định, đúng partition |
| **P4-R03-A04** | Navigate/redirect ngoài provider → không làm nhiễm provider partition; test kiểm tra đích thực |

---

## 5. Phán quyết chính thức

`CHANGES_REQUIRED — GO_P5_NOT_YET — P5_NON_EXECUTING_SCAFFOLD_ALLOWED`

Hồ sơ tiếp theo: `reports/handoff/REVIEW_PACKET_P4_R03.md`.
