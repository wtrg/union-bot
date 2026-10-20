# Production backup callback probe — 2026-10-21 02:16 Asia/Saigon

Executed `node reports/qa/verify-backup-handlers.cjs`, exit1, approximately2s. Source main.js SHA256 `65fcc4c8ae9eba8841229c4cecd818adf7c9e7b2bb5d053f95c710886a6c42be` captured at start. Evidence retained: `C:/Users/Lenovo/AppData/Local/Temp/union-bot-real-backup-4xiH1r/evidence.json`.

Scope: TypeScript AST extracts the ACTUAL current main.js callback expressions for export-transcript-bundle/import-transcript-bundle and executes them unchanged with real StorageServiceClient SQLite and ArtifactStore. Sender authorization is stubbed true and app.getPath is isolated; no Electron IPC/origin/UI/model claim. No app/model/network execution, no deletes; both source/destination DB/CAS isolated and clients closed.

Observed actual callback outcomes:
- Long Unicode message (>1000chars) + one attachment: exportSuccess/importSuccess true, tail marker preserved, bytes in a fresh destination CAS. However restored message has NO structured attachment/artifact parts, so restored UI/manual handoff metadata lost. This is not a complete content+artifact backup roundtrip.
- Two distinct 24-byte artifacts named same.txt: export success, importer FAILS ERR_CHECKSUM_MISMATCH because filename copy overwrote the first artifact and importer selects same.txt ahead of SHA copy. Destination message count0, not a successful roundtrip.

Existing owner helper verify-backup-roundtrip.cjs is NOT proof of product roundtrip: it manually writes/copies a fixture bundle, hashes readback, and asserts tampered bytes differ. It never invokes product exporter/importer or SQLite restoration, and it never asserts the importer rejects tampering. Its PASS must be scoped to those filesystem checks only.

Continue full UAT021: use safe SHA paths, validate every artifact before mutation, preserve actual history/parts and expose restored artifacts through UI. Test missing/wrong-digest/wrong-size plus duplicate names and long content, with unchanged destination on rejection. Task dispatch canonical project root and cross-root service isolation remain open independently of storage filter PASS.

## Retest after further source changes — 02:18

Actual handler helper extended with malformed envelopes.json: valid first record + invalid second record, fresh destination SQLite/CAS. Reran exit1, source SHA256 `d22b683ce6317be0a959d7809b1fb450c7785bbfe985d73381dc4f5e81b30f12`. Evidence `C:/Users/Lenovo/AppData/Local/Temp/union-bot-real-backup-iSC8Hl/evidence.json`.

- Long text tail marker + structured artifact + fresh destination CAS: now PASS.
- Two different SHA artifacts sharing same.txt: now PASS.
- Malformed second envelope: FAIL. Actual importer logs missing sender.kind, swallows exception and returns success=true/verified=true/restoredEnvelopesCount=1. Destination already contains first message and artifact bytes. Must prevalidate all envelope records and destination mapping before mutation, then use transactional storage restore; don't label sequential writes atomic. Do not silently fall back from invalid structured backup to Markdown success.
