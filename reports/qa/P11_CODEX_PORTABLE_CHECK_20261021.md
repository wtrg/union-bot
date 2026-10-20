# Independent portable smoke — 2026-10-21 00:53 Asia/Saigon

Source HEAD c405f21. Used Codex-owned QA script reports/qa/verify-portable-codex.cjs, not implementer verifier cleanup. Copied portable bundle outside repo to a unique temporary directory, stripped global Node/pnpm PATH, ran current launcher --smoke --headless with isolated profile and 45-second deadline.

Result: exit0 in 3096ms, no timeout, smoke PASS, SQLite created, manifest 281 checked / 0 mismatches. No force-kill or deletion used in this passing run. Retained temp copy/log for inspection. JSON evidence: P11_CODEX_PORTABLE_CHECK_20261021.json.

This confirms packaged local startup/IPC/database/manifest behavior independently on this Windows machine. Does not establish T1 live model execution, six-AI autonomy, full normal interactive close behavior, another clean Windows PC, or every master-plan acceptance criterion. T1 remains NOT_LIVE_VERIFIED. No paid model/API calls, installs or system changes.

Do not infer clean renderer shutdown solely from parent code0: audit remaining processes under exact QA-copy executable path separately. No indiscriminate cleanup or process matching by commandline substring.

Post-exit audit: Get-CimInstance Win32_Process filtered by ExecutablePath strictly under the unique QA-copy directory returned zero surviving processes. The tested packaged smoke path exited without a retained process in this check. Temp files were retained intentionally, no cleanup-kill required. Monitor remains active because live T1 and full user acceptance are outstanding.


01:02 follow-up: HEAD c405f21 unchanged and no tracked source modifications or new handoff since independent portable check. No tests/model calls repeated. Packaged smoke PASS remains valid for its recorded scope; T1 live and full user acceptance still outstanding. No paid calls, installs or system changes. Monitor continues quietly.


01:12 follow-up: unchanged HEAD c405f21, no tracked source changes or new handoff. No repeated tests, model calls or messages. Independent portable smoke result retains documented limits; no evidence yet for live T1 or final user acceptance. No installs, paid calls or system changes. Monitor active.


01:22 follow-up: HEAD c405f21 unchanged; no tracked source modifications or new handoff. No reason to rerun passing packaged smoke or call/retry models. T1 live remains NOT_LIVE_VERIFIED and final user acceptance unrecorded. No external messages, paid calls, installs or system changes. Monitor continues quietly.


01:32 follow-up: HEAD c405f21 and tracked source unchanged; no new handoff. Independent packaged smoke retains prior documented PASS scope. Live T1 remains unverified; no model retries or duplicate tests, messages, installs, paid calls or system changes. Monitor remains active pending meaningful new evidence or user acceptance.


01:42 follow-up: HEAD c405f21 unchanged; no tracked source changes, new handoff or live T1 evidence. User was told portable is available but full live-agent objective remains incomplete. No tests/models/messages repeated, no paid calls, installs or system changes. Monitor active, no completion claim.

