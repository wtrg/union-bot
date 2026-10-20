# Independent P11 launcher regression — 2026-10-21 00:22 Asia/Saigon

HEAD 4f3dbca, tracked source clean at initial inspection. Standalone implementer evidence says allPassed true, but negative child-exit propagation is broken.

Reproduction executed by Codex entirely inside newly created temp directory:
C:/Users/Lenovo/AppData/Local/Temp/union-bot-exit-probe-4ab761b0aa23490b82a7ebea034fc9d3
Copied current portable union-bot.bat and bundled runtime/node.exe as union-bot.exe. Direct child --test-user-data=exit-probe returns 9 (unsupported Node option). Same child via union-bot.bat returns 0. No real app/model call, installation or system setting change. Probe retained.

Root cause: percent ERRORLEVEL expansion inside parenthesized IF evaluates before child command. Launcher also failed to detect userData override in this probe, showing default --user-data-dir too. Require exact error-code propagation negative regression; passing stdout plus wrapper exit0 is not trustworthy proof.

Second source build bug: scripts/assemble-portable.cjs copyDirSync skips existing destination on size equality. Different contents of same size remain stale, manifest generated from destination cannot prove source freshness. Require hash-aware comparison/unconditional copy and same-length mutation regression. Three runtime files previously compared matched, so do not claim observed current mismatch; defect is build reproducibility.

Sent these concrete findings/repro to verified existing Antigravity conversation and requested existing ChatGPT Web review, no duplicate executor. Wait for corrected stable portable and rerun independent verifier. No paid calls, installs, source edits, system changes or publish/push/merge by Codex. Acceptance remains open; T1 NOT_LIVE_VERIFIED.

00:32 follow-up: HEAD4f3dbca with active assembly/verifier changes. Codex independently executed node tests/verify-p11-qa-fixes.test.cjs, exit0. Actual copied launcher now propagates direct child9 as wrapper9, closing reproduced exit-code defect for inspected launcher. Same-size test also passes, but its copyDirSync is duplicated inside test; treat as limited algorithm regression, not full assembler integration proof. Source assembler now uses content-hash comparison. Verified agent actively investigating external-directory cleanup lock; no parallel standalone copy/test run. No final portable acceptance yet. No model calls, installs or system changes by Codex.


00:42 follow-up: agent still actively diagnosing residual copied union-bot process/file mappings, editing runtime; latest standalone evidence smoke exits0, checksum/DB true but external cleanup false => allPassed false. No stable candidate to independently retest. Existing launcher negative9 propagation remains last independent PASS. No duplicate packaged runs or messages by monitor; do not weaken cleanup/actual-exit checks into unconditional acceptance. No paid calls, installs or system changes.

