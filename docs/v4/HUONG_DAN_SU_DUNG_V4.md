# HƯỚNG DẪN SỬ DỤNG UNION BOT V4
## Hệ Thống Không Gian Làm Việc Đa Tác Tử Hướng Mục Tiêu (Goal-Driven Multi-Agent Workspace)

---

## 1. TỔNG QUAN HỆ THỐNG

**Union Bot V4** là nền tảng máy tính để bàn (Desktop Application) tự chủ, điều phối nhiều tác tử AI (Multi-Agent) phối hợp theo quy trình nghiêm ngặt, hướng tới việc hoàn thành các mục tiêu phần mềm phức tạp mà không yêu cầu can thiệp liên tục từ người dùng.

### Các Nguyên Tắc Bất Biến:
- **0 VNĐ (Zero Cost)**: Tuyệt đối không phát sinh chi phí API trả phí, không mua credits, không sử dụng cloud tốn phí. Hoạt động hoàn toàn dựa trên các công cụ chạy local miễn phí (Antigravity 1.4.2 0đ) và các phiên web session có sẵn.
- **Bảo Vệ Thiết Bị (Device Safety)**: Sandbox an toàn trong thư mục dự án; không can thiệp hệ điều hành, firewall, registry hay đánh cắp dữ liệu cá nhân.
- **An Toàn Git (Git Safety)**: Tuyệt đối không bao giờ push trực tiếp vào `main` hay `master`; cấm hoàn toàn force push; mọi thay đổi đều được kiểm chứng qua changeset digest và nhánh tính năng review.

---

## 2. KHỞI CHẠY BẢN WINDOWS PORTABLE

Bản phát hành Windows Portable của Union Bot là bản độc lập hoàn toàn, không cần cài đặt (zero-install), không cần Node.js toàn cục và không cần quyền Administrator.

### Các bước khởi chạy:
1. Mở thư mục bản phát hành:
   ```
   release\union-bot-portable-win-x64\
   ```
2. Khởi chạy bằng một trong hai cách:
   - **Cách 1 (Giao diện đồ họa)**: Nhấp đúp chuột vào file `union-bot.exe`.
   - **Cách 2 (Script dòng lệnh có môi trường độc lập)**: Chạy file `union-bot.bat`.
3. Toàn bộ dữ liệu SQLite, tệp đính kèm CAS (Content-Addressed Storage) và cấu hình phiên làm việc được lưu trữ cô lập trong thư mục con `data/`, không làm ảnh hưởng đến hệ điều hành.

---

## 3. CHẾ ĐỘ LÀM VIỆC DUAL-MODE (/chat VÀ /work)

Union Bot V4 phân tách rõ ràng hai giai đoạn của một dự án để loại bỏ sự nhiễu loạn thông tin:

### 3.1. Chế độ Khám phá Yêu cầu (`/chat` — Discovery Mode)
- **Mục đích**: Thu thập ngữ cảnh, phỏng vấn nghiệp vụ, làm rõ các điểm mơ hồ trước khi viết code.
- **Bảng thông tin Discovery (Discovery Panel)**:
  - **Requirement Facts**: Danh sách các sự thật nghiệp vụ đã được xác nhận (Confirmed Facts). Khi có thông tin mới cập nhật, hệ thống tự động ghi nhận phiên bản thay thế (supersede) để bảo toàn lịch sử.
  - **Open Questions**: Các câu hỏi mở cần giải quyết, tự động lọc trùng và sắp xếp theo độ ưu tiên.
- **Cổng chuyển giao (DiscoveryReadyGate)**:
  - Khi còn câu hỏi mở nghiêm trọng chưa giải quyết, hệ thống ngăn việc nhảy cóc vào lập kế hoạch thực thi để tránh lãng phí tài nguyên.
  - Khi tất cả câu hỏi được giải quyết, hệ sinh mã tóm tắt Brief Digest (SHA-256) cố định để chuyển sang `/work`.

### 3.2. Chế độ Thực thi Kế hoạch (`/work` — Execution Mode)
- **Mục đích**: Quản lý đồ thị công việc (Milestones DAG), thực hiện các tác vụ kỹ thuật và kiểm thử.
- **Đồ thị mốc công việc (Milestones)**: Các bước thực hiện được liên kết phụ thuộc có thứ tự (`order_idx`, `depends_on`).
- **Critical Review Findings**: Hệ thống ghi nhận các phát hiện đánh giá phản biện theo 4 cấp độ nghiêm trọng (`SEV1` đến `SEV4`).
- **Cổng phê duyệt (Goal Approval Gate)**: Nếu có bất kỳ lỗi phản biện nghiêm trọng cấp độ `SEV1` còn mở, hệ thống từ chối phê duyệt kế hoạch cho tới khi lỗi được khắc phục triệt để.

---

## 4. THANH ĐIỀU KHIỂN NHANH VÀ PHÍM TẮT (COMMAND PALETTE)

Union Bot V4 hỗ trợ bảng lệnh nhanh dạng HUD thông qua phím tắt tiêu chuẩn:

- **Nhấn `Ctrl + K` (hoặc `Cmd + K`)** để mở Command Palette từ bất kỳ màn hình nào.
- Các lệnh có sẵn:
  - `/chat` — Chuyển nhanh sang không gian Khám phá & BA Questioning (`Alt + C`).
  - `/work` — Chuyển sang không gian Đồ thị mốc công việc & Thực thi (`Alt + W`).
  - `/browser` — Mở / thu gọn thanh gắn Dock trình duyệt AI (`Alt + B`).
  - `/activity` — Mở / đóng ngăn dòng sự kiện hoạt động Activity Feed (`Alt + A`).
  - `/pause` — Tạm dừng tiến trình điều phối tự động của WorkflowSupervisor.
  - `/resume` — Tiếp tục tiến trình điều phối công việc sau khi tạm dừng.
  - `/theme` — Chuyển đổi giữa giao diện Tiêu chuẩn và giao diện Tương phản cao (High Contrast).

