# Union Bot reliability audit — 2026-10-26

Status: fixes implemented after the user explicitly authorized Codex to edit and test. Full six-provider live acceptance is still incomplete. The historical findings below describe the state before these fixes.

## Gemini Argon latency optimization — 2026-10-27

The user explicitly chose to retain Argon and optimize Union Bot only. Argon was restored in both the default Gemini tab and the qa-audit conversation; its existing Low thinking level was retained. No automatic switch to Flash or Flash-Lite was added.

Diagnosis and implemented changes:

- The initial Argon A01 probe reached a ready composer in 366 ms, clicked send at 6929 ms and displayed the submitted marker plus active generation at 8058 ms, but produced no captured answer before the 180-second group deadline. Direct page probes also experienced long waits. This does not establish a unique server, account or network fault.
- The old generation detector missed Gemini's Vietnamese `Ngừng tạo câu trả lời` control. The updated detector checks visible controls, prevents submitting into an active generation and avoids completing while that control remains visible. Session readiness uses the same reader after the app restart.
- Gemini capture uses its actual `.query-text` user bubbles instead of scanning every paragraph, div and span when those bubbles exist. Unique-marker and answer-order checks remain required.
- After observing a genuine generation cycle, Gemini requires two stable samples after its stop control disappears instead of the generic eight-sample fallback. The conservative fallback remains when a generation cycle was not observed.
- Direct Gemini continuations omit replayed context only when durable room history contains a completed agent reply, completed delivery, matching source URL and retained originating user turn in the same room. New messages from other members remain included. New URLs, missing cursors, partial/failed/inconsistent replies, other rooms, review and summary turns use the full context path. Server-side conversation history is retained, and the current user request is never truncated by this optimization.
- Confirmed marker observation followed by an overall response timeout is now distinguished from an unresponsive page operation. It instructs the user to inspect the original conversation and avoids blind duplicate sends.
- Opt-in timing diagnostics separate preparation, submission, first text and completion. Opt-in network diagnostics record generation request timing/status only, without query strings, cookies, bodies, account identifiers or headers. The log privacy boundary has a regression test.

Two real Argon continuations through Union Bot, with AI Browser closed:

| Measurement | First continuation | Subsequent continuation |
| --- | ---: | ---: |
| Submitted prompt, including marker | 1436 chars | 525 chars |
| Ready composer | 0.275 s | 0.013 s |
| Send clicked | 6.263 s | 2.362 s |
| First captured answer text | 26.451 s | 51.404 s |
| Generation request HTTP headers, measured from request start | 9.821 s | 14.536 s |
| Generation request finished, measured from request start | 21.085 s | 50.189 s |
| Group delivery completed | 29.289 s | 54.681 s |
| Stop disappearance to completed delivery | 1.417 s | 1.578 s |

Both generation requests completed with HTTP 200. Routine RPC requests in the same session completed in roughly 0.15–0.55 s. The request-generation path accounts for most of the observed wait; transport timing alone cannot distinguish model computation from provider queuing or other service-side processing. The shorter continued prompt reduced measured preparation/submission overhead by about 62%, but the second end-to-end response was slower. These were different short prompts and are not a controlled end-to-end speed benchmark.

The second user request asked how Gemini had described the signal in its previous greeting. Gemini correctly answered that it had described the signal as stable, despite the previous answer being omitted from the replayed group context. This verifies retention of the linked conversation in this live continuation.

An experimental DOM insertion path did not improve measured insertion time and was removed. A temporary Flash test did not provide a valid faster-model benchmark; no Flash speed gain is claimed. Model settings were restored to Argon as requested.

Latest validation: **314/314 main tests**, **58/58 workspace tests**, and typecheck passed. Live delivery evidence is limited to the measured turns; it does not guarantee a fixed Argon response time. Timing data is saved in `reports/qa/gemini-argon-latency-2026-10-27.json` and the matching generation network log.

## Manual continuation, 2026-10-26 evening

The application was closed through its native window controls and restarted repeatedly with its existing profile. Real group prompts were entered through the Union Bot composer in qa-audit. No mock provider was used for these manual rounds. Diagnostic logs contain state flags, lengths and control attributes, not prompt bodies or credentials.

