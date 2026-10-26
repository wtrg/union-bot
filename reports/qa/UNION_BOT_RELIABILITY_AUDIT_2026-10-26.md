# Union Bot reliability audit — 2026-10-26

Status: fixes implemented after the user explicitly authorized Codex to edit and test. Full six-provider live acceptance is still incomplete. The historical findings below describe the state before these fixes.

## Implemented fixes and current evidence

- Antigravity TS and Electron CJS clients now reject fatal transport failures immediately with their original cause. Diagnostic stderr remains nonfatal. Exit zero without a final nonempty result is an error. Cancellation settles independently of close callbacks; late events cannot close or contaminate the next turn.
- Web provider operations have bounded waits and abort handling, releasing controller leases on timeout/cancellation. Replies must follow the submitted unique marker for all web providers, including virtualized conversations.
- In-process draft provenance allows discarding only an exact bot-created draft on the same page before any possibly successful send. Unknown, edited, or uncertain-send drafts are preserved. Draft text is checked again before clicking send; no blind send retries were added. Draft provenance intentionally does not survive a restart: unknown drafts remain blocked for manual review.
- Routing uses only leading mentions. An all-members mention in task prose cannot override a selected individual recipient. The UI Electron regression now submits such an example with Codex selected and verifies the Codex command prefix.
- Session checks return BUSY or DRAFT_PRESENT instead of READY_TO_CHAT for an active generation or unsent draft. They return status only, without exposing draft contents.

Verification on the updated sources:

- pnpm test:ts: 300 passed, 0 failed, 0 skipped (final run).
- pnpm test:workspace: three consecutive rounds, 44 passed per round. UI test uses mock transport.
- Electron UI routing regression after updating its task-prose example: passed.
- pnpm build and pnpm typecheck: passed. Existing optional Sora 3D bundle still emits the greater-than-500-kB chunk warning.
- Electron P7/P9 suites: 3 passed, including production service routing. These do not establish six live web-provider answers.
- Actual AntigravityService with its real native adapter and CostGuard, no mock: replied UNION_NATIVE_LIVE_OK in 24121 ms. The probe requested no tools or file changes. It proves a fresh service can send/receive; it does not prove command authorization or the already-running application's cached adapter has reloaded.

Remaining acceptance: restart the user's running Union Bot to load Main-process changes, then verify repeated real group send/receive with each provider, including login/permission states and existing unknown drafts. The current app was minimized; Computer Use could not inspect it, and the alternate helper initialization failed with 'failed to write kernel assets'. No running user process was forcibly terminated. The separately configured WT MCP tool points to D:/openteam/desktop-bridge/mcp.mjs, so its fetch failure is not evidence of this Union Bot's internal service health.

## Reproduced adapter defects

Runtime module: packages/agent-antigravity/src/agent-antigravity.cjs. Corresponding source: packages/agent-antigravity/src/antigravity-client.ts.

A small injected transport started no process and called onError(new Error('AUDIT_TRANSPORT_FAILURE')).

1. When it then called onClose(0), executeTurn resolved with status SUCCESS, empty response, synthetic-session, and no error field. The error listener had received AUDIT_TRANSPORT_FAILURE. Transport errors therefore do not reliably determine the terminal result.
2. When it never called onClose, the operation waited for its 100 ms audit timeout and rejected with ERR_ANTIGRAVITY_TIMEOUT, obscuring the original failure in the returned error. The production group timeout is 120000 ms.

These are deterministic adapter reproductions; they do not prove which underlying error caused the live Antigravity timeout.

Required implementation: distinguish fatal transport failure from informational stderr; terminate a fatal failure once, preserve its cause in the returned result, clean up its timer and process, and ignore late close/message callbacks. Do not treat every stderr message as fatal. Update both the TypeScript source and the runtime CJS implementation. Cover error then close-zero, error without close, late callbacks after terminal failure, cancellation, permission denial, and genuine successful streaming. Never bypass tool permissions.

## Live evidence and remaining work

- Union Bot ChatGPT probe failed because its selected room tab contains an unsent 4222-character draft. A separate blank ChatGPT tab is signed in, but cannot bind to the group until it has a conversation URL. Readiness of one tab is insufficient evidence of readiness of the room-bound tab.
- Preserve unknown drafts. An implementer must add draft provenance and safe recovery for bot-created drafts, plus preflight for the exact room-bound provider tab. Verify no duplicate sends under uncertain acknowledgment.
- Antigravity assignments through Union Bot ended in ERR_ANTIGRAVITY_TIMEOUT after 120000 ms. An earlier result explicitly reported ERR_ANTIGRAVITY_PERMISSION_REQUIRED for command. No patch was received from those assignments.
- WT connection_status was rechecked and returned fetch failed. Do not assume a task was delivered through that bridge.
- DeepSeek live authentication was still required in the preceding probe; recheck before dispatch. Existing login/session controls and their unit tests do not establish a signed-in live session.
- targetsFor scans mentions throughout the message. A literal all-members mention in explanatory prose can fan out to all six providers even when a specific provider is selected in the UI. Fix routing intent and add coverage before reusing quoted mention examples in tasks.
- Gemini, Claude, and Codex live recovery remains unverified.

## Verification already completed

Three consecutive latest pnpm test:workspace runs: 42 passed, 0 failed, 0 skipped each. The Electron UI suite explicitly uses mock transport. pnpm typecheck passed. These checks do not establish live provider availability or absence of bugs. The new adapter reproductions above expose a gap in the green suite.

Before implementation, record the existing dirty worktree and preserve its changes. Before claiming completion, obtain a real Antigravity patch through Union Bot, audit the diff, run focused regressions and repeat live send/receive checks against the actual room-bound tabs. Validate parallel partial success and truthful login/permission/error states.
