# EGRESS BOUNDARIES & DEFENSE-IN-DEPTH ARCHITECTURE — UNION BOT

- **Document ID:** `UB-SEC-002`
- **Phase:** `P0`
- **Ticket:** `UB-R04-001`, `P0-009`, `P0-016`, `P0-017`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner) & Codex (QA Lead)
- **Status:** `SPECIFIED_AND_ENFORCED`

---

## 1. Mục đích & Giới hạn Phạm vi (Scope & Realistic Boundary)

Tài liệu này xác định ranh giới egress mạng và kiến trúc phòng thủ đa tầng (defense-in-depth) cho **Union Bot**, bảo đảm tuân thủ triệt để nguyên tắc **Zero-Cost (0 VNĐ)**.

> [!IMPORTANT]
> **Tuyên ngôn Hiện thực & Trung thực về Phạm vi Bảo vệ:**
> Các bộ lọc runtime in-process (monkey-patch `globalThis.fetch`, `http.Agent`, `https.Agent`, `http2.connect`, `net.Socket.prototype.connect`) trong mô-đun `@union-bot/cost-guard` là **lớp phòng thủ bổ trợ trong tiến trình (best-effort in-process runtime guards)**.  
> Chúng **KHÔNG** đại diện cho một tường lửa cấp hệ điều hành (OS firewall) và **KHÔNG THỂ** tự động can thiệp vào các tiến trình con độc lập chạy nhị phân bên ngoài (như Python, curl, CLI riêng) nếu không đi qua cổng khởi tạo được kiểm soát.  
> Do đó, kiến trúc bảo vệ chi phí của Union Bot áp dụng mô hình **3 Lớp Phòng thủ (3-Layer Defense)**.

---

## 2. Mô hình 3 Lớp Phòng thủ Egress (3-Layer Defense Model)

```
[Người dùng / Task Graph]
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ Lớp 1: Admission Policy (Cổng Kiểm duyệt Khởi tạo)    │
│ - paid_api_enabled = false (khóa cứng)                 │
│ - unknown_cost = DENY                                  │
│ - Không lưu, không đọc, không chèn billing API keys    │
│ - Kiểm duyệt trước khi spawn tiến trình hoặc adapter  │
└────────────────────────┬───────────────────────────────┘
                         │ (Chỉ khi Hợp lệ)
                         ▼
┌────────────────────────────────────────────────────────┐
│ Lớp 2: Per-Adapter Action Gate (Cổng Hành vi Tác tử)   │
│ - Giới hạn hành động của từng AI Provider             │
│ - Web Provider: Chỉ gửi UI prompt, không gọi paid API  │
│ - Local CLI: Chỉ cho phép cờ headless/local, 0-billing │
└────────────────────────┬───────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────┐
│ Lớp 3: In-Process Network Interceptors (Defense-in-Depth)│
│ - Node.js: fetch, Agent addRequest, Socket, HTTP/2     │
│ - Electron: session.webRequest.onBeforeRequest         │
│ - Ném CostGuardViolationError / cancel request         │
│ - Ghi nhận Audit Ledger: DENIED / UNKNOWN              │
└────────────────────────────────────────────────────────┘
```

