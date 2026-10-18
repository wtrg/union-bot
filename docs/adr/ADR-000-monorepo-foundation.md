# ADR-000: MONOREPO FOUNDATION & ARCHITECTURE BLUEPRINT

- **Status:** `ACCEPTED`
- **Date:** 2026-10-18
- **Deciders:** Antigravity (Implementation Owner), Codex (QA Lead), ChatGPT (Technical Leader)
- **Ticket:** `P0-011`

---

## 1. Bối cảnh & Vấn đề (Context)
Dự án tiền nhiệm gồm nhiều mã nguồn Python nằm rải rác trong `D:\muti_chat_bot_package` với một giao diện web HTML/JS cơ bản, thiếu cấu trúc module hóa chặt chẽ, thiếu type safety và không tối ưu cho một ứng dụng desktop Windows hoàn chỉnh.

Để đáp ứng mục tiêu **Union Bot** — một ứng dụng desktop hiệu năng cao, ổn định, hỗ trợ 6 AI cộng tác, có hệ thống quản lý tệp đa phương tiện, chúng ta cần một kiến trúc monorepo hiện đại, module hóa cao, kiểm thử độc lập và quản lý phụ thuộc tập trung.

---

## 2. Quyết định Kỹ thuật (Decision)

### 2.1. Quản lý Monorepo bằng `pnpm workspace`
Lựa chọn **pnpm** (phiên bản 12.x) kết hợp file cấu hình `pnpm-workspace.yaml`:
- Tốc độ cài đặt nhanh nhất trên hệ sinh thái Node.js.
- Cơ chế liên kết cứng (hard-linking) tiết kiệm dung lượng ổ cứng trên máy trạm Windows.
- Ngăn chặn triệt để hiện tượng ghost dependencies (truy cập gói không khai báo).

### 2.2. Bố cục Thư mục Chuẩn (Repository Layout)
```
union-bot/
├── apps/
│   ├── desktop/             # Electron Main Process, WebContentsView, IPC Hub
│   └── workspace-ui/        # React 18, Vite, Tailwind CSS, Lucide Icons
├── packages/
│   ├── cost-guard/          # 0đ Zero-Cost Network Egress Enforcer
│   ├── protocol/            # Zod Envelopes, Fidelity Types, Task Schemas
│   ├── artifact-store/      # Content-Addressable Storage (CAS), SHA256
│   ├── orchestrator/        # Task Graph, SQLite WAL, Durable Event Journal
│   ├── agent-antigravity/   # Headless CLI Runner Wrapper (agy)
│   └── agent-codex/         # Stdio JSON-RPC App Server Client
├── tests/
│   ├── integration/         # Cross-package workflow & handoff tests
│   ├── security/            # Identity isolation & injection tests
│   └── e2e/                 # Playwright E2E desktop app tests
├── docs/                    # Architecture ADRs, matrices, guidelines
├── reports/                 # Audit dossiers, capability evidence, handoff packets
├── pnpm-workspace.yaml      # Workspace definition
├── tsconfig.base.json       # Shared TypeScript compiler options
└── package.json             # Root monorepo scripts
```

### 2.3. Quy tắc Công nghệ (Technology Stack Rules)
1. **Desktop Shell:** Electron 33+ sử dụng `WebContentsView` (loại bỏ hoàn toàn `<webview>` và `BrowserView`).
2. **Frontend UI:** React + Tailwind CSS với giao diện tối ưu cho công việc (dark/light theme, split screen, tabbed views).
3. **Cơ sở dữ liệu:** SQLite cục bộ chế độ Write-Ahead Logging (WAL) đảm bảo tính toàn vẹn khi ghi đồng thời.
4. **Type Safety:** 100% TypeScript trong toàn bộ monorepo, chia sẻ types qua `@union-bot/protocol`.

---

## 3. Hệ quả & Lợi ích (Consequences)
- **Dễ dàng mở rộng:** Mỗi package có thể phát triển và viết unit test riêng biệt mà không làm ảnh hưởng phần còn lại.
- **Không phát sinh chi phí:** Toàn bộ công cụ (pnpm, Node, Vite, Electron, SQLite) đều là mã nguồn mở miễn phí 100%.
- **Sẵn sàng đóng gói:** Hỗ trợ lệnh đóng gói ra file installer `.exe` duy nhất cho Windows thông qua `electron-builder`.
