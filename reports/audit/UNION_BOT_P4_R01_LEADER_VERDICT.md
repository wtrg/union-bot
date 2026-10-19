# UNION BOT — Independent Review Phase P4 Round R01
**Status:** `CHANGES_REQUIRED`  
**Phán quyết:** `GO_P5_NOT_YET — P5_NON_EXECUTING_SCAFFOLD_ALLOWED`  
**Người đánh giá:** Technical Leader / Independent Reviewer (ChatGPT Web)  
**Ngày:** 2026-10-19  
**Commit cơ sở phê duyệt:** [`34d9fbf70a28577732c1f4ea0b5e4a01e5ebf4d7`](https://github.com/wtrg/union-bot/commit/34d9fbf70a28577732c1f4ea0b5e4a01e5ebf4d7) (HEAD của `main`)  
**Tài liệu đệ trình:** `reports/handoff/REVIEW_PACKET_P4_R01.md`

---

## 1. Những phần đã đạt

| Hạng mục | Kết quả |
| :--- | :--- |
| Tạo WebContentsView và bốn provider mặc định | Đã triển khai |
| Phân vùng cookie riêng cho từng provider | Có test Electron |
| Sandbox, không Node integration/preload đặc quyền | Đã xác minh source |
| Chặn popup và quyền thiết bị mặc định | Đã triển khai |
| Browser Dock, chuyển tab, zoom, modal overlay | Có UI và test |
| Cơ chế phát hiện crash, nút reload | Đã triển khai |
| Chia sẻ thủ công vào room | Hoạt động trên đường thành công |

Ghi nhận báo cáo 204/204 test PASS ở mức `TEAM_EXECUTED`.

---

## 2. Ba vấn đề ảnh hưởng trực tiếp đến vận hành P4 (Blockers)

| Mã | Mức độ | Vấn đề |
| :--- | :--- | :--- |
| **UB-P4-R01-001** | S1 — Security | Đường tạo tab và điều hướng chưa thực thi URL policy nhất quán; chặn địa chỉ loopback/private chưa đầy đủ |
| **UB-P4-R01-002** | S1 — Functional | Luồng đăng nhập đa miền/OAuth của provider chưa được xử lý đúng trong session nhúng, cũng chưa được E2E xác nhận |
| **UB-P4-R01-003** | S1 — Data integrity | Share to Room có thể trả thành công khi SQLite lưu thất bại, và có thể gán sai provider nguồn khi tab được chia sẻ không phải tab đang active |

---

## 3. Bằng chứng mã nguồn và nguyên nhân chi tiết

### UB-P4-R01-001 — Lỗ hổng ở đường tạo tab và điều hướng
- Trong `browser-service.cjs`, URL ban đầu của tab được đưa trực tiếp vào `webContents.loadURL()`. Đường `browser-create-tab` không bắt buộc chạy `validateUrl()` trước khi tạo view.
- Thêm vào đó, `browser-navigate` có thể tải một trang ngoài vào partition ChatGPT/Gemini mà không áp dụng cùng ranh giới origin với điều hướng bằng click.
- Nếu khởi tạo lớp bảo mật của partition thất bại, ứng dụng hiện ghi cảnh báo nhưng vẫn tiếp tục tạo view.
- Bộ kiểm tra private IP bỏ sót nhiều địa chỉ (ví dụ: `127.0.0.2`, `[::1]`, `169.254.169.254`).
- **Cách sửa:** Sử dụng một bộ kiểm tra URL thống nhất cho create tab, navigate, redirect và request boundary; nếu không thiết lập được bộ lọc bắt buộc thì không được tạo view.

### UB-P4-R01-002 — Chưa xác minh được đăng nhập provider thực tế
- Hiện tại `browser-service.cjs:93–128` từ chối tất cả popup và chuyển các link đó sang trình duyệt ngoài. Với đăng nhập OAuth sử dụng popup, bước này có thể khiến phiên đăng nhập rời khỏi cookie partition của Union Bot.
- Bài E2E P4 tự tạo cookie thử nghiệm để xác minh cách ly partition. Đây là kiểm thử hợp lệ, nhưng không chứng minh người dùng đã đăng nhập thành công vào ChatGPT, Gemini, Claude hoặc DeepSeek.
- **Yêu cầu:** Hoàn thiện cơ chế xử lý miền xác thực hợp lệ trong cùng partition khi được hỗ trợ. Không trích xuất cookie/mật khẩu và không tuyên bố đăng nhập thành công chỉ dựa trên URL trang chủ. Lập ma trận tương thích provider.

### UB-P4-R01-003 — Share to Room có thể báo thành công giả
- Tại `browser-service.cjs:375–447`, exception khi ghi SQLite bị bắt và ghi log, nhưng hàm vẫn trả về `{ success: true, envelope }`.
- Khi người dùng chọn chia sẻ tabId ChatGPT nhưng tab đang active là Gemini, một số metadata nguồn được lấy từ Gemini thay vì tab được chọn.
- **Yêu cầu:** Xác nhận SQLite đã commit thành công trước khi trả ACK và lấy toàn bộ thông tin provenance từ chính tab cần chia sẻ.

---

## 4. Sáu regression vectors P4 R02

| Vector | Tiêu chuẩn nghiệm thu |
| :--- | :--- |
| **P4-R02-T01** | Create tab với URL độc hại/private → DENY, không tạo view |
| **P4-R02-T02** | Navigate/redirect không thể làm vượt ranh giới provider partition |
| **P4-R02-T03** | Chặn request tới loopback/private; security initialization lỗi → fail-closed |
| **P4-R02-T04** | Kiểm thử đăng nhập/redirect/popup có kiểm soát trong cùng partition và lập ma trận tương thích provider |
| **P4-R02-T05** | Share từ tab không active vẫn giữ đúng URL, title, provider và room |
| **P4-R02-T06** | SQLite ghi thất bại → không ACK thành công, không phát sự kiện giả |

Lưu ý: Tăng độ trung thực của bài test crash (kích hoạt crash tự nhiên trên WebContents thay vì chỉ gán thủ công biến kiểm thử).

---

## 5. Chỉ thị triển khai Round R02

Khắc phục đúng ba blocker, thực thi sáu vector và nộp `reports/handoff/REVIEW_PACKET_P4_R02.md`. Không tự mở rộng audit sang các module không liên quan.