### 2.1. Lớp 1: Admission Policy trước Spawn / Dispatch (Primary Defense)
- **Vị trí thực thi:** Tầng Core Orchestrator trước khi bất kỳ tiến trình (`child_process.spawn`) hay adapter mạng nào được kích hoạt.
- **Quy tắc cứng:**
  1. `paid_api_enabled: false` — Khóa cứng ở mức cấu hình hệ thống, không có cờ toggle UI bật paid APIs.
  2. `unknown_cost: DENY` — Bất kỳ tác vụ hoặc đích đến nào không xác định rõ chi phí đều bị từ chối ngay tại cửa.
  3. **Zero Billing Credentials:** Hệ thống không cung cấp trường nhập liệu, không đọc từ file môi trường các token trả phí như `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
  4. Mọi yêu cầu spawn tiến trình bên ngoài (như Codex CLI, Antigravity CLI) phải qua hàm kiểm duyệt tham số dòng lệnh (`validateSpawnArgs`), loại bỏ mọi cờ kết nối cloud/billing.

### 2.2. Lớp 2: Per-Adapter Action Gate
- **Vị trí thực thi:** Tầng Adapter Interface của từng AI (`ChatGPTWebAdapter`, `ClaudeWebAdapter`, `CodexAppServerAdapter`, v.v.).
- **Quy tắc:**
  - Adapter Web chỉ được phép tương tác thông qua giao diện WebContentsView cô lập và xuất nội dung theo phương thức `MANUAL_SHARE` hoặc context injection.
  - Tuyệt đối không cho phép adapter tự động cấu hình hoặc phát sinh request ra ngoài phạm vi partition `persist:mcb-web-*`.

### 2.3. Lớp 3: In-Process Runtime Network Hooks (Defense-in-Depth)
- **Vị trí thực thi:** Tiến trình Node.js Main Process và Electron Session.
- **Phạm vi bảo vệ:**
  - `globalThis.fetch`: Kiểm tra URL trước khi dispatch; ném `CostGuardViolationError` nếu vi phạm allowlist/denylist.
  - `http.Agent.prototype.addRequest` & `https.Agent.prototype.addRequest`: Chặn mọi request HTTP/1.1 ở cấp độ prototype của Agent, bao gồm cả custom agent.
  - `net.Socket.prototype.connect` & `http2.connect`: Chặn ở tầng socket TCP/TLS và HTTP/2, ngăn ngừa mọi kết nối socket mức thấp hướng đến paid AI hosts hoặc unapproved domains.
  - Electron `session.webRequest.onBeforeRequest`: Chặn trên mọi partition web view, hủy request (`cancel: true`).

---

## 3. Vòng đời Interceptor & Tính Idempotent (Lifecycle Management)

1. **Khởi tạo duy nhất (Single-Install / Idempotent):**
   - Hàm `installNodeCostGuardInterceptor` duy trì trạng thái active toàn cục trong mô-đun.
   - Nếu được gọi lại nhiều lần, interceptor không thực hiện bọc lồng (wrap over wrap) mà cập nhật thể hiện `CostGuard` tham chiếu và tái sử dụng cùng bộ hàm gốc.
2. **Hủy cài đặt sạch sẽ (Clean Uninstall):**
   - Hàm `uninstall()` hoàn nguyên chính xác 100% các prototype gốc (`fetch`, `http.Agent.prototype.addRequest`, `https.Agent.prototype.addRequest`, `http2.connect`, `net.Socket.prototype.connect`).
   - Thứ tự hoàn nguyên được cô lập, bảo đảm không gây rò rỉ bộ nhớ hay side-effects cho các bài test tiếp theo.
3. **Phân loại Sự kiện Kiểm toán (Audit Event Classification):**
   - `PAID_API_BLOCKED`: Đích đến nằm trong danh sách đen các API tính tiền (`api.openai.com`, `api.anthropic.com`, v.v.).
   - `BILLING_ENDPOINT_BLOCKED`: Đích đến chứa các từ khóa thanh toán (`/billing`, `/checkout`, `/payment`).
   - `NOT_IN_ALLOWLIST`: Đích đến không nằm trong danh sách trắng được phê duyệt.

---

## 4. Kế hoạch Vé Công việc Triển khai Lớp 1 & 2 (P1 / P2 Tickets)

Để khép kín kiến trúc này trong các pha tiếp theo:
- **`P1-007`**: Tích hợp `@union-bot/cost-guard` vào Electron Main Lifecycle, tự động gắn `installElectronCostGuardInterceptor` cho mọi partition.
- **`P2-005`**: Hiện thực hóa `AdmissionPolicyGate` trong Orchestrator: chặn đứng mọi tác vụ trước khi dispatch nếu có cấu hình vi phạm Zero-Cost.
- **`P6-004` & `P7-004`**: Gắn cờ kiểm duyệt tham số dòng lệnh trước khi gọi `child_process.spawn` cho Codex App Server và Antigravity Headless CLI.