---

## 5. DÒNG HOẠT ĐỘNG ÍT NHIỄU (COMPACT ACTIVITY FEED)

Để người dùng không bị tràn ngập bởi hàng nghìn tin nhắn kỹ thuật nội bộ giữa các tác tử:
- **Activity Feed** được đặt trong một ngăn trượt chuyên dụng (nhấp biểu tượng ⚡ trên Header hoặc phím tắt).
- Ghi nhận các sự kiện cấp cao có tính pháp lý:
  - `GOAL_CREATED`: Mục tiêu mới được khởi tạo.
  - `PLAN_APPROVED`: Bản kế hoạch được phê duyệt.
  - `MILESTONE_STARTED` / `COMPLETED`: Trạng thái tiến độ từng bước.
  - `LEASE_ACQUIRED` / `RELEASED`: Bản quyền điều phối tác vụ.
  - `REVIEW_FINDING_RECORDED`: Phát hiện phản biện mã nguồn.
- Bộ lọc danh mục: `ALL`, `LIFECYCLE`, `MILESTONE`, `LEASE`.

---

## 6. ĐIỀU PHỐI BỀN VỮNG VÀ TỰ PHỤC HỒI (WORKFLOW SUPERVISOR)

Hệ thống điều phối `WorkflowSupervisor` đảm bảo khả năng chạy tự chủ xuyên đêm:
- **Execution Leases**: Cơ chế cấp quyền điều phối có thời hạn sống (Heartbeat TTL). Ngăn chặn tình trạng hai tiến trình cùng sửa một file hoặc xung đột mã nguồn.
- **Tự động tiến bước**: Khi một mốc công việc hoàn thành và ghi nhận bằng chứng (evidence commit SHA), mốc kế tiếp trong DAG tự động được kích hoạt.
- **Tự phục hồi sau sự cố (Crash Recovery)**: Nếu máy tính bị mất điện đột ngột hoặc tiến trình bị tắt, trong lần khởi động tiếp theo hệ thống tự động quét lại cơ sở dữ liệu, giải phóng các lease mồ côi và đưa các mốc dở dang về trạng thái sẵn sàng để tiếp tục chạy an toàn.

---

## 7. TRÌNH DUYỆT AI NHÚNG VÀ AN TOÀN TRUYỀN DỮ LIỆU

- **Dock Trình duyệt Web nhúng**: Cho phép truy cập trực tiếp các phiên làm việc của ChatGPT Web, Gemini Web, Claude, DeepSeek trên nền tảng Chromium WebContentsView.
- **Single-Controller Lease**: Chỉ cho phép 1 tác tử tương tác với tab trình duyệt tại một thời điểm để tránh loạn chuột và lỗi xung đột thao tác người dùng.
- **Làm sạch dữ liệu tự động (DOM Redaction)**:
  - Tự động che dấu các trường mật khẩu (`type="password"`).
  - Tự động bóc tách các token bảo mật (`Bearer ...`, JWT, `sk-...`, `AIzaSy...`, `ghp_...`).
  - Loại bỏ các chuỗi query chứa session trên thanh địa chỉ trước khi lập ảnh chụp DOM (DOM Snapshot).

---

## 8. AN TOÀN GIT VÀ QUY TRÌNH REVIEW CODE

- Khi cần đẩy mã nguồn:
  - Hệ thống tự động tính toán mã băm SHA-256 (`changeset digest`) của toàn bộ thay đổi.
  - Kiểm tra điều kiện Fail-Closed: Tuyệt đối từ chối nếu nhánh mục tiêu là `main`, `master`, `release` hoặc nếu có cờ `--force`.
  - Tự động tạo Review Packet chuẩn hóa (mã commit, danh sách tệp thay đổi, bằng chứng kiểm thử, xác nhận 0đ).
  - Phân tích phản hồi từ người đánh giá để tự động trích xuất các điểm cần sửa vào danh mục review findings.

---

## 9. BẢO MẬT HỆ THỐNG VÀ KIỂM SOÁT CHI PHÍ (0 VNĐ)

- **Security Guard**:
  - Tự động phát hiện các nỗ lực tấn công prompt injection hoặc ghi đè vai trò tác tử.
  - Ngăn chặn tấn công Trojan Source bằng cách loại bỏ các ký tự Unicode Bidi Directional Overrides (`\u202E`).
  - Loại bỏ các mã thoát ANSI terminal nhằm chống giả mạo màn hình console.
- **Cost Guard**:
  - Chặn vĩnh viễn ở tầng socket mạng đối với các domain API tính phí (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`...).
  - Mọi thao tác đều được kiểm toán để bảo đảm chi phí phát sinh là chính xác 0 VNĐ.

---

## 10. SAO LƯU DỮ LIỆU VÀ TOÀN VẸN CƠ SỞ DỮ LIỆU

- Dữ liệu được lưu trong SQLite theo kiến trúc Write-Ahead Logging (WAL).
- Định kỳ và khi khởi động, hệ thống thực hiện kiểm tra tính toàn vẹn `PRAGMA integrity_check` và `PRAGMA wal_checkpoint(PASSIVE)`.
- Các tệp đính kèm lớn và ảnh chụp màn hình được băm theo chuẩn SHA-256 và lưu trữ trong Content-Addressed Storage (CAS), ngăn ngừa trùng lặp và bảo vệ tính nguyên vẹn của dữ liệu dự án.
