# Native live preflight evidence — 2026-10-21

Read-only Codex CLI auth status executed by root Codex, raw output intentionally not persisted: exit0, CHATGPT_ACCOUNT mode. No API key auth indicated. No token/key/cookie files read.

Built-in Codex account usage tool returned ordinaryUsageAllowed=true, no current reached rate limit, primary used50%, secondary used20%, plan Plus, credits balance0/hasCredits=false, spendControlReached=false. This is a point-in-time account quota observation, not a permanent cost guarantee or authorization to buy credits.

This supports testing native Codex within the already-existing ChatGPT allowance with fail-closed behavior on limit/cost uncertainty; do not switch to API-key billing, purchase credits or add another executor for same task. Actual app-server route/turn and provider artifact verification still NOT_LIVE_VERIFIED. Antigravity native CLI quota/auth still unverified independently; historical Gemini app error is not proof of current native quota either way.

Do not equate CodexService.executeVerification's local syntax/hash checks with an actual Codex model turn. Final T1 requires actual agent artifact/review/fix evidence through intended UI/native pipeline.

02:02 read-only Antigravity preflight: existing local agy.exe --version returned 1.4.2, exit0. --help exited0 and documented print/stream-json/conversation/print-timeout options matching transport shape. Each process timeout5s, no prompts/model turns executed. This establishes executable/flag readiness only. AntigravityDiscovery currently labels authStatus FREE_LOCAL solely on successful --version; that value does not establish auth, included quota or a no-charge execution guarantee. Do not use it as live T1/cost evidence.
