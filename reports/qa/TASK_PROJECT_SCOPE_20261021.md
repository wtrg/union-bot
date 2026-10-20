# Task/project scope probe — 2026-10-21 02:01 Asia/Saigon

Executed `node reports/qa/verify-task-project-scope.cjs`, exit1, under 1s. Real temporary SQLite in native and forced worker mode, two projects/rooms/tasks, no model or dispatch. Retained evidence: `C:/Users/Lenovo/AppData/Local/Temp/union-bot-task-scope-t3CKAG/evidence.json`.

Both modes:
- listTasks({roomId:'room_a'}) returns only task_a: PASS.
- listTasks({projectId:'project_a'}) returns task_b AND task_a: project filter unsupported/ignored. Cannot implement project UI scoping by passing this option alone.
- getTask('task_a') returns roomId='room_a' and NO room_id. Current main.js workspace resolution tests task.room_id, so it never follows the persisted room association for the actual mapped task object. Use canonical DTO mapping consistently.

Existing TasksInbox creates tasks without roomId/projectId and lists globally. Selecting another project must not reassign an existing task's execution root. Backend needs to derive project root from persisted ownership and reject conflicting renderer root/project input. Cover both same-provider and mixed-provider concurrency without canceling another task via shared service setters.

This is an in-progress source regression, not final packaged UAT. Final candidate still requires actual UI/native workflow, provider truth, full original acceptance checklist and fresh packaging evidence.

## Retest / ownership conflict — 02:04

After owner patched native/worker filters and DTO aliases, reran helper: ordinary project filter and room alias now PASS in both modes. Extended with a real persisted task in room_b/project_b whose metadata incorrectly says project_a. Both project lists include this same task: FAIL canonical ownership in both modes. Actual SQL combines room ownership OR metadata projectId. Room association must take precedence; metadata fallback may only be used for genuinely roomless tasks after backend validation, not override a different room's project. Evidence retained at `C:/Users/Lenovo/AppData/Local/Temp/union-bot-task-scope-AvdzS0/evidence.json`, exit1. This is a concrete cross-project ownership regression, not a new product feature.

## Filter retest — 02:12

Owner changed metadata fallback to room_id IS NULL. Same independent helper now exit0 in native+worker, including conflicting metadata negative case. Evidence `C:/Users/Lenovo/AppData/Local/Temp/union-bot-task-scope-o1FQq6/evidence.json`. This accepts storage filtering/DTO alias regression only. main task-execute still chooses task.metadata.projectId before room association at this observation; it must use the same canonical ownership rule for actual dispatch. UI create/list source now carries project/room context, but final packaged execution/reload/race tests remain unproven. Same-root setter guards do not by themselves isolate different roots.
