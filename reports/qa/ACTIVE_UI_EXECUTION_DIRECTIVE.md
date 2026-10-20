# Active delivery task — UI -> executor -> verified artifact

User explicitly requested continuation after agent stopped at P9 handoff. New implementation directive delivered to existing verified WORK-TEAM Antigravity conversation 1da923dd-3649-44b7-8ab3-46916fd0a278. Do not replay or treat previous P9 assignment as this task.

Priority: existing TasksInbox Create/Start must route into existing task graph/orchestrator/native executors exactly once; actual event-backed status, output/artifact/hash/error, effective cancel, selected role preservation, no manual fake Complete. Use original V3 A-H, P3-006/P8/P10/P11 and V3.1 T1+T2 release baseline. UAT repro: reports/qa/USER_UI_SIMPLE_TASK_20261020.md.

Acceptance: from UI choose workspace/provider, request hello.txt with HELLO UNION BOT in isolated scratch; authorized real executor creates it, verify actual bytes/hash, Codex verifies, UI shows evidence, reload persists and duplicate Start does not redispatch. If auth/quota/permissions or unknown cost prevent live work, fail honestly as WAITING_INPUT/BLOCKED/NOT_LIVE_VERIFIED. Local test fixtures cannot fulfill live acceptance.

Then P10 UAT/hardening and P11 portable delivery plus Vietnamese guide. Discuss short implementation plan with existing ChatGPT Web Technical Leader using authorized channel, no infinite old-review waits. No paid API/credits, installs/dependency updates/system configuration changes, destructive file operations, push/merge/publish or duplicate executor.
