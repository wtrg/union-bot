# Actual packaged attachment/export UI — 2026-10-21 02:08–02:10 Asia/Saigon

Candidate: retained independent c405f21 portable outside repository, not current uncommitted source. Executable `C:/Users/Lenovo/AppData/Local/Temp/union-bot-codex-portable-2CyJXJ/union-bot.exe`. Fresh normal profile `C:/Users/Lenovo/AppData/Local/Temp/union-bot-attachments-qa-dee92a2ff6ae4a56a27f451f74fbc7f0`. No smoke/mock/provider flags, no model task dispatched.

Actual native UI actions:
- Opened paperclip/file dialog, selected only known fixture D:/WORK-TEAM/p5_test_saved_pixel.png.
- Sent local Vietnamese text plus PNG. Card showed 70 bytes/image/png and verified SHA256.
- Reloaded UI with Ctrl+R, waited for reload completion and observed same text/card/hash.
- Independently hashed the actual file in this profile's cas-store: 70 bytes, SHA256 `6b7fa434f92a8b80aab02d9bf1a12e49ffcae424e4013a1c4f68b67e3d2bbcd0`, matching fixture.
- Clicked Export Bundle. UI displayed "Exported 1 artifacts!".

Actual export directory: profile exports/bundle_orchestration_1792523379441. It contains ONLY transcript.md (362 bytes) and manifest.json (132 bytes). Transcript preserves the message/artifact name/digest. Manifest is a TOP-LEVEL ARRAY of `{sha256,byteSize,exists}`. There are no artifact bytes in the directory. Thus export success does not prove a standalone/restorable artifact backup.

Source audit (not an executed import): import-transcript-bundle exists in main/preload, correcting earlier narrow SOURCE_GAP search. It expects `manifest.artifacts`, so the exported array is skipped and verifiedArtifactCount can remain0. It skips missing artifact paths, truncates transcript to1000 chars, constructs an envelope without required traceId/sender.kind, catches insertEnvelope failure, then returns success/verified anyway. This cannot satisfy original UAT021 content+manifest+SHA roundtrip. No import UI control was located in the chat/preferences source search; do not claim complete backup restore.

Coverage: partial UAT004 (text+PNG card/CAS/reload), partial UAT021 export. PDF/full Markdown/preview fidelity/full backup restore/native T1 remain unaccepted.

Read-only independent byte validator `node reports/qa/verify-backup-artifact-bytes.cjs <above QA export directory>` executed02:12 exit1: manifest lists70-byte PNG but no matching bytes exist anywhere in bundle. Validator accepts either manifest array or object and compares actual SHA/bytes, so this result does not depend on a prescribed file layout. It does not execute the importer. Current working-tree import code is under active implementation, not certified as part of retained packaged candidate.

02:14 source-review caution during implementation: new export copy paths use envelope part.filename directly in path.join(bundleDir, filename) and path.join(artifactsDir, filename). Enforce resolved/real containment and avoid trusting filename; SHA-named artifact files plus original name in metadata avoid traversal and same-name overwrite. New importer candidate paths similarly need containment/symlink checks before reads and fail-closed digest/byte checks for EVERY listed artifact, with no partial-success persistence. Do not exercise negative vectors against user data. Preserve full message/structured artifact state for backup roundtrip; mere flattened/truncated Markdown is not proof of project restoration. Use a >1000-char QA message with an end marker and two same-name/different-hash artifacts to verify lossless behavior.

Launch note: initial Hidden test start did not expose a UI. Only processes with the exact unique QA-copy executable path were stopped, then the same isolated profile was relaunched visibly for the user-requested UI test. No unrelated process, system permission setting, user data, secrets or paid service touched. File dialog focus metadata was stale; screenshot confirmed filename path before Open. No Windows Security prompt appeared in this run.

Closed normal QA window using Alt+F4. After5s the window and main process were gone but3 own child processes still existed (18980/17104/18020, parent27144). Later bounded read-only check found all3 absent; no forced termination or file cleanup used after normal UI test. This does not prove instant child cleanup or every shutdown path.
