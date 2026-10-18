# REPO BASELINE & CLEAN TREE AUDIT — UNION BOT

- **Document ID:** `UB-AUDIT-001`
- **Phase:** `P0`
- **Ticket:** `P0-001`
- **Date:** 2026-10-18
- **Author:** Antigravity (Implementation Owner)
- **Status:** `VERIFIED_LIVE`

---

## 1. Mục đích & Phạm vi
Khảo sát và khóa baseline ban đầu của workspace `D:\WORK-TEAM` cho dự án **Union Bot**, đảm bảo:
- Cây thư mục sạch, không rác build, không file nhạy cảm.
- Quy tắc `.gitignore` được thiết lập triệt để ngăn ngừa leak secrets, browser data, native logs.
- Khởi tạo Git repository cục bộ, cấu hình nhánh chính `main`.
- Thiết lập ranh giới dữ liệu với codebase tiền nhiệm (`D:\muti_chat_bot_package`).

---

## 2. Thông tin Môi trường & Hệ thống
- **Hệ điều hành:** Windows 11 Enterprise (Build 26200.5732 x64)
- **Workspace Đường dẫn:** `D:\WORK-TEAM`
- **Git Binary:** `git version 2.55.0.windows.3`
- **Node.js Binary:** `v24.17.0`
- **pnpm Binary:** `v12.14.0`
- **Python Binary:** `3.11.9 (tags/v3.11.9:de542f0)`
- **Codex CLI:** `codex-cli 0.162.1`
- **Antigravity CLI (agy):** `1.3.6`

---

## 3. Cấu trúc Workspace Ban đầu
```
D:\WORK-TEAM\
├── .git\                                  # Initialized Git repository
├── .gitignore                             # Hardened ignore rules
├── MUTI_CHAT_BOT_MASTER_PLAN_FULL_V3.md   # Master Plan V3.0 (1,884 lines, 143,273 bytes)
├── UNION_BOT_V3_1_LEADER_ADDENDUM_AND_P0_GO.md # Technical Addendum V3.1 (205 lines, 22,041 bytes)
├── extract_plan.py                        # Utility extractor script
├── audit_legacy.py                        # Legacy audit tool
├── scan_secrets.py                        # Secret scanning engine
├── test_codex_spike.py                    # Codex App Server stdio test harness
├── docs\
│   ├── adr\                               # Architecture Decision Records
│   ├── architecture\                      # Architecture blueprints & specs
│   ├── product\                           # Product requirements & release tiers
│   ├── providers\                         # Provider policy & fidelity matrices
│   └── security\                          # Threat models & data boundaries
├── packages\
│   ├── cost-guard\                        # Zero-cost egress blocking module
│   ├── protocol\                          # Shared schemas & message envelopes
│   ├── artifact-store\                    # Content-addressable SHA256 storage
│   └── orchestrator\                      # Multi-agent state machine & journal
└── reports\
    ├── audit\                             # Security & module audit reports
    ├── capability-evidence\               # Live spike proofs & verification logs
    └── handoff\                           # Review packets for ChatGPT Leader
```

---

## 4. Kiểm tra Độ sạch của Cây thư mục (Working Tree Cleanliness)
- Không có file nhị phân lớn (.exe, .dll, .iso).
- Không có node_modules hay browser profile caches trong workspace.
- Quy tắc `.gitignore` bảo vệ tuyệt đối:
  - `userData/`, `persist:mcb-web-*/`, `Partitions/`, `Cookies`
  - `.env`, `*.pem`, `*.key`, `*.cert`, `credentials.json`, `token.json`
  - `dist/`, `build/`, `out/`, `release/`, `*.exe`

---

## 5. Kết luận P0-001
Cây thư mục `D:\WORK-TEAM` đạt chuẩn baseline sạch. Sẵn sàng cho việc tạo commit baseline ban đầu và thiết lập các hồ sơ kiểm chứng P0 tiếp theo.
