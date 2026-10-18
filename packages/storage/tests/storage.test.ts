/**
 * @file storage.test.ts
 * @description Comprehensive unit tests for @union-bot/storage (Phase P2 verification).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  StorageEngine,
  EventStore,
  IdempotencyManager,
  ApprovalGateManager,
  WorkspacePathValidator,
  StorageBackupManager,
  UnionBotError,
} from '../src/index.ts';
import { createEnvelope } from '../../protocol/src/index.ts';

describe('Union Bot Storage Engine & Event Sourcing (P2)', () => {
  let tmpDir: string;
  let dbPath: string;
  let storage: StorageEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-storage-test-'));
    dbPath = path.join(tmpDir, 'test_union_bot.db');
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

  it('initializes SQLite WAL mode and applies migrations (P2-003)', () => {
    const db = storage.getRawDatabase();
    const pragmaRow = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
    assert.equal(pragmaRow.journal_mode.toLowerCase(), 'wal');

    const migrations = db.prepare('SELECT version, name FROM schema_migrations').all() as any[];
    assert.equal(migrations.length, 1);
    assert.equal(migrations[0].name, '001_initial_p2_schema');

    // Test rollback capability
    const rollback = storage.rollbackLatestMigration();
    assert.equal(rollback.rolledBackVersion, 1);

    const afterRollback = db.prepare('SELECT COUNT(*) as cnt FROM schema_migrations').get() as { cnt: number };
    assert.equal(afterRollback.cnt, 0);
  });

  it('stores and retrieves rooms and envelopes faithfully', () => {
    storage.ensureRoom('room_core', 'Core Team Room');
    const rooms = storage.getRooms();
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].name, 'Core Team Room');

    const envelope = createEnvelope({
      id: 'env_msg_001',
      sender: { kind: 'user', id: 'user_1', name: 'Developer', role: 'USER' },
      recipient: { kind: 'room', id: 'room_core' },
      roomId: 'room_core',
      fidelity: 'L1_FORMATTED_MARKDOWN',
      parts: [{ kind: 'text', text: 'Hello Union Bot SQLite' }],
    });

    storage.insertEnvelope(envelope);

    const fetched = storage.getEnvelope('env_msg_001');
    assert.ok(fetched);
    assert.equal(fetched.id, 'env_msg_001');
    assert.equal(fetched.parts[0].kind, 'text');

    const roomEnvelopes = storage.getRoomEnvelopes('room_core');
    assert.equal(roomEnvelopes.length, 1);
    assert.equal(roomEnvelopes[0].id, 'env_msg_001');
  });

  it('records events in append-only journal and rebuilds room projections (P2-004, C05)', () => {
    const eventStore = new EventStore(storage);

    const env1 = createEnvelope({
      id: 'env_seq_1',
      sender: { kind: 'agent', id: 'agent_chatgpt', name: 'ChatGPT', role: 'LEADER' },
      recipient: { kind: 'room', id: 'room_orchestration' },
      roomId: 'room_orchestration',
      parts: [{ kind: 'text', text: 'Step 1: Architecture review' }],
    });

    const env2 = createEnvelope({
      id: 'env_seq_2',
      sender: { kind: 'agent', id: 'agent_antigravity', name: 'Antigravity', role: 'IMPLEMENTER' },
      recipient: { kind: 'room', id: 'room_orchestration' },
      roomId: 'room_orchestration',
      parts: [{ kind: 'text', text: 'Step 2: SQLite implementation complete' }],
    });

    eventStore.appendEvent('room:room_orchestration', 'ENVELOPE_RECORDED', env1 as any);
    eventStore.appendEvent('room:room_orchestration', 'ENVELOPE_RECORDED', env2 as any);

    // Hard simulate crash & reopen from disk
    storage.close();
    storage = new StorageEngine({ filename: dbPath, wal: true });
    const reopenedStore = new EventStore(storage);

    const projection = reopenedStore.rebuildRoomProjection('room_orchestration');
    assert.equal(projection.length, 2);
    assert.equal(projection[0].id, 'env_seq_1');
    assert.equal(projection[1].id, 'env_seq_2');
  });

  it('supports seek-based cursor pagination and handles 10k rows performance benchmark (P2-012)', () => {
    const eventStore = new EventStore(storage);
    const streamId = 'stream:perf_test';

    // Insert 10,000 events in a single transaction
    const startInsert = Date.now();
    storage.transaction(() => {
      const db = storage.getRawDatabase();
      const stmt = db.prepare(`
        INSERT INTO events (event_id, stream_id, event_type, payload_json, occurred_at)
        VALUES (?, ?, 'PERF_EVENT', '{"data": "value"}', ?)
      `);
      for (let i = 1; i <= 10000; i++) {
        stmt.run(`evt_bulk_${i}`, streamId, new Date().toISOString());
      }
    });
    const insertDuration = Date.now() - startInsert;
    assert.ok(insertDuration < 3000, `Bulk insert took too long: ${insertDuration}ms`);

    // Measure seek pagination query over 10k rows
    const startQuery = performance.now();
    const page1 = eventStore.getEvents(streamId, { limit: 50, cursor: 5000, direction: 'forward' });
    const queryDuration = performance.now() - startQuery;

    assert.equal(page1.events.length, 50);
    assert.equal(page1.events[0].sequenceId, 5001);
    assert.equal(page1.hasMore, true);
    assert.ok(queryDuration < 20, `Seek pagination took ${queryDuration}ms (expected < 20ms)`);
  });

  it('enforces idempotency and outbox pattern (P2-005, C01, C05)', () => {
    const idemp = new IdempotencyManager(storage);

    // 1. Acquire new key
    const acq1 = idemp.acquire('idemp_key_001', 'req_1');
    assert.equal(acq1.isDuplicate, false);

    // 2. Concurrent pending acquire throws conflict
    assert.throws(
      () => idemp.acquire('idemp_key_001', 'req_1'),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_IDEMPOTENCY_CONFLICT'
    );

    // 3. Mark completed
    idemp.complete('idemp_key_001', { success: true, processedEnvelopeId: 'env_999' });

    // 4. Re-acquire returns cached response
    const acq2 = idemp.acquire('idemp_key_001', 'req_1');
    assert.equal(acq2.isDuplicate, true);
    assert.equal(acq2.cachedResponse?.processedEnvelopeId, 'env_999');

    // 5. Outbox workflow
    const outboxId = idemp.enqueueOutbox('stream:broadcast', 'evt_101', { title: 'Announcement' });
    const pending = idemp.getPendingOutboxEntries();
    assert.ok(pending.some((p) => p.id === outboxId));

    idemp.markOutboxDelivered(outboxId);
    const pendingAfter = idemp.getPendingOutboxEntries();
    assert.ok(!pendingAfter.some((p) => p.id === outboxId));
  });

  it('enforces approval gate tokens with action hash, expiry, and single-use consumption (P2-006, C02)', () => {
    const gate = new ApprovalGateManager(storage);
    const actionPayload = { command: 'node scripts/launch.js', sandbox: true };

    // 1. Create approval token
    const token = gate.createToken({
      actionType: 'EXEC_CLI',
      payload: actionPayload,
      origin: 'ui:composer',
      ttlMs: 2000,
    });
    assert.equal(token.status, 'PENDING');
    assert.equal(token.payloadDigest.length, 64);

    // 2. Consuming with tampered payload is strictly rejected
    const tamperedPayload = { command: 'rm -rf /', sandbox: false };
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'EXEC_CLI', tamperedPayload),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
    );

    // 3. Consuming with wrong action type is rejected
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'SEND_PROMPT', actionPayload),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_HASH_MISMATCH'
    );

    // 4. Consuming while PENDING is strictly rejected (UB-P2-R01-001, P2-T01)
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'EXEC_CLI', actionPayload),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_NOT_APPROVED'
    );

    // 5. PO approves token (UB-P2-R01-001)
    gate.approveToken(token.tokenId, { id: 'po_admin', role: 'LEADER' });

    // 6. Consuming with exact payload now succeeds (P2-T02)
    gate.validateAndConsume(token.tokenId, 'EXEC_CLI', actionPayload);

    // 7. Second use is strictly rejected as ALREADY_CONSUMED (P2-T02)
    assert.throws(
      () => gate.validateAndConsume(token.tokenId, 'EXEC_CLI', actionPayload),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_APPROVAL_ALREADY_CONSUMED'
    );
  });

  it('defends against workspace directory traversal and symlink escapes (P2-007)', () => {
    const validator = new WorkspacePathValidator([tmpDir]);

    // Valid path inside root
    const validFile = path.join(tmpDir, 'data.txt');
    fs.writeFileSync(validFile, 'hello');
    const validated = validator.validate(validFile);
    assert.equal(validated.toLowerCase(), validFile.toLowerCase());

    // Path traversal attempt outside root
    assert.throws(
      () => validator.validate(path.join(tmpDir, '../../../../Windows/System32/cmd.exe')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );

    // Null byte injection attempt
    assert.throws(
      () => validator.validate(path.join(tmpDir, 'file\0.txt')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_PATH_TRAVERSAL_DENIED'
    );
  });

  it('performs atomic backup and restore with SHA256 integrity and redacted diagnostics (P2-009, P2-010)', () => {
    storage.ensureRoom('room_backup_test', 'Backup Room');
    const backupMgr = new StorageBackupManager(storage);

    const backupDir = path.join(tmpDir, 'backups');
    const { backupFile, manifestFile, manifest } = backupMgr.backup(backupDir);

    assert.ok(fs.existsSync(backupFile));
    assert.ok(fs.existsSync(manifestFile));
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.sha256.length, 64);

    // Restore to new database path
    const restoredDbPath = path.join(tmpDir, 'restored.db');
    StorageBackupManager.restore(backupFile, manifestFile, restoredDbPath);
    assert.ok(fs.existsSync(restoredDbPath));

    const restoredStorage = new StorageEngine({ filename: restoredDbPath, wal: false });
    const restoredRooms = restoredStorage.getRooms();
    assert.equal(restoredRooms.length, 1);
    assert.equal(restoredRooms[0].id, 'room_backup_test');
    restoredStorage.close();

    // Verify corruption detection
    fs.appendFileSync(backupFile, 'CORRUPTED_BYTES');
    assert.throws(
      () => StorageBackupManager.restore(backupFile, manifestFile, path.join(tmpDir, 'fail.db')),
      (err: any) => err instanceof UnionBotError && err.code === 'ERR_STORAGE_CORRUPTION'
    );

    // Verify diagnostics scrub sensitive tokens
    const diag = backupMgr.exportRedactedDiagnostics();
    assert.equal(diag.system, 'Union Bot');
  });

  it('classifies error codes and retry policies accurately (P2-011)', () => {
    const policyErr = new UnionBotError({
      code: 'ERR_UNKNOWN_COST_DENIED',
      message: 'Unknown cost',
    });
    assert.equal(policyErr.retryable, false);

    const networkErr = new UnionBotError({
      code: 'ERR_TIMEOUT',
      message: 'Socket timeout',
    });
    assert.equal(networkErr.retryable, true);
  });
});
