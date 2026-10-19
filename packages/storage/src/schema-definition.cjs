/**
 * @file schema-definition.cjs
 * @description Authoritative Single Source of Truth for Union Bot SQLite Schema and Migrations (UB-P2-R04-01).
 * Shared across TypeScript StorageEngine, Electron Native SQLite, and Node 24 Storage Worker.
 */

const { createHash } = require('node:crypto');

const MIGRATION_1_SQL = `
  -- 2. Chat & Collaboration Rooms
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 3. Append-only Event Journal (P2-004)
  CREATE TABLE IF NOT EXISTS events (
    sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE NOT NULL,
    stream_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_stream_seq ON events (stream_id, sequence_id);
  CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);

  -- 4. Canonical Envelopes Table
  CREATE TABLE IF NOT EXISTS envelopes (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    correlation_id TEXT,
    room_id TEXT NOT NULL,
    sender_kind TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_role TEXT,
    raw_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_envelopes_room ON envelopes (room_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);

  -- 5. Idempotency Keys (P2-005, C05, UB-P2-R01-005, UB-P2-R02-005)
  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload_digest TEXT,
    response_json TEXT,
    dispatch_prepared INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- 6. Outbox for Guaranteed Delivery & Recovery (P2-005, UB-P2-R01-005)
  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    stream_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);

  -- 7. Approval Tokens for Actions (P2-006, C02, UB-P2-R01-001, UB-P2-R01-002)
  CREATE TABLE IF NOT EXISTS approvals (
    token_id TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    canonicalization_version INTEGER DEFAULT 1,
    origin TEXT NOT NULL,
    workspace_id TEXT,
    room_id TEXT,
    actor_id TEXT,
    recipient TEXT,
    policy_version TEXT DEFAULT '1.0.0',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    approver_id TEXT,
    approved_at TEXT,
    rejected_at TEXT,
    rejection_reason TEXT,
    consumed_at TEXT
  );

  -- 8. DAG Task Graph Nodes (P2 Task Graph Foundation)
  CREATE TABLE IF NOT EXISTS dag_nodes (
    task_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dependencies_json TEXT NOT NULL,
    assigned_role TEXT NOT NULL,
    assigned_provider TEXT,
    revision INTEGER DEFAULT 1,
    attempt INTEGER DEFAULT 1,
    correlation_id TEXT NOT NULL,
    recovery_state TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (task_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS idx_dag_recovery ON dag_nodes (recovery_state);

  -- 9. Snapshots for Event Sourcing Projection Rebuild (P2-004)
  CREATE TABLE IF NOT EXISTS snapshots (
    stream_id TEXT PRIMARY KEY,
    last_sequence_id INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 10. Audit Ledger
  CREATE TABLE IF NOT EXISTS audit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL
  );
`;

function computeChecksum(content) {
  return createHash('sha256').update(content.trim(), 'utf8').digest('hex');
}

