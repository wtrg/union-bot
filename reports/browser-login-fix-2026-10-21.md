# Browser login fix — 2026-10-21

## Confirmed defect and changes

- Browser CostGuard matched paid API domain strings anywhere in a URL. ChatGPT OAuth includes `api.openai.com` in its encoded `audience` query parameter, so the legitimate `auth.openai.com` request was cancelled. Match the parsed destination hostname instead, in both TypeScript and Electron CommonJS implementations. Paid API hosts and their subdomains remain blocked.
- Replace DuckDuckGo defaults with Google in the address bar and search/custom tabs. No browser application was uninstalled and no profile/cookies were deleted.
- Constrain tab title width so long OAuth titles do not hide the other tabs or panel controls.
- Refresh the tab auth hint after loading. Label a loaded page “Đã tải”, which does not imply an authenticated account.
- Stop generating canned AI replies in the desktop group chat. Saved local messages now receive an explicit Union Bot delivery notice. Direct provider interaction remains in AI Browser and Tasks Inbox.
- Increase the Antigravity task timeout from 30 seconds to a default of 120 seconds (bounded at 300 seconds for explicit task metadata). Clear old task error metadata on retry.

## Verification

- Type checking: passed.
- Production UI build: passed.
- Browser URL/partition/session regression tests: 19 passed.
- Browser URL/partition/bridge regression tests: 18 passed.
- Real Electron P4 browser integration suite: passed.
- Real Electron P10 task integration suite: passed. This suite uses controlled fixtures; it does not prove successful live image collection.
- `git diff --check`: passed.

## Live tests inside Union Bot

- ChatGPT Web loaded its public composer. Submitted a Vietnamese request for five different Doraemon images with image URLs and source pages. The live provider displayed “Unable to connect”; one retry did not produce a response. Account was logged out. No successful authenticated login or five-image result is claimed.
- Antigravity: created and ran task `task_1792584627228_3cskh` using Tasks Inbox. First attempt timed out at 30 seconds. Retried after raising the timeout; it ended with `ERR_EMPTY_AGENT_OUTPUT`. No image or result file was found under the app task workspace `C:/Users/Lenovo/AppData/Roaming/Electron/workspaces/default`.
- Separate native CLI diagnostics using a tool-free prompt returned `2` successfully in both the repository and app workspace. This establishes basic CLI connectivity, not image-tool capability. Observed CLI event schema matches the app parser.
- User was asked to log into ChatGPT manually in AI Browser for an authenticated follow-up test. Login completion and live image collection remain unverified.

## Authenticated follow-up

- User confirmed manual login completed. Observed authenticated ChatGPT Chat/Work UI inside Union Bot.
- Submitted the five-image request in that embedded tab. ChatGPT searched nine sites and returned five Doraemon image entries and source links.
- Requested full URLs as JSON and used the app's Share to Room control to persist the live response locally. Parsed the five returned URLs from the stored share into `scratch/doraemon-login-test/chatgpt-images.json`.
- Independently downloaded each returned image: all five returned HTTP 200, decoded successfully, and had distinct SHA-256 hashes. Visually checked all five; they depict Doraemon. Original image formats are PNG, WebP, JPEG, JPEG, JPEG.
- Packaged verified images with sources and verification metadata into `scratch/doraemon-login-test/doraemon-5-images.zip`. These verification downloads were performed by Codex after the in-app ChatGPT search; they are not attributed to Antigravity.
- Fixed an additional Tasks Inbox layout bug exposed by the handoff: long URLs in task text pushed the execution button outside the visible card. Allow URL wrapping and reserve space for action buttons.

- In-app handoff task `task_1792587369051_ggcwj` supplied all five URLs to Antigravity; it still ended with `ERR_EMPTY_AGENT_OUTPUT`, without downloaded images in its app workspace.
- In-app connection isolation task `task_1792587515725_9ct9q` instructed Antigravity to return only `2` without tools. It completed successfully and stored an authentic two-byte response (`2` plus newline) in the app task workspace. This verifies native request/response delivery works; the remaining failure concerns tool-dependent image collection.
- UI build, type checking, and P10 Electron integration tests passed after the Tasks Inbox wrapping fix.

## Native tool-denial root cause and correction

A native CLI download diagnostic returned an exit-zero `SUCCESS` result with an empty response and `denied_actions: [{"action":"command","display_name":"RunCommand"}]`. Its explicit diagnostic stated that headless mode cannot prompt for the command permission and auto-denied the action. This confirms that the download failure is a native tool-permission block, not an AI login failure.

Updated both TypeScript and Electron CommonJS parsers to turn `denied_actions` into `ERR_ANTIGRAVITY_PERMISSION_REQUIRED`, propagate the actual reason through the adapter, and persist task state as `blocked`. The UI displays the block and supports retry after interactive approval. No permission rules were relaxed and no skip-permissions option was enabled. Added regression cases for both runtimes; all 12 native-agent unit tests passed.

## Final follow-up verification

- Reloaded the updated app and re-ran the real URL handoff task. Observed `BLOCKED` in Tasks Inbox and independently read the persisted task state: `blocked`, error code `ERR_ANTIGRAVITY_PERMISSION_REQUIRED`, denied action `command`. This is no longer mislabeled as empty AI output.
- Native-agent unit/regression suite: 14 passed, including parser and adapter propagation in both TypeScript and Electron runtime.
- Production UI build and TypeScript checks passed.
- Latest P10 E2E runs passed all functional assertions and wrote `allPassed: true` evidence, but the overall test failed at its final temporary-profile cleanup assertion on Windows. A bounded deletion retry did not resolve that lock; the experimental test change was reverted. This cleanup failure remains disclosed rather than being represented as a fully passing final E2E run.
- Deliverable: `D:/WORK-TEAM/scratch/doraemon-login-test/doraemon-5-images.zip` (477393 bytes), containing five visually checked Doraemon images and JSON source/verification records. Native Antigravity image downloading remains blocked pending its command permission; the ZIP was created by Codex from ChatGPT's live search results.

## Group discussion follow-up

The user's clarified acceptance criteria came from the specific Union Bot discussion in ChatGPT Web. They expect a functioning multi-AI room where members reply under their own names, ask clarifying questions, and continue discussion; storing a user message or task alone does not count as an AI response. A plain `hello` should reach ChatGPT Leader by default, while `@member` explicitly routes to that member. Tool denials and timeouts must be shown honestly, with no fabricated success. No implementation or file changes should happen unless the user asks for execution.

- Added real group routing to ChatGPT Web, Antigravity, and Codex, including provider identities, sending/streaming/completed/blocked states, and room history context. A leader may request a bounded consultation from a member; the member's own response appears separately in the room.
- The embedded ChatGPT page had moved from author-role markers to Markdown blocks and virtualized old messages. The bridge now locates its current editor and send button, correlates each request with a unique turn marker, rejects stale answers, and follows the room conversation thread.
- User-facing group send opens the AI Browser dock on the linked source conversation. Final replies are saved in room history with a direct “Mở hội thoại gốc” link. History selection now returns the newest messages in chronological order so new member replies appear after reload.
- Live in-app proof: Antigravity answered as “Antigravity” and asked which Union Bot requirement needed clarification. ChatGPT Web then answered in the group as “ChatGPT Web” with “Xin chào cả nhóm! 👋 Bạn muốn làm rõ yêu cầu nào của Union Bot?” The response record is completed, linked to the exact ChatGPT conversation, and persisted in the room database; it was visible after restarting the app.
- Targeted group and desktop tests: 23 passed. Type checking and production UI build passed after the group-chat changes.
