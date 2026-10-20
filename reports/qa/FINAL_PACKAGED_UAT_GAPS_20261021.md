# Packaged final UAT probe — 2026-10-21

Tested retained independent c405f21 portable copy outside repo: C:/Users/Lenovo/AppData/Local/Temp/union-bot-codex-portable-2CyJXJ. Unique fresh profile union-bot-final-uat-a0be3e4802b340e483183e7327a85042. Normal GUI, no smoke/mock flags, no provider prompts/model executions.

Actual UI observations:
- Normal app starts and displays local room UI. Fresh profile shows Codex/Antigravity ACTIVE and ChatGPT/Gemini READY before authenticated readiness verification. Source App.tsx INITIAL_AGENTS hardcodes these statuses. Capability truth is incomplete.
- Create Project form has name and description only, no workspace folder chooser or persisted canonical project root. Created 'Nghiệm thu Việt Nam 21 10'; reload then dropdown confirmed name persisted. This passes project Unicode name persistence only, NOT UAT-002 workspace filesystem selection.
- Source App.tsx createProject sends name/description only. TasksInbox executeTask sends taskId only. Backend task-execute default workspace is package resources/app (unless p10 harness), so production native tasks lack user-selected project root routing. Needs project/workspace root integration before main intended flow accepted.
- TasksInbox initially populates SAMPLE_TASKS (completed/running fake progress) until live list loads; absent/error API can leave sample data in production. Do not present these as real tasks.

Closed own QA window normally with Alt+F4, no task was dispatched. No secrets, login, paid API, installs, system settings or user-file deletion. These gaps are original-plan UAT/capability issues, not new scope. Send to existing Antigravity workstream ownership, avoid two writers to same file. T1/T2 not yet accepted.

Findings sent to existing verified Antigravity goal conversation for ownership A/B and existing ChatGPT Web discussion. UI-observed agent tool log confirms actual deadline/3-stream plan message was submitted to ChatGPT Web conversation 6ad64b63-ad44-83ec-90ca-83cacbc26da5 (Phê duyệt Khởi động P6). No claim that Leader already accepted gaps or full delivery.


Additional task/project isolation evidence for root-routing implementation:
- App.tsx renders <TasksInbox /> without project/room/root props (line 456 in c405f21).
- TasksInbox creates tasks with role only and lists tasks globally (limit100). A root field added only to CreateProject UI is insufficient: persist task project_id/room association, derive workspace from backend-owned project, scope listing/results/dispatch to selected project.
- Main task-execute currently accepts renderer workspaceRoot and falls back to app resources. Do not treat arbitrary renderer-supplied root as authority, and do not mutate a shared agent service root across simultaneous projects without isolation. Add cross-project negative regression using two unique temporary directories, including Unicode/spaces.
- Export transcript API exists; source search found no import/restore UI/preload/backend path. UAT021 remains SOURCE_GAP until implementation mapping or actual backup roundtrip supplied.

These are source audit findings on c405f21, before current agent patch; not a claim the final candidate still contains them. Windows Firewall dialog blocks native UI input at present; read-only/source checks continue. No firewall actions taken. Direct WT connector connection_status independently returned fetch failed.

02:10 correction: importTranscriptBundle DOES exist in main/preload; earlier search for importWorkspace/restore did not find it. See PACKAGED_ATTACHMENT_BUNDLE_20261021.md for actual UI export evidence and source incompatibility: top-level-array manifest vs importer manifest.artifacts, no artifact bytes in export, skipped missing files, truncated transcript and swallowed failed persistence. UAT021 remains unaccepted for those concrete reasons, not because all import code is absent. Native UI was available again; no security permission action taken.