New fixes:

- Claude's current response DOM uses `.standard-markdown`; the reader now supports it and excludes `[data-testid="user-message"]`. Marker and document ordering checks remain required, so a previous answer cannot satisfy a new turn.
- Gemini capture prefers the markdown body over the entire response card, removing the extra provider heading from copied and rendered answers.
- Existing linked conversations wait for history hydration before the editor is used. Editor presence alone was insufficient on cold pages. Loading checks use the main-frame state; unrelated resources no longer hold an otherwise ready composer in the loading phase. Response capture also avoids executing during navigation.
- The input operation has a bounded 15-second allowance. A verified draft can re-notify the provider's input listener, dismiss ChatGPT mention suggestions with Escape and scroll the eligible send controls into its own viewport. No Enter submission or blind duplicate-send fallback was introduced.
- Draft provenance captures the exact editor DOM as well as text, handling layout-only innerText changes conservatively. Unknown, edited, navigation-mismatched and possibly-sent drafts remain protected. Exact DOM changes can still require manual review rather than automatic deletion.
- Active worker views keep a full viewport with one corner pixel intersecting the window, rather than being fully clipped outside it. The browser dock remains closed and the selected operator tab is not changed. This is a mitigation under live validation, not a guarantee that third-party sites will always render in the background.
- The member status strip now displays the same loading/preparing/sending/waiting stage as the corresponding message.

Observed results:

- M05: ChatGPT returned UNION_M05_OK in the group. Gemini and Claude had the answer on their original pages, but group capture failed.
- M06: Gemini and Claude both returned UNION_M06_OK in the group with the browser dock closed.
- M07 after restart: Codex, Antigravity and Claude returned UNION_M07_OK. DeepSeek truthfully required login. ChatGPT preserved an unsent draft; Gemini timed out.
- M08: both affected drafts were preserved. This exposed background/foreground text serialization differences.
- M09: ChatGPT and Gemini both returned UNION_M09_OK in the group with the dock closed. Gemini no longer included its provider heading. Copying that response and pasting into the composer yielded exactly UNION_M09_OK; the temporary composer text was then cleared without sending. Scrolling back displayed older messages without jumping back to the bottom.
- M10 after restart: Claude completed; ChatGPT failed before sending and preserved its draft; Gemini generated UNION_M10_OK on its original page but did not synchronize within the group deadline. M11 conservatively preserved the changed draft.
- Only identified, unchanged test drafts were manually cleared after checking their original marker and current request. The older unknown draft in orchestration was left untouched.
- M12 after restart: ChatGPT, Gemini and Claude all returned UNION_M12_OK and reached completed in the group. No AI tab was selected and the browser dock remained closed throughout this round. The cold start still took substantially longer than a warm conversation, so this is successful delivery evidence, not a latency guarantee.
- M13 final all-members verification: **ChatGPT, Gemini, Claude, Codex and Antigravity each returned UNION_M13_OK and completed in the same group run**. DeepSeek explicitly reported login required. No AI Browser tab was opened during this round. While Gemini was pending, scrolling back kept the older messages visible; its later completion displayed the "Có cập nhật mới" button without pulling the viewport to the bottom. Clicking that button returned to the newest messages. The application is left open in qa-audit with the final results.

Current acceptance: five providers have real group delivery evidence, including a cold-start web round and a subsequent all-members round. DeepSeek needs the user's authenticated session before its live send/receive can be tested. Gemini remains noticeably slower than the other members. These checks do not establish that every future website change, network delay or tool permission request is handled, or that Antigravity can execute commands requiring interactive authorization.

Latest automated validation: pnpm test:ts **310 passed**, pnpm test:workspace **54 passed**, pnpm typecheck passed, pnpm build passed. The UI suite uses mock transport. The optional 3D island bundle retains its existing >500 kB build warning. Focused regressions cover current Claude/Gemini capture, no stale-answer acceptance, hydration, subresource loading, exact draft provenance and the worker viewport geometry.

The remaining sections are historical evidence. Their old test counts and restart/tool limitations are superseded by this continuation.

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
