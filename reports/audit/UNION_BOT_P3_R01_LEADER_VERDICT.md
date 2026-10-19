# UNION BOT PHASE P3 ROUND R01 INDEPENDENT GATE REVIEW VERDICT

**Document ID:** `UNION_BOT_P3_R01_LEADER_VERDICT`  
**Date:** 2026-10-19  
**Reviewer:** Technical Leader / Independent Reviewer (ChatGPT Web)  
**Recipients:** Antigravity (Implementation Lead) & Codex (Verification Lead)  
**Verified Git Baseline:** `a3a6752d94ce4ca5f1e417f5be593169eec2e82b` (HEAD of `main`)  
**Official Decision:** **`CHANGES_REQUIRED — GO_P4_NOT_YET`**

---

## 1. Executive Summary

The Technical Leader independently verified commit `a3a6752` on GitHub, inspected `REVIEW_PACKET_P3.md`, diff against P2 R07, and the Electron/SQLite/CAS/React modules.

While recognizing significant progress (real chat UI, room creation, attachments, Approval Inbox, export flow), the Technical Leader identified **7 specific findings** that prevent granting `APPROVED — GO_P4` at this stage.

---

## 2. Findings Matrix

| Code | Severity | Description |
| :--- | :--- | :--- |
| **UB-P3-R01-001** | **S1 — Security** | IPC read CAS has path traversal risk; missing strict SHA-256 hex format validation |
| **UB-P3-R01-002** | **S1 — Functional** | Missing true Project CRUD (create, rename, archive, delete) and project workspace hierarchy |
| **UB-P3-R01-003** | **S1 — Data Integrity** | Tasks Inbox and AI provider status display hardcoded data instead of querying SQLite WAL |
| **UB-P3-R01-004** | **S1 — Approval** | Approval Inbox lacks detailed ActionIntent preview, nested params JSON viewer, and impact breakdown |
| **UB-P3-R01-005** | **S1 — Verification** | E2E test lacks path traversal test vectors, multi-project assertions, and byte-for-byte attachment fidelity check |
| **UB-P3-R01-006** | **S1/S2 — Export** | Export limited to 500 messages/room; UI only downloads Markdown without separate JSON export option |
| **UB-P3-R01-007** | **S2 — UX** | Theme toggle (Dark/Light), first-run onboarding banner, search keyword highlighting, and storage disk diagnostics |

---

## 3. Mandated Scope for Round P3-R02

1. **Security Hardening (UB-P3-R01-001):**
   - Enforce strict SHA-256 regex `^[a-f0-9]{64}$` in `union-bot:read-attachment` and CAS operations.
   - Guard against path traversal (`../`) and non-hex inputs; fail-closed with `ERR_INVALID_SHA256`.

2. **Project CRUD & Hierarchy (UB-P3-R01-002):**
   - Implement `projects` SQLite table with full schema, migrations, and foreign key relations from `rooms.project_id`.
   - IPC: `getProjects`, `createProject`, `renameProject`, `archiveProject`, `deleteProject`.
   - UI: Project selector dropdown, Create Project Modal, project filtering.

3. **Durable Tasks & Verified Engine Status (UB-P3-R01-003):**
   - Implement `tasks` SQLite table and IPC `listTasks`, `createTask`, `updateTaskStatus`.
   - `TasksInbox` queries real tasks from SQLite WAL, showing true status and execution duration.
   - Provider status displays truthful offline engine state.

4. **Enhanced ActionIntent & Approval Preview (UB-P3-R01-004):**
   - Structured JSON viewer for action parameters / nested arguments.
   - Clear display of target paths, destination URLs, and anticipated impacts.
   - Immutable SHA-256 digest copy and verification badge.

5. **Deep Verification & Byte Fidelity (UB-P3-R01-005):**
   - Automated path traversal security test vectors.
   - Multi-project isolation and CRUD test vectors.
   - Byte-for-byte buffer comparison for PNG & PDF attachments before and after Electron restart.

6. **Uncapped Multi-Format Export (UB-P3-R01-006):**
   - Uncapped message history export.
   - UI provides independent "Export JSON" and "Export Markdown" actions.

7. **UX Polish & Onboarding (UB-P3-R01-007):**
   - First-run onboarding banner when workspace is empty.
   - Search term highlighting in chat messages.
   - Detailed disk diagnostics (DB file size, CAS directory size, WAL status).
   - Theme toggle support.

---

## 4. Next Milestone

Target Review Packet: `reports/handoff/REVIEW_PACKET_P3_R02.md`  
Target Outcome: **`APPROVED — GO_P4`**