const CANONICAL_MIGRATION_1_CHECKSUM = computeChecksum(MIGRATION_1_SQL);
// Known legacy checksum from R03/R04 desktop implementations
const LEGACY_R04_EMPTY_CHECKSUM = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_p2_schema',
    checksum: CANONICAL_MIGRATION_1_CHECKSUM,
    sql: MIGRATION_1_SQL,
    up: (db) => {
      db.exec(MIGRATION_1_SQL);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS audit_ledger;
        DROP TABLE IF EXISTS snapshots;
        DROP TABLE IF EXISTS dag_nodes;
        DROP TABLE IF EXISTS approvals;
        DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS idempotency_keys;
        DROP TABLE IF EXISTS envelopes;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS rooms;
      `);
    },
  },
];

const LEGACY_STRUCTURAL_SIGNATURE = {
  rooms: ['id', 'name', 'created_at', 'updated_at'],
  events: ['stream_id', 'event_type'],
  envelopes: ['id', 'room_id', 'sender_id', 'status', 'created_at'],
  idempotency_keys: ['key', 'target_id', 'status', 'created_at', 'expires_at'],
  outbox: ['id', 'status', 'created_at'],
  approvals: ['token_id', 'action_type', 'status', 'created_at', 'expires_at'],
  audit_ledger: ['id', 'created_at'],
};

/**
 * Checks if the database matches a verified legacy schema fingerprint.
 * Inspects both table existence and precise column structural signature (UB-P2-R06-C02, R07-A05).
 */
function isVerifiedLegacyFingerprint(db, appliedChecksum) {
  if (appliedChecksum !== LEGACY_R04_EMPTY_CHECKSUM) {
    return false;
  }
  try {
    // 1. Verify PRAGMA integrity_check
    const integrityRow = db.prepare('PRAGMA integrity_check').get();
    const integrityOk = integrityRow && (integrityRow.integrity_check === 'ok' || integrityRow['integrity_check'] === 'ok');
    if (!integrityOk) {
      return false;
    }

    // 2. Verify expected legacy core tables and exact column structure exist (UB-P2-R06-C02)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    for (const [tableName, requiredColumns] of Object.entries(LEGACY_STRUCTURAL_SIGNATURE)) {
      if (!tables.includes(tableName)) {
        return false;
      }
      const tableInfo = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const colNames = tableInfo.map((c) => c.name);
      for (const col of requiredColumns) {
        if (!colNames.includes(col)) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies migrations or reconciles verified legacy schema.
 */
function runSchemaMigrations(db) {
  const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  const maxCodeVersion = Math.max(...MIGRATIONS.map((m) => m.version), 0);
  let appliedRows = [];

  // 1. Verify integrity of existing schema_migrations BEFORE executing any DDL or writes (R05-F02, R06-B02)
  if (existingTables.includes('schema_migrations')) {
    appliedRows = db
      .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
      .all();

    for (const applied of appliedRows) {
      if (applied.version > maxCodeVersion) {
        const err = new Error(
          `Database version ${applied.version} is newer than supported code version ${maxCodeVersion}. Refusing write migration to prevent database corruption.`
        );
        err.code = 'ERR_UNSUPPORTED_SCHEMA_VERSION';
        err.details = { databaseVersion: applied.version, maxCodeVersion };
        throw err;
      }

      const expectedMigration = MIGRATIONS.find((m) => m.version === applied.version);
      if (!expectedMigration) {
        const err = new Error(`Unknown migration version ${applied.version} recorded in database.`);
        err.code = 'ERR_MIGRATION_TAMPERED';
        err.details = { version: applied.version };
        throw err;
      }

      if (applied.checksum !== expectedMigration.checksum) {
        // If not a recognized legacy fingerprint, strictly reject as tampered BEFORE touching anything
        if (!isVerifiedLegacyFingerprint(db, applied.checksum)) {
          const err = new Error(
            `Migration version ${applied.version} checksum mismatch! Expected ${expectedMigration.checksum}, database has ${applied.checksum}. Migration definitions must not be modified after application.`
          );
          err.code = 'ERR_MIGRATION_TAMPERED';
          err.details = { version: applied.version, expected: expectedMigration.checksum, actual: applied.checksum };
          throw err;
        }
      }
    }
  }

  // 2. Ensure schema_migrations tracker table exists (only reached if DB is valid or fresh)
  if (!existingTables.includes('schema_migrations')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  const appliedMap = new Map(appliedRows.map((r) => [r.version, r]));

  // 3. Atomically reconcile verified legacy schema fingerprints inside a transaction (UB-P2-R04-01, R05-H03)
  for (const applied of appliedRows) {
    const expectedMigration = MIGRATIONS.find((m) => m.version === applied.version);
    if (expectedMigration && applied.checksum !== expectedMigration.checksum && isVerifiedLegacyFingerprint(db, applied.checksum)) {
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        // Ensure dag_nodes and snapshots exist
        db.exec(`
          CREATE TABLE IF NOT EXISTS dag_nodes (
            task_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            name TEXT NOT NULL,
            dependencies_json TEXT NOT NULL,
            assigned_role TEXT NOT NULL,
            assigned_provider TEXT,
            revision INTEGER DEFAULT 1,
            attempt INTEGER DEFAULT 1,
            correlation_id TEXT NOT NULL,
            recovery_state TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (task_id, node_id)
          );
          CREATE INDEX IF NOT EXISTS idx_dag_recovery ON dag_nodes (recovery_state);

          CREATE TABLE IF NOT EXISTS snapshots (
            stream_id TEXT PRIMARY KEY,
            last_sequence_id INTEGER NOT NULL,
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
          CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
          CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);
          CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
        `);

        // Ensure dispatch_prepared exists in idempotency_keys
        const idempotencyCols = db.prepare('PRAGMA table_info(idempotency_keys)').all();
        if (!idempotencyCols.some((c) => c.name === 'dispatch_prepared')) {
          db.exec('ALTER TABLE idempotency_keys ADD COLUMN dispatch_prepared INTEGER DEFAULT 0;');
        }

        // Update checksum to canonical
        db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = ?').run(
          expectedMigration.checksum,
          applied.version
        );

        db.exec('COMMIT;');
      } catch (upgradeErr) {
        try { db.exec('ROLLBACK;'); } catch {}
        const err = new Error(`ERR_MIGRATION_FAILED: Legacy database upgrade failed and was rolled back: ${upgradeErr.message}`);
        err.code = 'ERR_MIGRATION_FAILED';
        throw err;
      }
    }
  }

  // 4. Upgrade missing columns/indices for existing legacy tables safely inside transaction if needed
  if (existingTables.includes('idempotency_keys') || existingTables.includes('events')) {
    db.exec('BEGIN IMMEDIATE TRANSACTION;');
    try {
      if (existingTables.includes('idempotency_keys')) {
        const idempotencyCols = db.prepare('PRAGMA table_info(idempotency_keys)').all();
        if (!idempotencyCols.some((c) => c.name === 'dispatch_prepared')) {
          db.exec('ALTER TABLE idempotency_keys ADD COLUMN dispatch_prepared INTEGER DEFAULT 0;');
        }
      }
      if (existingTables.includes('events')) {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events (occurred_at);
          CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
        `);
      }
      if (existingTables.includes('envelopes')) {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_envelopes_trace ON envelopes (trace_id);
        `);
      }
      if (existingTables.includes('outbox')) {
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
        `);
      }
      db.exec('COMMIT;');
    } catch (legErr) {
      try { db.exec('ROLLBACK;'); } catch {}
      const err = new Error(`ERR_MIGRATION_FAILED: Legacy schema adjustment failed: ${legErr.message}`);
      err.code = 'ERR_MIGRATION_FAILED';
      throw err;
    }
  }

  // 5. Apply pending migrations inside atomic transactions
  let appliedCount = 0;
  for (const m of MIGRATIONS) {
    if (!appliedMap.has(m.version)) {
      db.exec('BEGIN IMMEDIATE TRANSACTION;');
      try {
        if (typeof m.up === 'function') {
          m.up(db);
        } else if (m.sql) {
          db.exec(m.sql);
        }
        db.prepare(`
          INSERT INTO schema_migrations (version, name, checksum, applied_at)
          VALUES (?, ?, ?, ?)
        `).run(m.version, m.name, m.checksum, new Date().toISOString());

        db.exec('COMMIT;');
        appliedCount++;
      } catch (err) {
        try { db.exec('ROLLBACK;'); } catch {}
        const failErr = new Error(`Migration ${m.version} (${m.name}) failed and was cleanly rolled back: ${err.message}`);
        failErr.code = 'ERR_MIGRATION_FAILED';
        failErr.details = { version: m.version, name: m.name };
        throw failErr;
      }
    }
  }

  const latestRow = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get();
  return {
    appliedCount,
    currentVersion: latestRow?.v ?? 0,
  };
}

module.exports = {
  MIGRATION_1_SQL,
  CANONICAL_MIGRATION_1_CHECKSUM,
  LEGACY_R04_EMPTY_CHECKSUM,
  MIGRATIONS,
  computeChecksum,
  isVerifiedLegacyFingerprint,
  runSchemaMigrations,
};
