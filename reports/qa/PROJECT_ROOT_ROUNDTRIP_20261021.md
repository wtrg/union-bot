# Independent project root roundtrip — 2026-10-21 01:58 Asia/Saigon

Command actually executed: `node reports/qa/verify-project-root-roundtrip.cjs`.
Exit code: 1. Source was under active implementation, not a final packaged candidate.

- Native SQLite: create/list/close/reopen preserved Unicode/spaces workspace root, PASS.
- Forced worker: create/list/close/reopen returned no workspace root, FAIL.
- Both modes used StorageServiceClient's real API and SQLite, no mocks or models.
- Evidence retained at `C:/Users/Lenovo/AppData/Local/Temp/union-bot-root-roundtrip-RWQmDF/evidence.json`; unique QA databases retained. Clients closed; 20s test guard, execution under 1s.

Action for existing Antigravity owner: finish worker/schema/client parity and legacy migration, then rerun helper once stable. Passing this helper proves storage roundtrip only. Still requires task/project ownership, backend-authorized dispatch, cross-project negative checks and actual packaged UI UAT.

Current main.js prioritizes payload workspaceRoot before task/room project and invokes setWorkspaceRoot on shared services. Correction to initial package-only search: both desktop services DO implement this setter. CodexService.setWorkspaceRoot closes its cached adapter; AntigravityService.setWorkspaceRoot cancels its cached adapter. Therefore invoking shared setters per task can stop a different in-flight task. Audit per-task/project service isolation or explicit serialization, together with executePrompt/executeTurn cwd and Codex verification root. The earlier message's "setter missing" statement was incorrect; the shared-service cancellation risk is concrete in desktop service source.

## Retest after worker implementation changed — 01:59

The existing Antigravity owner changed storage-worker.cjs to persist/map workspace_root. Reran the same helper with new temporary data, exit0. Both native and forced worker now preserve root at create/list/reopen. Evidence: `C:/Users/Lenovo/AppData/Local/Temp/union-bot-root-roundtrip-fihysk/evidence.json`. This supersedes the storage roundtrip failure only; dispatch ownership, migration parity, packaged UI and T1 live are still unaccepted. No broad gates repeated.

## Legacy upgrade/cross-mode check — 02:03

Executed `node reports/qa/verify-project-root-legacy.cjs`, exit0. Created genuine legacy canonical project schema without workspace_root, seeded Unicode project/room, upgraded by creating a rooted project, closed and reopened in the opposite storage mode. Native-to-worker and worker-to-native both preserved old project description/name/room and new root. Evidence retained: `C:/Users/Lenovo/AppData/Local/Temp/union-bot-root-legacy-vqU0PK/evidence.json`. No model calls or user database involved. This covers this legacy project-table upgrade only, not every historical schema/backup/packaged UAT path.
