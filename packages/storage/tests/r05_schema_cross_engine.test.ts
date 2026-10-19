/**
 * @file r05_schema_cross_engine.test.ts
 * @description Official Phase P2 Round R05 Test Suite for Schema Parity & Legacy Migrations (UB-P2-R04-01).
 *
 * Implements:
 * - R05-H01: Worker creates fresh DB, TypeScript StorageEngine cross-opens it.
 * - R05-H02: TypeScript StorageEngine creates DB, Electron native and worker cross-open and mutate it.
 * - R05-H03: 3 Legacy DB fixtures (R02, R03, R04 format with e3b0c442...) upgraded safely with zero data loss.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { StorageEngine, UnionBotError, MIGRATIONS } from '../src/index.ts';
// @ts-ignore
import schemaDefinition from '../src/schema-definition.cjs';

const {
  CANONICAL_MIGRATION_1_CHECKSUM,
  LEGACY_R04_EMPTY_CHECKSUM,
  runSchemaMigrations,
} = schemaDefinition;

// @ts-ignore
import desktopStorageService from '../../../apps/desktop/src/storage-service.cjs';
const { StorageServiceClient } = desktopStorageService;

const REQUIRED_TABLES = [
  'rooms',
  'events',
  'envelopes',
  'idempotency_keys',
  'outbox',
  'approvals',
  'dag_nodes',
  'snapshots',
  'audit_ledger',
  'schema_migrations',
];

const REQUIRED_INDICES = [
  'idx_events_stream_seq',
  'idx_events_occurred_at',
  'idx_events_type',
  'idx_envelopes_room',
  'idx_envelopes_trace',
  'idx_outbox_status',
  'idx_dag_recovery',
];

describe('Union Bot Phase P2 Gate R05: Schema Cross-Engine & Migration Tests (H01, H02, H03)', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-bot-r05-schema-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // =========================================================================
  // R05-H01: Worker tạo database mới, TypeScript mở chéo
  // =========================================================================
  it('R05-H01: Worker creates fresh DB, TypeScript cross-opens with zero ERR_MIGRATION_TAMPERED', async () => {
    const dbPath = path.join(tmpDir, 'h01_worker_to_ts.db');

    // 1. Storage worker initializes DB and writes a room and an envelope
    const workerClient = new StorageServiceClient(dbPath, { forceWorker: true });
    await workerClient.ready;

    await workerClient.ensureRoom('h01-room', 'H01 Worker Room');
    const testEnvelope = {
      id: 'env_h01_001',
      traceId: 'trc_h01_001',
      roomId: 'h01-room',
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'worker_user', role: 'USER' },
      recipient: { kind: 'room', id: 'h01-room' },
      fidelity: 'L0_RAW_TEXT',
      parts: [{ kind: 'text', text: 'Hello from Node 24 worker' }],
    };
    const insertRes = await workerClient.insertEnvelope(testEnvelope);
    assert.equal(insertRes.success, true);

    // 2. Close worker completely
    await workerClient.closeAsync();

    // 3. Open exact same database file using TypeScript StorageEngine
    const tsEngine = new StorageEngine({ filename: dbPath, wal: true });
    const rawDb = tsEngine.getRawDatabase();

    // 4. Verify PRAGMAs
    const integrityCheck = (rawDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    assert.equal(integrityCheck, 'ok', 'Database integrity check must be ok');

    const fkCheck = rawDb.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkCheck.length, 0, 'Foreign key check must return 0 violations');

    // 5. Verify schema_migrations record
    const migrationRow = rawDb.prepare('SELECT version, name, checksum FROM schema_migrations WHERE version = 1').get() as any;
    assert.ok(migrationRow, 'schema_migrations row 1 must exist');
    assert.equal(migrationRow.version, 1);
    assert.equal(migrationRow.name, '001_initial_p2_schema');
    assert.equal(migrationRow.checksum, CANONICAL_MIGRATION_1_CHECKSUM, 'Checksum written by worker must match canonical registry');

    // 6. Verify required tables and indices exist
    const tables = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((r) => r.name);
    for (const t of REQUIRED_TABLES) {
      assert.ok(tables.includes(t), `Table '${t}' must exist in worker-created DB`);
    }

    const indices = (rawDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as any[]).map((r) => r.name);
    for (const idx of REQUIRED_INDICES) {
      assert.ok(indices.includes(idx), `Index '${idx}' must exist in worker-created DB`);
    }

    // 7. Verify persisted envelope is read losslessly by TS engine
    const storedEnvelope = tsEngine.getEnvelope('env_h01_001');
    assert.ok(storedEnvelope, 'Envelope must be retrievable by TypeScript engine');
    assert.equal(storedEnvelope?.id, 'env_h01_001');
    assert.equal(storedEnvelope?.roomId, 'h01-room');

    tsEngine.close();

    // 8. Negative Test: Tamper with migration checksum and verify TS engine rejects fail-closed
    const tamperDb = new DatabaseSync(dbPath);
    tamperDb.prepare("UPDATE schema_migrations SET checksum = 'tampered_foreign_checksum_bad' WHERE version = 1").run();
    tamperDb.close();

    assert.throws(
      () => new StorageEngine({ filename: dbPath, wal: true }),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_MIGRATION_TAMPERED');
        assert.ok(err.message.includes('checksum mismatch'));
        return true;
      },
      'Tampered migration checksum must strictly throw ERR_MIGRATION_TAMPERED'
    );
  });

  // =========================================================================
  // R05-H02: TypeScript tạo DB, Electron native và worker cùng mở
  // =========================================================================
  it('R05-H02: TypeScript creates DB, Electron native and worker cross-open and mutate two-way', async () => {
    const dbPath = path.join(tmpDir, 'h02_ts_to_native_worker.db');

    // 1. TypeScript StorageEngine initializes database and seeds business entities
    const tsEngine1 = new StorageEngine({ filename: dbPath, wal: true });
    tsEngine1.ensureRoom('h02-shared-room', 'Shared Room');
    const rawDb1 = tsEngine1.getRawDatabase();

    const now = new Date().toISOString();
    // Seed an approval token, outbox entry, and dag_node
    rawDb1.prepare(`
      INSERT INTO approvals (token_id, action_type, payload_digest, origin, status, created_at, expires_at)
      VALUES ('appr_h02_001', 'exec_cli', '1111111111111111111111111111111111111111111111111111111111111111', 'local', 'PENDING', ?, ?)
    `).run(now, new Date(Date.now() + 3600000).toISOString());

    rawDb1.prepare(`
      INSERT INTO outbox (id, stream_id, event_id, payload_json, status, retry_count, created_at, updated_at)
      VALUES ('out_h02_001', 'room:h02-shared-room', 'evt_h02_001', '{"test":true}', 'QUEUED', 0, ?, ?)
    `).run(now, now);

    rawDb1.prepare(`
      INSERT INTO dag_nodes (task_id, node_id, name, dependencies_json, assigned_role, correlation_id, recovery_state, raw_json, updated_at)
      VALUES ('task_1', 'node_1', 'Build Artifact', '[]', 'IMPLEMENTER', 'corr_1', 'IDLE', '{}', ?)
    `).run(now);

    tsEngine1.close();

    // 2. Open with Electron Native SQLite client (in-process DatabaseSync)
    const nativeClient = new StorageServiceClient(dbPath, { forceWorker: false });
    await nativeClient.ready;
    assert.equal(nativeClient.isNative, true, 'Client must operate in native in-process mode');

    // Read seeded room and entities
    const nativeRooms = await nativeClient.getRooms();
    assert.ok(nativeRooms.some((r: any) => r.id === 'h02-shared-room'));

    const tokenFromNative = await nativeClient.getApprovalToken('appr_h02_001');
    assert.ok(tokenFromNative);
    assert.equal(tokenFromNative.status, 'PENDING');

    // Native writes a new envelope
    const nativeEnv = {
      id: 'env_native_001',
      traceId: 'trc_native_001',
      roomId: 'h02-shared-room',
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'native_user', role: 'USER' },
      recipient: { kind: 'room', id: 'h02-shared-room' },
      fidelity: 'L0_RAW_TEXT',
      parts: [{ kind: 'text', text: 'Written by Electron native client' }],
    };
    await nativeClient.insertEnvelope(nativeEnv);
    await nativeClient.closeAsync();

    // 3. Open with Node 24 Storage Worker
    const workerClient = new StorageServiceClient(dbPath, { forceWorker: true });
    await workerClient.ready;

    // Worker reads native-written envelope
    const envelopesFromWorker = await workerClient.getRoomEnvelopes('h02-shared-room');
    assert.ok(envelopesFromWorker.some((e: any) => e.id === 'env_native_001'));

    // Worker writes its own envelope
    const workerEnv = {
      id: 'env_worker_002',
      traceId: 'trc_worker_002',
      roomId: 'h02-shared-room',
      timestamp: Date.now(),
      sender: { kind: 'user', id: 'worker_user', role: 'USER' },
      recipient: { kind: 'room', id: 'h02-shared-room' },
      fidelity: 'L0_RAW_TEXT',
      parts: [{ kind: 'text', text: 'Written by Node 24 worker' }],
    };
    await workerClient.insertEnvelope(workerEnv);
    await workerClient.closeAsync();

    // 4. Return to TypeScript StorageEngine for final verification
    const tsEngine2 = new StorageEngine({ filename: dbPath, wal: true });
    const finalRawDb = tsEngine2.getRawDatabase();

    // Check PRAGMA settings
    const journalMode = (finalRawDb.prepare('PRAGMA journal_mode').get() as any).journal_mode;
    assert.equal(journalMode.toLowerCase(), 'wal', 'Database must maintain WAL journal mode');

    const foreignKeys = (finalRawDb.prepare('PRAGMA foreign_keys').get() as any).foreign_keys;
    assert.equal(foreignKeys, 1, 'PRAGMA foreign_keys must be ON');

    // Both envelopes must exist
    assert.ok(tsEngine2.getEnvelope('env_native_001'));
    assert.ok(tsEngine2.getEnvelope('env_worker_002'));

    // dag_node must be intact
    const dagNode = finalRawDb.prepare("SELECT name, recovery_state FROM dag_nodes WHERE node_id = 'node_1'").get() as any;
    assert.equal(dagNode.name, 'Build Artifact');
    assert.equal(dagNode.recovery_state, 'IDLE');

    // 5. Future migration version guard: insert version 999 and verify refusal
    finalRawDb.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (999, '999_future_schema', 'future_hash', ?)
    `).run(new Date().toISOString());
    tsEngine2.close();

    assert.throws(
      () => new StorageEngine({ filename: dbPath, wal: true }),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_UNSUPPORTED_SCHEMA_VERSION');
        return true;
      },
      'Database with future migration version must refuse write migrations to prevent corruption'
    );
  });

  // =========================================================================
  // R05-H03: Nâng cấp DB Legacy R02/R03/R04
  // =========================================================================
  it('R05-H03: Upgrades 3 independent legacy DB fixtures with verified legacy fingerprint recognition', async () => {
    // -----------------------------------------------------------------------
    // Fixture 1: Legacy R02 DB (rooms, envelopes, events, empty migrations)
    // -----------------------------------------------------------------------
    const r02Path = path.join(tmpDir, 'legacy_fixture_r02.db');
    const r02Db = new DatabaseSync(r02Path);
    r02Db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE events (sequence_id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, stream_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, metadata_json TEXT, occurred_at TEXT NOT NULL);
      CREATE TABLE envelopes (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, correlation_id TEXT, room_id TEXT NOT NULL, sender_kind TEXT NOT NULL, sender_id TEXT NOT NULL, sender_role TEXT, raw_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, target_id TEXT NOT NULL, status TEXT NOT NULL, payload_digest TEXT, response_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE outbox (id TEXT PRIMARY KEY, stream_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE approvals (token_id TEXT PRIMARY KEY, action_type TEXT NOT NULL, payload_digest TEXT NOT NULL, canonicalization_version INTEGER DEFAULT 1, origin TEXT NOT NULL, workspace_id TEXT, room_id TEXT, actor_id TEXT, recipient TEXT, policy_version TEXT DEFAULT '1.0.0', status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, approver_id TEXT, approved_at TEXT, rejected_at TEXT, rejection_reason TEXT, consumed_at TEXT);
      CREATE TABLE audit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL);

      INSERT INTO schema_migrations VALUES (1, '001_initial_p2_schema', '${LEGACY_R04_EMPTY_CHECKSUM}', '2026-10-15T00:00:00.000Z');
      INSERT INTO rooms VALUES ('r02_room', 'R02 Room', '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
      INSERT INTO envelopes VALUES ('env_r02', 'trc_r02', NULL, 'r02_room', 'user', 'u1', 'USER', '{"id":"env_r02","roomId":"r02_room"}', 'acknowledged', '2026-10-15T00:00:00.000Z');
      INSERT INTO idempotency_keys VALUES ('env_r02', 'r02_room', 'COMPLETED', NULL, '{"success":true}', '2026-10-15T00:00:00.000Z', '2026-10-16T00:00:00.000Z');
    `);
    r02Db.close();

    // -----------------------------------------------------------------------
    // Fixture 2: Legacy R03 DB (outbox QUEUED + UNKNOWN_NEEDS_RECONCILIATION, approvals CONSUMED)
    // -----------------------------------------------------------------------
    const r03Path = path.join(tmpDir, 'legacy_fixture_r03.db');
    const r03Db = new DatabaseSync(r03Path);
    r03Db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE events (sequence_id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, stream_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, metadata_json TEXT, occurred_at TEXT NOT NULL);
      CREATE TABLE envelopes (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, correlation_id TEXT, room_id TEXT NOT NULL, sender_kind TEXT NOT NULL, sender_id TEXT NOT NULL, sender_role TEXT, raw_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, target_id TEXT NOT NULL, status TEXT NOT NULL, payload_digest TEXT, response_json TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE outbox (id TEXT PRIMARY KEY, stream_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE approvals (token_id TEXT PRIMARY KEY, action_type TEXT NOT NULL, payload_digest TEXT NOT NULL, canonicalization_version INTEGER DEFAULT 1, origin TEXT NOT NULL, workspace_id TEXT, room_id TEXT, actor_id TEXT, recipient TEXT, policy_version TEXT DEFAULT '1.0.0', status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, approver_id TEXT, approved_at TEXT, rejected_at TEXT, rejection_reason TEXT, consumed_at TEXT);
      CREATE TABLE audit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL);

      INSERT INTO schema_migrations VALUES (1, '001_initial_p2_schema', '${LEGACY_R04_EMPTY_CHECKSUM}', '2026-10-16T00:00:00.000Z');
      INSERT INTO outbox VALUES ('out_q', 'stream_1', 'evt_1', '{}', 'QUEUED', 0, '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z');
      INSERT INTO outbox VALUES ('out_u', 'stream_1', 'evt_2', '{}', 'UNKNOWN_NEEDS_RECONCILIATION', 1, '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:00.000Z');
      INSERT INTO approvals VALUES ('appr_consumed', 'read_web', '2222222222222222222222222222222222222222222222222222222222222222', 1, 'ui', NULL, NULL, NULL, NULL, '1.0.0', 'CONSUMED', '2026-10-16T00:00:00.000Z', '2026-10-16T01:00:00.000Z', 'lead', '2026-10-16T00:01:00.000Z', NULL, NULL, '2026-10-16T00:02:00.000Z');
    `);
    r03Db.close();

    // -----------------------------------------------------------------------
    // Fixture 3: Legacy R04 DB (Electron empty hash e3b0c442...)
    // -----------------------------------------------------------------------
    const r04Path = path.join(tmpDir, 'legacy_fixture_r04.db');
    const r04Db = new DatabaseSync(r04Path);
    r04Db.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE events (sequence_id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL, stream_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL, metadata_json TEXT, occurred_at TEXT NOT NULL);
      CREATE TABLE envelopes (id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, correlation_id TEXT, room_id TEXT NOT NULL, sender_kind TEXT NOT NULL, sender_id TEXT NOT NULL, sender_role TEXT, raw_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE idempotency_keys (key TEXT PRIMARY KEY, target_id TEXT NOT NULL, status TEXT NOT NULL, payload_digest TEXT, response_json TEXT, dispatch_prepared INTEGER DEFAULT 0, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
      CREATE TABLE outbox (id TEXT PRIMARY KEY, stream_id TEXT NOT NULL, event_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL, retry_count INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE approvals (token_id TEXT PRIMARY KEY, action_type TEXT NOT NULL, payload_digest TEXT NOT NULL, canonicalization_version INTEGER DEFAULT 1, origin TEXT NOT NULL, workspace_id TEXT, room_id TEXT, actor_id TEXT, recipient TEXT, policy_version TEXT DEFAULT '1.0.0', status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, approver_id TEXT, approved_at TEXT, rejected_at TEXT, rejection_reason TEXT, consumed_at TEXT);
      CREATE TABLE audit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL);

      INSERT INTO schema_migrations VALUES (1, '001_initial_p2_schema', '${LEGACY_R04_EMPTY_CHECKSUM}', '2026-10-18T00:00:00.000Z');
      INSERT INTO rooms VALUES ('r04_room', 'R04 Room', '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z');
    `);
    r04Db.close();

    // Verify upgrade on Fixture 1 (R02)
    const r02Engine = new StorageEngine({ filename: r02Path, wal: true });
    const r02Raw = r02Engine.getRawDatabase();
    // Checksum must now be updated to canonical
    const r02Checksum = (r02Raw.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get() as any).checksum;
    assert.equal(r02Checksum, CANONICAL_MIGRATION_1_CHECKSUM);
    // Missing tables dag_nodes and snapshots must now exist
    const r02Tables = (r02Raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((r) => r.name);
    assert.ok(r02Tables.includes('dag_nodes'));
    assert.ok(r02Tables.includes('snapshots'));
    // dispatch_prepared must now exist in idempotency_keys
    const r02Cols = (r02Raw.prepare('PRAGMA table_info(idempotency_keys)').all() as any[]).map((c) => c.name);
    assert.ok(r02Cols.includes('dispatch_prepared'));
    r02Engine.close();

    // Verify upgrade on Fixture 2 (R03)
    const r03Engine = new StorageEngine({ filename: r03Path, wal: true });
    const r03Raw = r03Engine.getRawDatabase();
    // UNKNOWN_NEEDS_RECONCILIATION must remain untouched (NEVER reverted to QUEUED)
    const uRow = r03Raw.prepare("SELECT status FROM outbox WHERE id = 'out_u'").get() as any;
    assert.equal(uRow.status, 'UNKNOWN_NEEDS_RECONCILIATION', 'UNKNOWN status must be preserved exactly');
    const qRow = r03Raw.prepare("SELECT status FROM outbox WHERE id = 'out_q'").get() as any;
    assert.equal(qRow.status, 'QUEUED');
    // Approval CONSUMED must remain CONSUMED
    const aRow = r03Raw.prepare("SELECT status FROM approvals WHERE token_id = 'appr_consumed'").get() as any;
    assert.equal(aRow.status, 'CONSUMED');
    r03Engine.close();

    // Verify upgrade on Fixture 3 (R04) opened by Desktop worker
    const r04WorkerClient = new StorageServiceClient(r04Path, { forceWorker: true });
    await r04WorkerClient.ready;
    const r04Rooms = await r04WorkerClient.getRooms();
    assert.ok(r04Rooms.some((r: any) => r.id === 'r04_room'));
    await r04WorkerClient.closeAsync();

    // Re-opening second time is idempotent (no errors, no migrations re-applied)
    const r04TsEngine = new StorageEngine({ filename: r04Path, wal: true });
    const r04Checksum = (r04TsEngine.getRawDatabase().prepare('SELECT checksum FROM schema_migrations WHERE version = 1').get() as any).checksum;
    assert.equal(r04Checksum, CANONICAL_MIGRATION_1_CHECKSUM);
    r04TsEngine.close();

    // Negative check: database with unknown non-legacy checksum MUST be denied
    const badDbPath = path.join(tmpDir, 'legacy_fixture_bad.db');
    const badDb = new DatabaseSync(badDbPath);
    badDb.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '001_initial_p2_schema', 'completely_unrecognized_fake_hash', '2026-10-18T00:00:00.000Z');
    `);
    badDb.close();

    assert.throws(
      () => new StorageEngine({ filename: badDbPath, wal: true }),
      (err: any) => {
        assert.ok(err instanceof UnionBotError);
        assert.equal(err.code, 'ERR_MIGRATION_TAMPERED');
        return true;
      },
      'Unrecognized non-legacy checksum must be strictly denied with ERR_MIGRATION_TAMPERED'
    );
  });
});
