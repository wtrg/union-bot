# Codex project root switch protocol regression — 2026-10-21 02:17

Executed `node reports/qa/verify-codex-root-switch.cjs`, exit1, under1s. Existing MockCodexTransport only; no real native/model call, no paid API. Actual desktop CodexService and CodexAdapter logic used. Evidence retained at `C:/Users/Lenovo/AppData/Local/Temp/union-bot-codex-root-switch-k3bbal/evidence.json`.

Steps: service in project-a -> execute first turn -> setWorkspaceRoot(project-b) -> execute second turn. Recorded RPC sends only one thread/start with cwd project-a, then two turn/start calls using the same thread. NO thread/start for project-b. Current setter changes adapter.workspaceRoot but leaves cached client.currentThreadId bound to previous workspace; executeTurn ignores options.cwd for existing thread.

Thus replacing cancel/close with mutable root assignment avoids one cancellation symptom but does not isolate project execution. Native requests can retain wrong workspace/history even with sequential project switches. Scope actual service/thread lifecycle by canonical project/room or use fresh per-run adapters; handle concurrent turns and cancel ownership. This is a protocol routing failure, not a claim that a real model executed outside its workspace.
