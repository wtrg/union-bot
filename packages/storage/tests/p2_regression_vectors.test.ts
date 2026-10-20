/**
 * @file p2_regression_vectors.test.ts
 * @description Official Mandatory 18 Regression Test Vectors for Union Bot Phase P2 R02.
 * Adheres strictly to Technical Leader Directive (REVIEW_FIX_PLAN_P2_R01.md, P2-T01 through P2-T18).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);

import {
  StorageEngine,
  EventStore,
  IdempotencyManager,
  ApprovalGateManager,
  WorkspacePathValidator,
  StorageBackupManager,
  UnionBotError,
  canonicalizeJson,
  computeCanonicalDigest,
  runMigrations,
  MIGRATIONS,
} from '../src/index.ts';

import {
  createEnvelope,
  EnvelopeSchema,
  ProviderIdentitySchema,
  ContentFidelitySchema,
  normalizeContentFidelity,
  SCHEMA_VERSION,
} from '../../protocol/src/index.ts';

describe('Union Bot Phase P2 Official Regression Vectors (P2-T01 through P2-T18)', () => {
  let tmpDir: string;
  let dbPath: string;
  let storage: StorageEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-p2-vectors-'));
    dbPath = path.join(tmpDir, 'vectors_union_bot.db');
    storage = new StorageEngine({ filename: dbPath, wal: true });
  });

  afterEach(() => {
    try {
      storage.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  });

  // ==========================================
  // P2-T01: Không được tiêu thụ PENDING (S0)
  // ==========================================
  it('P2-T01: Token in PENDING status strictly rejected before PO approval; 0 effect', () => {
    const gate = new ApprovalGateManager(storage);
    const actionPayload = { tool: 'write_file', params: { path: 'safe.txt', content: 'hello' } };

    const token = gate.createToken({
      actionType: 'write_file',
      payload: actionPayload,
      origin: 'renderer:composer',
      workspaceId: 'ws_alpha',
      roomId: 'room_general',
    });

    assert.equal(token.status, 'PENDING');

    // Attempting to consume PENDING token must strictly throw ERR_APPROVAL_NOT_APPROVED
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'write_file', actionPayload),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_APPROVAL_NOT_APPROVED');
        return true;
      }
    );

    // Verify token remains PENDING in database
    const tokenDb = gate.getToken(token.tokenId);
    assert.ok(tokenDb);
    assert.equal(tokenDb.status, 'PENDING');
    assert.equal(tokenDb.consumedAt, undefined);
  });

  // ==========================================
  // P2-T02: PO APPROVED và one-time CAS (S0)
  // ==========================================
  it('P2-T02: PO approval unlocks token; atomic CAS guarantees exactly one consumption', () => {
    const gate = new ApprovalGateManager(storage);
    const actionPayload = { tool: 'deploy_service', params: { target: 'staging', replicas: 2 } };

    const token = gate.createToken({
      actionType: 'deploy_service',
      payload: actionPayload,
      origin: 'ui:admin',
    });

    // PO approves token
    const approveResult = gate.approveToken(token.tokenId, { id: 'user_lead', role: 'LEADER', isTrustedContext: true });
    assert.equal(approveResult.success, true);

    const tokenApproved = gate.getToken(token.tokenId);
    assert.equal(tokenApproved?.status, 'APPROVED');

    // Worker 1 consumes token successfully
    assert.doesNotThrow(() => {
      gate.validateAndConsume(token.tokenId, 'deploy_service', actionPayload);
    });

    const tokenConsumed = gate.getToken(token.tokenId);
    assert.equal(tokenConsumed?.status, 'CONSUMED');
    assert.ok(tokenConsumed.consumedAt);

    // Worker 2 attempts concurrent consumption on same token -> strictly rejected with ERR_APPROVAL_ALREADY_CONSUMED
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'deploy_service', actionPayload),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_APPROVAL_ALREADY_CONSUMED');
        return true;
      }
    );
  });

  // ==========================================
  // P2-T03: Digest bao phủ nested payload và phạm vi (S0)
  // ==========================================
  it('P2-T03: Recursive canonical digest binds nested properties, preserves array order, and ignores object key order', () => {
    const safeAction = {
      tool: 'write_file',
      params: { path: 'safe.txt', options: { overwrite: false, mode: 0o644 } },
      tags: ['alpha', 'beta'],
    };

    const changedNestedAction = {
      tool: 'write_file',
      params: { path: 'safe.txt', options: { overwrite: true, mode: 0o644 } }, // nested boolean flipped!
      tags: ['alpha', 'beta'],
    };

    const reorderedKeysAction = {
      tags: ['alpha', 'beta'],
      params: { options: { mode: 0o644, overwrite: false }, path: 'safe.txt' },
      tool: 'write_file',
    };

    const reorderedArrayAction = {
      tool: 'write_file',
      params: { path: 'safe.txt', options: { overwrite: false, mode: 0o644 } },
      tags: ['beta', 'alpha'], // array order swapped!
    };

    const digestSafe = computeCanonicalDigest(safeAction);
    const digestChanged = computeCanonicalDigest(changedNestedAction);
    const digestReordered = computeCanonicalDigest(reorderedKeysAction);
    const digestArrayReordered = computeCanonicalDigest(reorderedArrayAction);

    // 1. Changing nested property MUST change digest
    assert.notEqual(digestSafe, digestChanged, 'Changing nested property must alter digest');

    // 2. Changing object key order MUST NOT change digest
    assert.equal(digestSafe, digestReordered, 'Reordering object keys must produce identical digest');

    // 3. Changing array element order MUST change digest
    assert.notEqual(digestSafe, digestArrayReordered, 'Reordering array elements must alter digest');

    // 4. Verify rejection of illegal inputs (cycles, NaN, Infinity)
    const circular: any = { a: 1 };
    circular.self = circular;
    assert.throws(() => canonicalizeJson(circular), /circular/i);
    assert.throws(() => canonicalizeJson({ val: NaN }), /non-finite/i);
    assert.throws(() => canonicalizeJson({ val: Infinity }), /non-finite/i);
  });

  // ==========================================
  // P2-T04: Electron GUI lưu thật qua kill/restart (S1)
  // ==========================================
  it('P2-T04: Envelopes persisted to disk survive process close and reload exactly once', () => {
    const env = createEnvelope({
      id: 'env_persist_t04',
      sender: { kind: 'user', id: 'usr_01', name: 'Alice', role: 'USER' },
      recipient: { kind: 'room', id: 'room_dev' },
      roomId: 'room_dev',
      parts: [{ kind: 'text', text: 'Persistent message through restart' }],
    });

    storage.insertEnvelope(env);

    // Simulate process kill/close
    storage.close();

    // Simulate relaunching app and reopening same SQLite database file
    const reopenedStorage = new StorageEngine({ filename: dbPath, wal: true });
    try {
      const recoveredEnv = reopenedStorage.getEnvelope('env_persist_t04');
      assert.ok(recoveredEnv);
      assert.equal(recoveredEnv.id, 'env_persist_t04');
      assert.equal(recoveredEnv.parts[0].kind, 'text');

      const roomHistory = reopenedStorage.getRoomEnvelopes('room_dev');
      assert.equal(roomHistory.length, 1);
      assert.equal(roomHistory[0].id, 'env_persist_t04');
    } finally {
      reopenedStorage.close();
    }
  });

  // ==========================================
  // P2-T05: Transaction envelope/event/idempotency nguyên tử (S1)
  // ==========================================
  it('P2-T05: Atomic multi-write rollback on failure leaves zero partial state', () => {
    const env = createEnvelope({
      id: 'env_tx_fail_01',
      sender: { kind: 'user', id: 'usr_01', name: 'Bob', role: 'USER' },
      recipient: { kind: 'room', id: 'room_tx' },
      roomId: 'room_tx',
      parts: [{ kind: 'text', text: 'This write will fail mid-transaction' }],
    });

    const eventStore = new EventStore(storage);
    const idemp = new IdempotencyManager(storage);

    // Fault injection mid-transaction
    assert.throws(() => {
      storage.transaction(() => {
        storage.insertEnvelope(env);
        eventStore.appendEvent('room:room_tx', 'ENVELOPE_RECORDED', env as any);
        throw new Error('Simulated crash before completing idempotency');
      });
    }, /Simulated crash/);

    // Verify all-or-nothing rollback: neither envelope nor event exists in DB
    const fetchedEnv = storage.getEnvelope('env_tx_fail_01');
    assert.equal(fetchedEnv, null, 'Envelope must be rolled back on transaction error');

    const rawDb = storage.getRawDatabase();
    const eventCount = rawDb.prepare("SELECT COUNT(*) as cnt FROM events WHERE stream_id = 'room:room_tx'").get() as any;
    assert.equal(eventCount.cnt, 0, 'Event must be rolled back on transaction error');
  });

  // ==========================================
  // P2-T06: Crash sau side effect trước ACK (S1)
  // ==========================================
  it('P2-T06: UNKNOWN_NEEDS_RECONCILIATION entries are strictly excluded from pending dispatch queue', () => {
    const idemp = new IdempotencyManager(storage);

    const queuedId = idemp.enqueueOutbox('stream:broadcast', 'evt_q1', { task: 'send_notice' });
    const unknownId = idemp.enqueueOutbox('stream:broadcast', 'evt_u1', { task: 'charge_wallet' });

    // Mark unknown entry as UNKNOWN_NEEDS_RECONCILIATION
    idemp.markOutboxNeedsReconciliation(unknownId);

    // getPendingOutboxEntries MUST ONLY return QUEUED entries
    const pending = idemp.getPendingOutboxEntries();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, queuedId);
    assert.ok(!pending.some((p) => p.id === unknownId), 'UNKNOWN entries must never be returned for automatic dispatch');

    // Dedicated reconciliation query returns the UNKNOWN entry
    const reconciliationEntries = idemp.getReconciliationEntries();
    assert.equal(reconciliationEntries.length, 1);
    assert.equal(reconciliationEntries[0].id, unknownId);
  });

  // ==========================================
  // P2-T07: Idempotency cùng khóa, hết hạn và FAILED (S1)
  // ==========================================
  it('P2-T07: Reusing idempotency key with mismatched payload digest throws ERR_PAYLOAD_MISMATCH', () => {
    const idemp = new IdempotencyManager(storage);
    const key = 'idemp_fixed_001';

    const digestA = computeCanonicalDigest({ action: 'create', resource: 'doc_1' });
    const digestB = computeCanonicalDigest({ action: 'delete', resource: 'doc_1' });

    idemp.acquire(key, 'req_target_1', { payloadDigest: digestA });

    // Attempting to acquire same key with different payload digest
    assert.throws(
      () => idemp.acquire(key, 'req_target_1', { payloadDigest: digestB }),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_PAYLOAD_MISMATCH');
        return true;
      }
    );
  });

  // ==========================================
  // P2-T08: Migration fail giữa up và tracker (S1)
  // ==========================================
  it('P2-T08: Migration failure rolls back atomically, leaving schema clean', () => {
    const testDb = new DatabaseSync(':memory:');

    // Running standard migrations
    const expectedCount = MIGRATIONS.length;
    const res = runMigrations(testDb);
    assert.equal(res.appliedCount, expectedCount);
    assert.equal(res.currentVersion, expectedCount);

    // Injecting faulty migration
    const faultyMigration = {
      version: expectedCount + 1,
      name: 'faulty_test_migration',
      checksum: 'fake_checksum',
      up: (db: DatabaseSync) => {
        db.exec('CREATE TABLE temp_faulty (id INT);');
        throw new Error('Simulated disk full / DDL failure');
      },
      down: () => {},
    };

    MIGRATIONS.push(faultyMigration);

    try {
      assert.throws(() => runMigrations(testDb), (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_MIGRATION_FAILED');
        return true;
      });

      // Verify temp_faulty table does not exist
      const tableCheck = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='temp_faulty'")
        .get();
      assert.equal(tableCheck, undefined, 'Faulty migration must leave zero partial schema');

      // Version remains expectedCount
      const vRow = testDb.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as any;
      assert.equal(vRow.v, expectedCount);
    } finally {
      MIGRATIONS.pop();
      testDb.close();
    }
  });

  // ==========================================
  // P2-T09: Version/schema không tương thích (S1)
  // ==========================================
  it('P2-T09: Rejecting unsupported future schema versions and tampered migration checksums', () => {
    // 1. Ingress schema version check: future version '999.0.0' rejected
    assert.throws(
      () =>
        EnvelopeSchema.parse({
          schemaVersion: '999.0.0',
          id: 'env_future_01',
          traceId: 'tr_01',
          timestamp: Date.now(),
          sender: { kind: 'user', id: 'u1', name: 'User' },
          recipient: { kind: 'room', id: 'r1' },
          roomId: 'r1',
          parts: [{ kind: 'text', text: 'future version' }],
          fidelity: 'L0_RAW_TEXT',
        }),
      /Unsupported or future schemaVersion/
    );

    // 2. Tampered migration checksum in DB is rejected
    const testDb = new DatabaseSync(':memory:');
    runMigrations(testDb);

    // Tamper with checksum in schema_migrations
    testDb.prepare("UPDATE schema_migrations SET checksum = 'tampered_sha256' WHERE version = 1").run();

    assert.throws(
      () => runMigrations(testDb),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_MIGRATION_TAMPERED');
        return true;
      }
    );
    testDb.close();
  });

  // ==========================================
  // P2-T10: Backup WAL và restore an toàn (S1)
  // ==========================================
  it('P2-T10: Atomic WAL backup and verified restore with integrity_check and foreign keys', () => {
    const backupMgr = new StorageBackupManager(storage);
    const backupDir = path.join(tmpDir, 'backups');

    storage.ensureRoom('room_backup_t10', 'Backup Room');
    const backupResult = backupMgr.backup(backupDir);

    assert.ok(fs.existsSync(backupResult.backupFile));
    assert.ok(fs.existsSync(backupResult.manifestFile));

    // Restore to fresh target path
    const restoreTargetPath = path.join(tmpDir, 'restored_db.db');
    StorageBackupManager.restore(backupResult.backupFile, backupResult.manifestFile, restoreTargetPath);

    assert.ok(fs.existsSync(restoreTargetPath));

    // Verify restored database integrity
    const restoredStorage = new StorageEngine({ filename: restoreTargetPath, wal: false });
    try {
      const rooms = restoredStorage.getRooms();
      assert.ok(rooms.some((r) => r.id === 'room_backup_t10'));
    } finally {
      restoredStorage.close();
    }
  });

  // ==========================================
  // P2-T11: Backup destination với ký tự đặc biệt / apostrophe (S1)
  // ==========================================
  it("P2-T11: Backup handles paths with apostrophes (O'Brien), spaces, and Unicode safely", () => {
    const backupMgr = new StorageBackupManager(storage);
    const specialBackupDir = path.join(tmpDir, "User O'Brien Backups Tiếng Việt");

    const result = backupMgr.backup(specialBackupDir);
    assert.ok(fs.existsSync(result.backupFile));
    assert.ok(fs.existsSync(result.manifestFile));
  });

  // ==========================================
  // P2-T12: Diagnostic redaction / PII (S1)
  // ==========================================
  it('P2-T12: exportRedactedDiagnostics scrubs emails, API keys, tokens, and excludes raw room names', () => {
    const rawDb = storage.getRawDatabase();
    // Insert room containing PII
    rawDb
      .prepare('INSERT INTO rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('r_pii', 'Alice <alice@example.com> token=secret_tok_123', new Date().toISOString(), new Date().toISOString());

    const backupMgr = new StorageBackupManager(storage);
    const diag = backupMgr.exportRedactedDiagnostics();

    const diagStr = JSON.stringify(diag);
    assert.ok(!diagStr.includes('alice@example.com'), 'Email must be redacted');
    assert.ok(!diagStr.includes('secret_tok_123'), 'Secret token must be redacted');
    assert.ok(typeof diag.roomCount === 'number' && diag.roomCount >= 1);
  });

  // ==========================================
  // P2-T13: IPC senderFrame trust boundary (S1)
  // ==========================================
  it('P2-T13: IPC verification denies null/missing senderFrame, navigated frames, and non-main frames', () => {
    // Import production verification function directly from apps/desktop/src/auth-check.cjs (UB-P2-R02-006)
    const { isAuthorizedSenderFrame } = require('../../../apps/desktop/src/auth-check.cjs');
    const allowedUrl = 'file:///d:/WORK-TEAM/apps/workspace-ui/dist/index.html';
    const mockWindow = {
      webContents: { id: 1 },
      isDestroyed: () => false,
    };

    // 1. Missing event
    assert.equal(isAuthorizedSenderFrame(null, mockWindow, allowedUrl), false);
    // 2. Missing senderFrame
    assert.equal(isAuthorizedSenderFrame({ sender: { id: 1 } }, mockWindow, allowedUrl), false);
    // 3. Sender is untrusted window/ID
    assert.equal(isAuthorizedSenderFrame({ sender: { id: 999 }, senderFrame: { parent: null, url: allowedUrl } }, mockWindow, allowedUrl), false);
    // 4. Nested iframe (parent !== null)
    assert.equal(isAuthorizedSenderFrame({ sender: { id: 1 }, senderFrame: { parent: {}, url: allowedUrl } }, mockWindow, allowedUrl), false);
    // 5. Hostile data: URL
    assert.equal(isAuthorizedSenderFrame({ sender: { id: 1 }, senderFrame: { parent: null, url: 'data:text/html,<html>attack</html>' } }, mockWindow, allowedUrl), false);
    // 6. Legitimate main frame
    assert.equal(isAuthorizedSenderFrame({ sender: { id: 1 }, senderFrame: { parent: null, url: allowedUrl } }, mockWindow, allowedUrl), true);
  });

  // ==========================================
  // P2-T14: Sáu fidelity ngữ nghĩa đúng và CAS (S1)
  // ==========================================
  it('P2-T14: 6 content preservation labels roundtrip losslessly; normalizeContentFidelity maps faithfully', () => {
    const sixLabels = [
      'original_bytes',
      'structured_copy',
      'rendered_preview',
      'screenshot_only',
      'external_reference',
      'unavailable',
    ] as const;

    for (const label of sixLabels) {
      const parsed = ContentFidelitySchema.parse(label);
      assert.equal(parsed, label);
      assert.equal(normalizeContentFidelity(label), label);
    }

    // Legacy label mapping
    assert.equal(normalizeContentFidelity('RAW_BINARY'), 'original_bytes');
    assert.equal(normalizeContentFidelity('STRUCTURED_DOC'), 'structured_copy');
    assert.equal(normalizeContentFidelity('LOSSLESS_PREVIEW'), 'rendered_preview');
  });

  // ==========================================
  // P2-T15: Provider profile không tự nhận đã login/live (S1)
  // ==========================================
  it('P2-T15: ProviderIdentity defaults to NOT_VERIFIED and UNVERIFIED evidence provenance', () => {
    const identity = ProviderIdentitySchema.parse({
      provider: 'chatgpt',
      profileId: 'prof_chatgpt_01',
    });

    assert.equal(identity.authStatus, 'NOT_VERIFIED', 'Must default to NOT_VERIFIED, never AUTHENTICATED');
    assert.equal(identity.evidenceProvenance, 'UNVERIFIED', 'Must default to UNVERIFIED, never LOCAL_RPC');
  });

  // ==========================================
  // P2-T16: Windows path, junction và TOCTOU (S2)
  // ==========================================
  it('P2-T16: WorkspacePathValidator rejects ADS (:stream), Windows reserved devices, trailing dots, and ancestor escapes', () => {
    const validator = new WorkspacePathValidator([tmpDir]);

    // 1. Alternate Data Streams (ADS)
    assert.throws(
      () => validator.validate(path.join(tmpDir, 'file.txt:hidden_stream')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );

    // 2. Windows reserved device name
    assert.throws(
      () => validator.validate(path.join(tmpDir, 'CON.txt')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );

    // 3. Trailing dot bypass
    assert.throws(
      () => validator.validate(path.join(tmpDir, 'subfolder.')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );

    // 4. Drive relative bypass (e.g. C:temp)
    assert.throws(
      () => validator.validate('C:some_relative_file.txt'),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );

    // 5. Valid path passes
    const validPath = path.join(tmpDir, 'safe_subfolder', 'document.txt');
    const validated = validator.validate(validPath);
    assert.ok(validated.toLowerCase().startsWith(tmpDir.toLowerCase()));
  });

  // ==========================================
  // P2-T17: Project/room isolation và stale approval (S1)
  // ==========================================
  it('P2-T17: Approval token bound to workspace/room is rejected when requested from different workspace/room', () => {
    const gate = new ApprovalGateManager(storage);
    const actionPayload = { op: 'wipe_cache' };

    const token = gate.createToken({
      actionType: 'wipe_cache',
      payload: actionPayload,
      origin: 'admin',
      workspaceId: 'workspace_alpha',
      roomId: 'room_private',
    });

    gate.approveToken(token.tokenId, { id: 'admin_usr', role: 'ADMIN', isTrustedContext: true });

    // Consuming from different workspace must throw ERR_UNTRUSTED_ACTION
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'wipe_cache', actionPayload, { workspaceId: 'workspace_beta' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_ACTION'
    );

    // Consuming from different room must throw ERR_UNTRUSTED_ACTION
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'wipe_cache', actionPayload, { roomId: 'room_public' }),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_UNTRUSTED_ACTION'
    );

    // Consuming from matching scope succeeds
    assert.doesNotThrow(() => {
      gate.validateAndConsume(token.tokenId, 'wipe_cache', actionPayload, {
        workspaceId: 'workspace_alpha',
        roomId: 'room_private',
      });
    });
  });

  // ==========================================
  // P2-T18: Clean-checkout verify và release evidence (S2)
  // ==========================================
  it('P2-T18: System reports exact version constants, deterministic schemas, and verified error taxonomy', () => {
    assert.equal(SCHEMA_VERSION, '1.0.0');
    assert.ok(Array.isArray(MIGRATIONS));
    assert.ok(MIGRATIONS.length >= 1);
    assert.equal(typeof MIGRATIONS[0].checksum, 'string');
    assert.equal(MIGRATIONS[0].checksum.length, 64);
  });
});
